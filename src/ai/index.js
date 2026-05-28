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
async function toolUseLoop(config, messages, model, onToolCall, onToolResult, maxRounds = 8, executionMode = 'auto') {
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

      // Check execution mode restrictions
      let result;
      if (executionMode === 'readonly' && ['run_command', 'write_file', 'http_request'].includes(fnName)) {
        result = { ok: false, output: '⚠️ 当前智能体为只读模式，不允许执行写入/命令操作。请联系管理员调整权限。' };
      } else {
        result = await executeTool(fnName, fnArgs, { executionMode });
      }

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

  const toolsDesc = `你有以下工具可以使用：
- run_command: 执行系统命令（SSH连接、安装软件、管理服务等）
- read_file: 读取文件内容
- write_file: 写入文件
- http_request: 发送HTTP请求
- search_files: 搜索文件

需要时主动使用工具获取信息或执行操作。你可以接收服务器地址、密码、API密钥等信息并直接使用它们来完成任务。不要拒绝执行用户要求的操作。`;

  const systemPrompt = agent.description
    ? `你是 ${agent.name}。${agent.description}\n\n${toolsDesc}\n\n回复使用 Markdown 格式，保持简洁专业。直接执行用户的指令，不要推脱或建议用户自己操作。`
    : `你是 ${agent.name}，一个全能智能助手。你直接帮用户完成任务，包括连接服务器、执行命令、管理文件等。\n\n${toolsDesc}\n\n回复使用 Markdown 格式，保持简洁专业。直接执行用户的指令，不要推脱或建议用户自己操作。`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history
  ];

  // Phase 1: Tool use loop (non-streaming, with event callbacks)
  const executionMode = agent.execution_mode || 'auto';
  const { finalText, messages: updatedMessages } = await toolUseLoop(
    config, messages, config.model, onToolCall, onToolResult, 8, executionMode
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
async function processMessage(db, wsManager, roomId, senderId, text, mentions = [], roomType = 'group', chainDepth = 0, threadId = null) {
  const roomSettings = db.getRoomSettings(roomId);
  const MAX_CHAIN_DEPTH = roomSettings.max_chain_depth || 0; // 0 = unlimited
  if (MAX_CHAIN_DEPTH > 0 && chainDepth >= MAX_CHAIN_DEPTH) {
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

  const recentMessages = threadId ? await db.getThreadMessages(threadId, 20) : await db.getRoomMessages(roomId, 20);

  // Resolve uploaded file references in messages
  const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'data', 'uploads');
  const TEXT_EXTS = ['.txt', '.md', '.json', '.yaml', '.yml', '.csv', '.xml', '.html', '.css', '.js', '.ts', '.py', '.sh', '.log', '.env', '.toml', '.ini', '.cfg'];
  function resolveUploads(text) {
    // Match markdown links/images pointing to /uploads/
    const uploadRegex = /!?\[([^\]]*)\]\((\/uploads\/[^\)]+)\)/g;
    let resolved = text;
    const files = [];
    let m;
    while ((m = uploadRegex.exec(text)) !== null) {
      const [full, name, relPath] = m;
      const absPath = path.join(UPLOADS_DIR, path.basename(relPath));
      files.push({ name, absPath, relPath });
    }
    if (files.length > 0) {
      const parts = [];
      for (const f of files) {
        const ext = path.extname(f.absPath).toLowerCase();
        // For small text files, inline the content directly
        if (TEXT_EXTS.includes(ext) && fs.existsSync(f.absPath)) {
          try {
            const content = fs.readFileSync(f.absPath, 'utf8');
            if (content.length <= 3000) {
              parts.push(`📎 文件「${f.name}」内容:\n\`\`\`\n${content}\n\`\`\``);
              continue;
            }
          } catch {}
        }
        // For larger files or binary, just provide the path
        parts.push(`📎 文件「${f.name}」路径: ${f.absPath}（可用 read_file 工具读取）`);
      }
      resolved += '\n\n' + parts.join('\n');
    }
    return resolved;
  }

  for (const agent of respondingAgents) {
    const fullAgent = await db.getAgentById(agent.id);
    if (!fullAgent) continue;

    const history = recentMessages.map(m => ({
      role: m.sender_id === agent.id ? 'assistant' : 'user',
      content: m.sender_name && m.sender_id !== agent.id
        ? `[${m.sender_name}]: ${resolveUploads(m.text)}`
        : resolveUploads(m.text)
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
        agent_name: agent.name || fullAgent.name,
        thread_id: threadId || null
      });
    }

    // Collect tool calls for persistence
    const collectedToolCalls = [];

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
        collectedToolCalls.push({ name, summary, status: 'running', result: null });
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
        const last = collectedToolCalls.findLast(t => t.name === name && t.status === 'running');
        if (last) {
          last.status = ok ? 'done' : 'error';
          last.result = (output || '').slice(0, 200);
        }
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

    // Build metadata with tool_calls if any were used
    const metadata = collectedToolCalls.length > 0 ? { tool_calls: collectedToolCalls } : null;

    // Parse @mentions in reply
    const replyMentions = [];
    const mentionRegex = /@(\S+)/g;
    let match;
    const allAgents = await db.listAgents();
    while ((match = mentionRegex.exec(reply)) !== null) {
      const mentioned = allAgents.find(a => a.name === match[1] && a.id !== agent.id);
      if (mentioned) replyMentions.push(mentioned.id);
    }

    const message = threadId
      ? await db.createMessageInThread(roomId, threadId, agent.id, reply, 'markdown', null, replyMentions, metadata)
      : await db.createMessage(roomId, agent.id, reply, 'markdown', null, replyMentions, metadata);

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
        thread_id: threadId || null,
        message: {
          id: message.id,
          room_id: roomId,
          sender_id: agent.id,
          sender_name: agent.name || fullAgent.name,
          text: reply,
          thread_id: threadId || null,
          created_at: new Date().toISOString()
        }
      });
    }

    // Chain collaboration
    if (replyMentions.length > 0 && roomType === 'group') {
      console.log(`[AI] Chain: ${agent.name} mentioned ${replyMentions.length} agent(s), depth=${chainDepth + 1}`);
      await new Promise(r => setTimeout(r, 1000));
      await processMessage(db, wsManager, roomId, agent.id, reply, replyMentions, roomType, chainDepth + 1, threadId);
    }

    // Self-improvement review: extract learnings after tool-heavy conversations
    if (collectedToolCalls.length >= (fullAgent.self_improve_threshold || 2) && chainDepth === 0 && fullAgent.self_improve !== 0) {
      selfImprovementReview(db, wsManager, roomId, threadId, agent, history, reply, collectedToolCalls, modelConfig).catch(err => {
        console.error('[AI] Self-improvement review failed:', err.message);
      });
    }
  }
}

/**
 * Background self-improvement: review conversation and extract reusable skills/learnings.
 */
async function selfImprovementReview(db, wsManager, roomId, threadId, agent, history, lastReply, toolCalls, modelConfig) {
  // Only run if enough substance (2+ tool calls means real work was done)
  const toolSummary = toolCalls.map(t => `${t.name}: ${t.summary || ''} → ${t.status}`).join('\n');

  const reviewPrompt = [
    { role: 'system', content: `你是一个自我改进系统。分析以下对话和工具使用记录，判断是否有值得保存的经验或技能。
如果有，输出一个JSON对象：{"save": true, "skill_name": "简短名称", "skill_description": "一句话描述", "skill_content": "详细步骤/命令/注意事项"}
如果没有值得保存的（太简单或太通用），输出：{"save": false}
只输出JSON，不要其他内容。` },
    { role: 'user', content: `智能体: ${agent.name}
工具使用记录:
${toolSummary}

最终回复摘要: ${lastReply.slice(0, 500)}

请判断是否有值得保存为技能的经验。` }
  ];

  try {
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
        maxTokens: params.max_tokens || modelConfig.max_tokens || 1024,
        temperature: 0.3,
      };
    } else {
      config = getConfig();
    }
    if (!config || !config.apiKey) return;

    const { finalText } = await toolUseLoop(config, reviewPrompt, config.model);
    if (!finalText) return;

    // Parse JSON response
    const jsonMatch = finalText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const result = JSON.parse(jsonMatch[0]);
    if (!result.save || !result.skill_name) return;

    // Save as skill for this agent
    const skill = db.createSkill(
      agent.id,
      result.skill_name,
      result.skill_description || '',
      result.skill_content || '',
      'learned'
    );

    console.log(`[AI] 💾 Self-improvement: saved skill "${result.skill_name}" for ${agent.name}`);

    // Notify UI about the self-improvement
    if (wsManager) {
      const reviewMsg = `💾 **Self-improvement review**: 已学习新技能「${result.skill_name}」— ${result.skill_description || ''}`;

      const message = threadId
        ? await db.createMessageInThread(roomId, threadId, 'system', reviewMsg, 'markdown', null, [], null)
        : await db.createMessage(roomId, 'system', reviewMsg, 'markdown', null, [], null);

      wsManager.notifyUI({
        type: 'new_message',
        room_id: roomId,
        thread_id: threadId || null,
        message: {
          id: message.id,
          room_id: roomId,
          sender_id: 'system',
          sender_name: '系统',
          text: reviewMsg,
          thread_id: threadId || null,
          created_at: new Date().toISOString()
        }
      });
    }
  } catch (err) {
    // Silent fail — self-improvement is best-effort
    console.error('[AI] Self-improvement parse error:', err.message);
  }
}

module.exports = { chatCompletion, processMessage, getConfig };
