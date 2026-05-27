const express = require('express');
const { getDatabase } = require('../db/index');
const { processMessage } = require('../ai/index');

const router = express.Router();

// Admin auth middleware
router.use((req, res, next) => {
  const secretKey = process.env.SECRET_KEY;
  if (!secretKey) {
    console.warn('[SECURITY] SECRET_KEY not set! Admin API is unprotected. Set SECRET_KEY in .env');
    return next();
  }
  if (secretKey === 'change-me-to-a-random-string') {
    console.warn('[SECURITY] SECRET_KEY is still the default value! Admin API is unprotected.');
    return next();
  }
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${secretKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// === Agents ===

router.get('/agents', async (req, res) => {
  const db = getDatabase();
  const agents = await db.listAgents();
  res.json({ ok: true, result: agents });
});

router.post('/agents', async (req, res) => {
  const db = getDatabase();
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }
  const agent = await db.createAgent(name, description || '');
  res.json({ ok: true, result: agent });
});

router.put('/agents/:id', async (req, res) => {
  const db = getDatabase();
  const { name, description, status, sort_order, model_config_id } = req.body;
  if (!name) {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }
  const fields = { name, description: description || '' };
  if (status !== undefined) fields.status = status;
  if (sort_order !== undefined) fields.sort_order = sort_order;
  if (model_config_id !== undefined) fields.model_config_id = model_config_id;
  await db.updateAgent(req.params.id, fields);
  res.json({ ok: true });
});

router.delete('/agents/:id', async (req, res) => {
  const db = getDatabase();
  await db.deleteAgent(req.params.id);
  res.json({ ok: true });
});

// === Rooms ===

router.get('/rooms', async (req, res) => {
  const db = getDatabase();
  const rooms = await db.listRooms();
  const result = [];
  for (const r of rooms) {
    const members = await db.getRoomMembers(r.id);
    // Get last message for preview
    const lastMsgs = await db.getRoomMessages(r.id, 1);
    const lastMsg = lastMsgs.length > 0 ? lastMsgs[lastMsgs.length - 1] : null;
    result.push({ ...r, members, last_message: lastMsg });
  }
  res.json({ ok: true, result });
});

router.post('/rooms', async (req, res) => {
  const db = getDatabase();
  const { name, description, type } = req.body;
  if (!name) {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }
  const room = await db.createRoom(name, description || '', type || 'group');
  res.json({ ok: true, result: room });
});

router.delete('/rooms/:id', async (req, res) => {
  const db = getDatabase();
  await db.deleteRoom(req.params.id);
  res.json({ ok: true });
});

// Room membership
router.post('/rooms/:id/members', async (req, res) => {
  const db = getDatabase();
  const { agent_id, agent_ids, role } = req.body;
  // Support batch addition
  const ids = agent_ids || (agent_id ? [agent_id] : []);
  if (ids.length === 0) {
    return res.status(400).json({ ok: false, error: 'agent_id or agent_ids is required' });
  }
  for (const id of ids) {
    await db.addMember(req.params.id, id, role || 'member');
  }
  res.json({ ok: true, added: ids.length });
});

router.delete('/rooms/:id/members/:agent_id', async (req, res) => {
  const db = getDatabase();
  await db.removeMember(req.params.id, req.params.agent_id);
  res.json({ ok: true });
});

// Room messages
router.get('/rooms/:id/messages', async (req, res) => {
  const db = getDatabase();
  const { limit, before_id } = req.query;
  const messages = await db.getRoomMessages(req.params.id, parseInt(limit) || 50, before_id ? parseInt(before_id) : null);
  res.json({ ok: true, result: messages });
});

// Clear room messages
router.delete('/rooms/:id/messages', async (req, res) => {
  const db = getDatabase();
  const roomId = req.params.id;
  // Delete all messages in this room
  if (db.driver === 'mysql') {
    await db.conn.execute('DELETE FROM messages WHERE room_id = ?', [roomId]);
  } else {
    db.conn.prepare('DELETE FROM messages WHERE room_id = ?').run(roomId);
  }
  res.json({ ok: true });
});

// Send message (user sends) — triggers AI reply
router.post('/rooms/:id/send', async (req, res) => {
  const db = getDatabase();
  const { text, mentions } = req.body;
  if (!text) {
    return res.status(400).json({ ok: false, error: 'text is required' });
  }

  // Ensure user agent exists
  let userAgent = await db.getAgentByKey('__user__');
  if (!userAgent) {
    if (db.db) {
      db.db.prepare(`INSERT OR IGNORE INTO agents (id, name, api_key, description, status) VALUES ('user', '我', '__user__', '用户', 'online')`).run();
    }
    userAgent = { id: 'user', name: '我' };
  }

  // Parse @mentions from text
  const parsedMentions = mentions || [];
  const mentionRegex = /@(\S+)/g;
  let match;
  if (!mentions || mentions.length === 0) {
    const agents = await db.listAgents();
    while ((match = mentionRegex.exec(text)) !== null) {
      const mentioned = agents.find(a => a.name === match[1]);
      if (mentioned) parsedMentions.push(mentioned.id);
    }
  }

  const message = await db.createMessage(req.params.id, userAgent.id, text, 'markdown', null, parsedMentions);

  // Get room type
  const room = await db.getRoom(req.params.id);
  const roomType = room?.type || 'group';

  res.json({ ok: true, result: message });

  // Trigger AI reply asynchronously
  const wsManager = req.app.get('wsManager');
  processMessage(db, wsManager, req.params.id, userAgent.id, text, parsedMentions, roomType).catch(err => {
    console.error('[AI] processMessage error:', err.message);
  });
});

// Legacy broadcast (admin sends as System)
router.post('/rooms/:id/broadcast', async (req, res) => {
  const db = getDatabase();
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ ok: false, error: 'text is required' });
  }

  let systemAgent = await db.getAgentByKey('__system__');
  if (!systemAgent) {
    if (db.db) {
      db.db.prepare(`INSERT OR IGNORE INTO agents (id, name, api_key, description, status) VALUES ('system', 'System', '__system__', 'System messages', 'online')`).run();
    }
    systemAgent = { id: 'system', name: 'System' };
  }

  const message = await db.createMessage(req.params.id, systemAgent.id, text, 'markdown');

  const members = await db.getRoomMembers(req.params.id);
  const wsManager = req.app.get('wsManager');
  for (const member of members) {
    await db.pushUpdate(member.id, 'message', {
      message_id: message.id,
      room_id: req.params.id,
      from: { id: 'system', name: 'System' },
      text,
      parse_mode: 'markdown',
      date: new Date().toISOString()
    });
    if (wsManager) {
      wsManager.notify(member.id, {
        type: 'message',
        message_id: message.id,
        room_id: req.params.id,
        from: { id: 'system', name: 'System' },
        text,
        parse_mode: 'markdown',
        date: new Date().toISOString()
      });
    }
  }

  res.json({ ok: true, result: message });
});

// === DM (Direct Messages) ===

// Create or get DM room with an agent
router.post('/dm/:agent_id', async (req, res) => {
  const db = getDatabase();
  const agentId = req.params.agent_id;
  
  // Check agent exists
  const agent = await db.getAgentById(agentId);
  if (!agent) {
    return res.status(404).json({ ok: false, error: 'Agent not found' });
  }

  // Ensure user agent exists
  let userAgent = await db.getAgentByKey('__user__');
  if (!userAgent) {
    if (db.db) {
      db.db.prepare(`INSERT OR IGNORE INTO agents (id, name, api_key, description, status) VALUES ('user', '我', '__user__', '用户', 'online')`).run();
    }
    userAgent = { id: 'user', name: '我' };
  }

  // Check if DM room already exists
  let dmRoom = await db.getDMRoom(userAgent.id, agentId);
  if (!dmRoom) {
    // Create DM room
    dmRoom = await db.createRoom(`DM: ${agent.name}`, '', 'dm');
    await db.addMember(dmRoom.id, userAgent.id, 'member');
    await db.addMember(dmRoom.id, agentId, 'member');
  }

  res.json({ ok: true, result: { room_id: dmRoom.id, agent } });
});

// List all DM rooms
router.get('/dms', async (req, res) => {
  const db = getDatabase();
  const dms = await db.listDMRooms();
  const result = [];
  for (const dm of dms) {
    const members = await db.getRoomMembers(dm.id);
    const lastMsgs = await db.getRoomMessages(dm.id, 1);
    const lastMsg = lastMsgs.length > 0 ? lastMsgs[lastMsgs.length - 1] : null;
    // Find the agent (non-user member)
    const agent = members.find(m => m.id !== 'user' && m.id !== 'system');
    result.push({ ...dm, members, agent, last_message: lastMsg });
  }
  res.json({ ok: true, result });
});

// === Model Metadata (litellm context window data) ===
let modelMetadataCache = null;
let modelMetadataCacheTime = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

async function getModelMetadata() {
  if (modelMetadataCache && (Date.now() - modelMetadataCacheTime < CACHE_TTL)) {
    return modelMetadataCache;
  }
  try {
    const resp = await fetch('https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json', {
      signal: AbortSignal.timeout(15000)
    });
    if (resp.ok) {
      const data = await resp.json();
      // Transform to a simpler format: { model_id: { max_input_tokens, max_output_tokens, provider, supports_vision, supports_function_calling } }
      const simplified = {};
      for (const [key, val] of Object.entries(data)) {
        if (key === 'sample_spec') continue;
        simplified[key] = {
          max_input_tokens: val.max_input_tokens || null,
          max_output_tokens: val.max_output_tokens || null,
          provider: val.litellm_provider || null,
          supports_vision: !!val.supports_vision,
          supports_function_calling: !!val.supports_function_calling
        };
      }
      modelMetadataCache = simplified;
      modelMetadataCacheTime = Date.now();
      return simplified;
    }
  } catch(e) {
    console.error('[Models] Failed to fetch litellm metadata:', e.message);
  }
  return modelMetadataCache || {};
}

// Get model info by ID (or search)
router.get('/models/metadata', async (req, res) => {
  const metadata = await getModelMetadata();
  const { q, id } = req.query;
  if (id) {
    // Exact match or fuzzy match
    const exact = metadata[id];
    if (exact) return res.json({ ok: true, result: { [id]: exact } });
    // Try partial match
    const matches = {};
    for (const [key, val] of Object.entries(metadata)) {
      if (key.includes(id)) matches[key] = val;
      if (Object.keys(matches).length >= 20) break;
    }
    return res.json({ ok: true, result: matches });
  }
  if (q) {
    // Search models by name
    const query = q.toLowerCase();
    const matches = {};
    for (const [key, val] of Object.entries(metadata)) {
      if (key.toLowerCase().includes(query)) matches[key] = val;
      if (Object.keys(matches).length >= 50) break;
    }
    return res.json({ ok: true, result: matches });
  }
  // Return count only if no query
  res.json({ ok: true, total: Object.keys(metadata).length });
});

// === Model Configs ===
router.get('/models', async (req, res) => {
  const db = getDatabase();
  const configs = db.listModelConfigs();
  // Mask API keys in response
  const safe = configs.map(c => ({ ...c, api_key: c.api_key ? '***' + c.api_key.slice(-4) : '' }));
  res.json({ ok: true, result: safe });
});

router.post('/models', async (req, res) => {
  const db = getDatabase();
  const { name, provider, base_url, api_key, model, max_tokens, temperature, is_default } = req.body;
  if (!name || !provider || !base_url || !api_key || !model) {
    return res.status(400).json({ error: 'name, provider, base_url, api_key, model required' });
  }
  const config = db.createModelConfig({ name, provider, base_url, api_key, model, max_tokens, temperature, is_default });
  res.json({ ok: true, result: config });
});

router.put('/models/:id', async (req, res) => {
  const db = getDatabase();
  db.updateModelConfig(req.params.id, req.body);
  res.json({ ok: true });
});

router.delete('/models/:id', async (req, res) => {
  const db = getDatabase();
  db.deleteModelConfig(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
