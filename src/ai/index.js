/**
 * AI Reply Module
 * Handles LLM API calls for agent responses.
 * Supports tool use (function calling) with real-time WS event push.
 * Reads config from ~/.hermes/config.yaml and .env
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { TOOL_DEFINITIONS, executeTool, toolCallSummary } = require('./tools');

const HERMES_HOME = process.env.HERMES_HOME || path.join(require('os').homedir(), '.hermes');
const CONFIG_PATH = path.join(HERMES_HOME, 'config.yaml');
const ENV_PATH = path.join(HERMES_HOME, '.env');

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
 * Stream a chat completion (text only, no tools).
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
 * Tool use loop with real-time event emission.
 * @param {Object} config - API config
 * @param {Array} messages - conversation messages
 * @param {string} model - model ID
 * @param {Function} onToolCall - callback({name, args, summary}) when tool is called
 * @param {Function} onToolResult - callback({name, result, ok}) when tool returns
 * @param {number} maxRounds - max tool call rounds
 * @returns {{ finalText: string|null, messages: Array }}
 */
async function toolUseLoop(config, messages, model, onToolCall, onToolResult, maxRounds = 8) {
  let currentMessages = [...messages];

  for (let round = 0; round < maxRounds; round++) {
    const body = {
      model,
      messages: currentMessages,
      max_tokens: config.maxTokens || 2048,
      temperature: config.temperature !== undefined ? config.temperature : 0.7,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto'
    };
    if (config.topP !== undefined && config.topP !== null && config.topP !== 1) body.top_p = config.topP;

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

      const summary = toolCallSummary(fnName, fnArgs);
      console.log(`[AI] Tool: ${fnName}(${summary})`);

      // Emit tool_call event
      if (onToolCall) onToolCall({ name: fnName, args: fnArgs, summary });

      // Execute tool
      const result = await executeTool(fnName, fnArgs);

      // Emit tool_result event
      if (onToolResult) onToolResult({ name: fnName, ok: result.ok, output: result.output });

      currentMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: typeof result.output === 'string' ? result.output : JSON.stringify(result)
      });
    }
  }

  // Exhausted rounds
  return { finalText: null, messages: currentMessages };
}

/**
 * Full chat completion with tool use + streaming final response.
 * @param {Object} agent - { id, name, description, model_config_id }
 * @param {Array} history - conversation history [{role, content}]
 * @param {Object} callbacks - { onToken, onToolCall, onToolResult }
 * @param {Object|null} modelConfig - override config from DB
 * @returns {string|null} - final complete response text
 */
async function chatCompletion(agent, history, callbacks = {}, modelConfig = null) {
  const { onToken, onToolCall, onToolResult } = callbacks;

  let config;
  if (modelConfig) {
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
    };
  } else {
    config = getConfig();
  }
  if (!config || !config.apiKey) {
    console.error('[AI] No API config found');
    return null;
  }

  const systemPrompt = agent.description
    ? `你是 ${agent.name}。${agent.description}\n\n你有以下工具可以使用：执行命令(run_command)、读取文件(read_file)、写入文件(write_file)、HTTP请求(http_request)、搜索文件(search_files)。\n需要时主动使用工具获取信息或执行操作。回复使用 Markdown 格式，保持简洁专业。`
    : `你是 ${agent.name}，一个智能助手。你有工具可以使用：执行命令、读写文件、HTTP请求、搜索文件。需要时主动使用工具。回复使用 Markdown 格式，保持简洁专业。`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history
  ];

  // Phase 1: Tool use loop (non-streaming, with event callbacks)
  const { finalText, messages: updatedMessages } = await toolUseLoop(
    config, messages, config.model, onToolCall, onToolResult
  );

  // If tool loop returned text directly (no tools used, simple reply)
  if (finalText && !onToken) {
    return finalText;
  }

  // If we got final text but have a streaming callback, emit it
  if (finalText && onToken) {
    onToken(finalText);
    return finalText;
  }

  // Phase 2: Stream the final response after tool use
  const streamedText = await streamChatCompletion(config, updatedMessages, config.model, onToken);
  return streamedText;
}

/**
 * Process a message and generate AI replies from mentioned/all agents.
 * Streams tokens + tool events to UI via WebSocket.
 */
async function processMessage(db, wsManager, roomId, senderId, text, mentions = [], roomType = 'group', chainDepth = 0) {
  const roomSettings = db.getRoomSettings(roomId);
  const MAX_CHAIN_DEPTH = roomSettings.max_chain_depth || 5;
  if (chainDepth >= MAX_CHAIN_DEPTH) {
    console.log(`[AI] Chain depth ${chainDepth} reached max (${MAX_CHAIN_DEPTH}), stopping.`);
    return;
  }

  const members = await db.getRoomMembers(roomId);

  let respondingAgents = [];

  if (roomType === 'dm') {
    respondingAgents = members.filter(m => m.id !== senderId && m.id !== 'system' && m.id !== 'user');
  } else if (mentions.length > 0) {
    // First try to find mentioned agents in room members
    respondingAgents = members.filter(m => mentions.includes(m.id));
    // If some mentioned agents are not in the room, auto-add them (for chain collaboration)
    if (respondingAgents.length < mentions.length) {
      const allAgents = await db.listAgents();
      for (const mid of mentions) {
        if (!members.find(m => m.id === mid)) {
          const agent = allAgents.find(a => a.id === mid);
          if (agent && agent.status !== 'offline') {
            // Auto-add to room for collaboration
            try {
              await db.addMember(roomId, mid);
              respondingAgents.push(agent);
              console.log(`[AI] Auto-added ${agent.name} to room for chain collaboration`);
            } catch(e) {
              console.log(`[AI] Failed to auto-add ${mid}: ${e.message}`);
            }
          }
        }
      }
    }
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

    // Tell the agent about other members it can collaborate with
    if (roomType === 'group') {
      const allAgents = await db.listAgents();
      const otherAgents = allAgents.filter(a => a.id !== agent.id && a.id !== 'user' && a.status === 'online');
      if (otherAgents.length > 0) {
        const agentList = otherAgents.map(a => `@${a.name}（${a.description || '通用智能体'}）`).join('、');
        history.unshift({
          role: 'system',
          content: `[群聊环境] 当前可协作的其他智能体：${agentList}。如果用户的问题需要其他智能体的专长，可以在回复中 @他们的名字来请求协助。`
        });
      }
    }

    if (chainDepth > 0) {
      history.push({
        role: 'user',
        content: `[系统提示]: 你被 @提及了，请根据上下文回复。如果需要其他智能体协助，可以在回复中 @他们的名字。`
      });
    }

    const streamId = `stream_${Date.now()}_${agent.id.slice(0, 8)}`;

    // Get agent's model config
    let modelConfig = null;
    if (fullAgent.model_config_id) {
      modelConfig = db.getModelConfig(fullAgent.model_config_id);
    }
    if (!modelConfig) {
      modelConfig = db.getDefaultModelConfig();
    }

    // Notify UI: stream started
    if (wsManager) {
      wsManager.notifyUI({
        type: 'stream_start',
        stream_id: streamId,
        room_id: roomId,
        agent_id: agent.id,
        agent_name: agent.name || fullAgent.name
      });
    }

    // Callbacks for real-time tool events
    const callbacks = {
      onToken(chunk) {
        if (wsManager) {
          wsManager.notifyUI({
            type: 'stream_token',
            stream_id: streamId,
            room_id: roomId,
            agent_id: agent.id,
            chunk
          });
        }
      },
      onToolCall({ name, args, summary }) {
        if (wsManager) {
          wsManager.notifyUI({
            type: 'tool_call',
            stream_id: streamId,
            room_id: roomId,
            agent_id: agent.id,
            tool: name,
            args_summary: summary,
            timestamp: Date.now()
          });
        }
      },
      onToolResult({ name, ok, output }) {
        if (wsManager) {
          wsManager.notifyUI({
            type: 'tool_result',
            stream_id: streamId,
            room_id: roomId,
            agent_id: agent.id,
            tool: name,
            ok,
            output_preview: (output || '').slice(0, 200),
            timestamp: Date.now()
          });
        }
      }
    };

    // Run AI with tool use + streaming
    const reply = await chatCompletion(fullAgent, history, callbacks, modelConfig);

    // Notify UI: stream ended
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

    // Notify UI of final saved message
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
