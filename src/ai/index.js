/**
 * AI Reply Module
 * Handles LLM API calls for agent responses.
 * Supports tool use (function calling) and streaming responses.
 * Reads config from ~/.hermes/config.yaml and .env
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { execSync } = require('child_process');

const HERMES_HOME = process.env.HERMES_HOME || path.join(require('os').homedir(), '.hermes');
const CONFIG_PATH = path.join(HERMES_HOME, 'config.yaml');
const ENV_PATH = path.join(HERMES_HOME, '.env');

// Available tools that agents can use
const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: '在服务器上执行 shell 命令，获取系统信息、文件内容等。超时 30 秒。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的 shell 命令，如 "free -h", "df -h", "ls -la" 等'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取服务器上的文件内容',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件路径'
          }
        },
        required: ['path']
      }
    }
  }
];

// Execute a tool call safely
function executeTool(name, args) {
  try {
    if (name === 'run_command') {
      const cmd = args.command || '';
      const blocked = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'fork bomb'];
      if (blocked.some(b => cmd.includes(b))) {
        return '⚠️ 该命令被安全策略阻止';
      }
      const output = execSync(cmd, { timeout: 30000, maxBuffer: 50 * 1024, encoding: 'utf8' });
      return output.slice(0, 4000) || '(命令执行成功，无输出)';
    } else if (name === 'read_file') {
      const filePath = args.path || '';
      if (!fs.existsSync(filePath)) return `文件不存在: ${filePath}`;
      const content = fs.readFileSync(filePath, 'utf8');
      return content.slice(0, 4000);
    }
    return '未知工具: ' + name;
  } catch (e) {
    return `执行错误: ${e.message?.slice(0, 500) || e}`;
  }
}

function getConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = yaml.load(raw);
    const provider = config.model?.provider || '';
    const providerName = provider.replace('custom:', '');
    const providerConfig = config.providers?.[providerName] || {};
    const keyEnv = providerConfig.key_env || '';
    let apiKey = '';
    if (keyEnv && fs.existsSync(ENV_PATH)) {
      const envContent = fs.readFileSync(ENV_PATH, 'utf8');
      const match = envContent.match(new RegExp(`^${keyEnv}=['"]?([^'"\\n]+)`, 'm'));
      if (match) apiKey = match[1];
    }
    return {
      model: config.model?.default || 'gpt-4o',
      baseUrl: providerConfig.base_url || 'https://api.openai.com/v1',
      apiKey
    };
  } catch (e) {
    return null;
  }
}

/**
 * Stream a chat completion, calling onToken for each text chunk.
 * Returns the full accumulated text.
 * Does NOT support tool use (used for final text generation after tools).
 */
async function streamChatCompletion(config, messages, model, onToken) {
  const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const body = {
    model,
    messages,
    max_tokens: config.maxTokens || 2048,
    temperature: config.temperature !== undefined ? config.temperature : 0.7,
    stream: true
  };
  if (config.topP !== undefined && config.topP !== null && config.topP !== 1) body.top_p = config.topP;
  if (config.frequencyPenalty) body.frequency_penalty = config.frequencyPenalty;
  if (config.presencePenalty) body.presence_penalty = config.presencePenalty;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + config.apiKey
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    console.error(`[AI] Stream API error ${resp.status}: ${errText.slice(0, 200)}`);
    return null;
  }

  let fullText = '';
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          fullText += delta.content;
          if (onToken) onToken(delta.content);
        }
      } catch {}
    }
  }

  return fullText || null;
}

/**
 * Non-streaming tool use loop. Returns messages array with tool results appended.
 * When model stops calling tools, returns { finalText, messages }.
 */
async function toolUseLoop(config, messages, model, maxRounds = 5) {
  let currentMessages = [...messages];

  for (let round = 0; round < maxRounds; round++) {
    const body = {
      model,
      messages: currentMessages,
      max_tokens: config.maxTokens || 2048,
      temperature: config.temperature !== undefined ? config.temperature : 0.7,
      tools: AGENT_TOOLS,
      tool_choice: 'auto'
    };
    if (config.topP !== undefined && config.topP !== null && config.topP !== 1) body.top_p = config.topP;
    if (config.frequencyPenalty) body.frequency_penalty = config.frequencyPenalty;
    if (config.presencePenalty) body.presence_penalty = config.presencePenalty;

    const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.apiKey
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000)
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error(`[AI] API error ${resp.status}: ${errText.slice(0, 200)}`);
      return { finalText: null, messages: currentMessages };
    }

    const data = await resp.json();
    const choice = data.choices?.[0];
    if (!choice) return { finalText: null, messages: currentMessages };

    const msg = choice.message;

    // If no tool calls, we have the final text
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { finalText: msg.content || null, messages: currentMessages };
    }

    // Process tool calls
    console.log(`[AI] Round ${round + 1}: ${msg.tool_calls.length} tool call(s)`);
    currentMessages.push(msg);

    for (const tc of msg.tool_calls) {
      const fnName = tc.function?.name || '';
      let fnArgs = {};
      try { fnArgs = JSON.parse(tc.function?.arguments || '{}'); } catch {}
      
      console.log(`[AI] Tool: ${fnName}(${JSON.stringify(fnArgs).slice(0, 100)})`);
      const result = executeTool(fnName, fnArgs);
      
      currentMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result
      });
    }
  }

  // Exhausted rounds — return messages for final streaming call
  return { finalText: null, messages: currentMessages };
}

/**
 * Full chat completion with tool use + streaming final response.
 * @param {Object} agent - { id, name, description, model_config_id }
 * @param {Array} history - conversation history [{role, content}]
 * @param {Function} onToken - callback(chunk) for streaming tokens
 * @param {Object|null} modelConfig - override config from DB { base_url, api_key, model, max_tokens, temperature }
 * @returns {string|null} - final complete response text
 */
async function chatCompletion(agent, history, onToken = null, modelConfig = null) {
  let config;
  if (modelConfig) {
    // Parse params_json for extended parameters
    let params = {};
    if (modelConfig.params_json) {
      try { params = typeof modelConfig.params_json === 'string' ? JSON.parse(modelConfig.params_json) : modelConfig.params_json; } catch(e) {}
    }
    config = {
      model: modelConfig.model,
      baseUrl: modelConfig.base_url,
      apiKey: modelConfig.api_key,
      maxTokens: params.max_tokens || modelConfig.max_tokens || 2048,
      temperature: params.temperature !== undefined ? params.temperature : (modelConfig.temperature || 0.7),
      topP: params.top_p,
      frequencyPenalty: params.frequency_penalty,
      presencePenalty: params.presence_penalty,
      contextLength: params.context_length
    };
  } else {
    config = getConfig();
  }
  if (!config || !config.apiKey) {
    console.error('[AI] No API config found');
    return null;
  }

  const systemPrompt = agent.description
    ? `你是 ${agent.name}。${agent.description}\n\n请用中文回复，保持简洁友好。你有工具可以使用，可以执行命令来获取服务器信息。回复时使用 Markdown 格式（代码块、加粗、列表等）让内容更易读。`
    : `你是 ${agent.name}，一个智能助手。请用中文回复，保持简洁友好。你有工具可以使用。回复时使用 Markdown 格式。`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history
  ];

  // Phase 1: Tool use loop (non-streaming, because tool calls need full JSON)
  const { finalText, messages: updatedMessages } = await toolUseLoop(config, messages, config.model);

  // If tool loop returned text directly (no streaming needed for simple replies)
  if (finalText && !onToken) {
    return finalText;
  }

  // If we got final text but have a streaming callback, just emit it all at once
  if (finalText && onToken) {
    onToken(finalText);
    return finalText;
  }

  // Phase 2: Stream the final response after tool use
  // Add a prompt to summarize tool results
  const streamMessages = [...updatedMessages, { role: 'user', content: '请根据以上工具执行结果，给出最终回复。' }];
  const streamedText = await streamChatCompletion(config, streamMessages, config.model, onToken);
  return streamedText;
}

/**
 * Process a message and generate AI replies from mentioned/all agents.
 * Streams tokens to UI via WebSocket.
 */
async function processMessage(db, wsManager, roomId, senderId, text, mentions = [], roomType = 'group', chainDepth = 0) {
  const MAX_CHAIN_DEPTH = 5;
  if (chainDepth >= MAX_CHAIN_DEPTH) {
    console.log(`[AI] Chain depth ${chainDepth} reached max, stopping.`);
    return;
  }

  const members = await db.getRoomMembers(roomId);
  
  let respondingAgents = [];
  
  if (roomType === 'dm') {
    respondingAgents = members.filter(m => m.id !== senderId && m.id !== 'system' && m.id !== 'user');
  } else if (mentions.length > 0) {
    respondingAgents = members.filter(m => mentions.includes(m.id));
  } else if (chainDepth === 0) {
    respondingAgents = members.filter(m => m.id !== senderId && m.id !== 'system' && m.id !== 'user');
  }

  if (respondingAgents.length === 0) return;

  // Filter out offline agents
  respondingAgents = respondingAgents.filter(a => a.status !== 'offline');
  if (respondingAgents.length === 0) return;

  const recentMessages = await db.getRoomMessages(roomId, 20);
  
  for (const agent of respondingAgents) {
    const fullAgent = await db.getAgentById(agent.id);
    if (!fullAgent) continue;

    const history = recentMessages.map(m => ({
      role: m.sender_id === agent.id ? 'assistant' : 'user',
      content: m.sender_name && m.sender_id !== agent.id
        ? `[${m.sender_name}]: ${m.text}`
        : m.text
    }));

    if (chainDepth > 0) {
      history.push({
        role: 'user',
        content: `[系统提示]: 你被 @提及了，请根据上下文回复。如果需要其他智能体协助，可以在回复中 @他们的名字。`
      });
    }

    // Generate a temporary stream ID for this response
    const streamId = `stream_${Date.now()}_${agent.id.slice(0, 8)}`;

    // Get agent's model config (if assigned)
    let modelConfig = null;
    if (fullAgent.model_config_id) {
      modelConfig = db.getModelConfig(fullAgent.model_config_id);
    }
    if (!modelConfig) {
      modelConfig = db.getDefaultModelConfig();
    }

    // Notify UI that streaming started
    if (wsManager) {
      wsManager.notifyUI({
        type: 'stream_start',
        stream_id: streamId,
        room_id: roomId,
        agent_id: agent.id,
        agent_name: agent.name || fullAgent.name
      });
    }

    // Stream tokens to UI
    const reply = await chatCompletion(fullAgent, history, (chunk) => {
      if (wsManager) {
        wsManager.notifyUI({
          type: 'stream_token',
          stream_id: streamId,
          room_id: roomId,
          agent_id: agent.id,
          chunk
        });
      }
    }, modelConfig);

    // Notify UI that streaming ended
    if (wsManager) {
      wsManager.notifyUI({
        type: 'stream_end',
        stream_id: streamId,
        room_id: roomId,
        agent_id: agent.id
      });
    }

    if (!reply) continue;

    // Parse @mentions in reply
    const replyMentions = [];
    const mentionRegex = /@(\S+)/g;
    let match;
    const allAgents = await db.listAgents();
    while ((match = mentionRegex.exec(reply)) !== null) {
      const mentioned = allAgents.find(a => a.name === match[1] && a.id !== agent.id);
      if (mentioned) replyMentions.push(mentioned.id);
    }

    const message = await db.createMessage(roomId, agent.id, reply, 'markdown', null, replyMentions);

    // Notify via WebSocket (for agent connections)
    for (const member of members) {
      if (member.id !== agent.id) {
        const payload = {
          message_id: message.id,
          room_id: roomId,
          from: { id: agent.id, name: agent.name },
          text: reply,
          parse_mode: 'markdown',
          date: new Date().toISOString()
        };
        await db.pushUpdate(member.id, 'message', payload);
        if (wsManager) {
          wsManager.notify(member.id, { type: 'message', ...payload });
        }
      }
    }

    // Also notify UI of the final saved message
    if (wsManager) {
      wsManager.notifyUI({
        type: 'new_message',
        room_id: roomId,
        message: {
          id: message.id,
          room_id: roomId,
          sender_id: agent.id,
          sender_name: agent.name || fullAgent.name,
          text: reply,
          created_at: new Date().toISOString()
        }
      });
    }

    // Chain collaboration
    if (replyMentions.length > 0 && roomType === 'group') {
      console.log(`[AI] Chain: ${agent.name} mentioned ${replyMentions.length} agent(s), depth=${chainDepth + 1}`);
      await new Promise(r => setTimeout(r, 1000));
      await processMessage(db, wsManager, roomId, agent.id, reply, replyMentions, roomType, chainDepth + 1);
    }
  }
}

module.exports = { chatCompletion, processMessage, getConfig };
