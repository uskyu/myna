/**
 * AI Reply Module
 * Handles LLM API calls for agent responses.
 * Reads config from ~/.hermes/config.yaml and .env
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

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
 * Call LLM API with chat completions format
 * @param {Object} agent - { id, name, description }
 * @param {Array} messages - conversation history [{role, content, name?}]
 * @param {Object} options - { maxTokens }
 * @returns {string|null} - AI response text or null on failure
 */
async function chatCompletion(agent, messages, options = {}) {
  const config = getConfig();
  if (!config || !config.apiKey) {
    console.error('[AI] No API config found');
    return null;
  }

  const systemPrompt = agent.description
    ? `你是 ${agent.name}。${agent.description}\n\n请用中文回复，保持简洁友好。`
    : `你是 ${agent.name}，一个智能助手。请用中文回复，保持简洁友好。`;

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    max_tokens: options.maxTokens || 1024,
    temperature: 0.7
  };

  try {
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
      return null;
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    return content || null;
  } catch (e) {
    console.error('[AI] Request failed:', e.message);
    return null;
  }
}

/**
 * Process a message and generate AI replies from mentioned/all agents
 * @param {Object} db - database instance
 * @param {Object} wsManager - WebSocket manager
 * @param {string} roomId - room where message was sent
 * @param {string} senderId - who sent the message (usually 'user' or 'system')
 * @param {string} text - message text
 * @param {Array} mentions - array of agent IDs that were @mentioned
 * @param {string} roomType - 'group' or 'dm'
 */
async function processMessage(db, wsManager, roomId, senderId, text, mentions = [], roomType = 'group') {
  const members = await db.getRoomMembers(roomId);
  
  // Determine which agents should reply
  let respondingAgents = [];
  
  if (roomType === 'dm') {
    // In DM, the agent always replies
    respondingAgents = members.filter(m => m.id !== senderId && m.id !== 'system' && m.id !== 'user');
  } else if (mentions.length > 0) {
    // In group, only mentioned agents reply
    respondingAgents = members.filter(m => mentions.includes(m.id));
  } else {
    // In group with no mentions, all agents reply (can be changed to none if preferred)
    respondingAgents = members.filter(m => m.id !== senderId && m.id !== 'system' && m.id !== 'user');
  }

  if (respondingAgents.length === 0) return;

  // Get recent message history for context
  const recentMessages = await db.getRoomMessages(roomId, 20);
  
  // For each responding agent, call LLM
  for (const agent of respondingAgents) {
    const fullAgent = await db.getAgentById(agent.id);
    if (!fullAgent) continue;

    // Build conversation history
    const history = recentMessages.map(m => ({
      role: m.sender_id === agent.id ? 'assistant' : 'user',
      content: m.sender_name && m.sender_id !== agent.id
        ? `[${m.sender_name}]: ${m.text}`
        : m.text
    }));

    // Call LLM
    const reply = await chatCompletion(fullAgent, history);
    if (!reply) continue;

    // Save agent's reply as a message
    const message = await db.createMessage(roomId, agent.id, reply, 'markdown');

    // Notify all room members via WebSocket
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
  }
}

module.exports = { chatCompletion, processMessage, getConfig };
