const express = require('express');
const { getDatabase } = require('../db/index');
const { processMessage } = require('../ai/index');

const router = express.Router();

// Admin auth middleware
router.use((req, res, next) => {
  const secretKey = process.env.SECRET_KEY;
  if (!secretKey || secretKey === 'change-me-to-a-random-string') {
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
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }
  await db.updateAgent(req.params.id, name, description || '');
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
  const { agent_id, role } = req.body;
  if (!agent_id) {
    return res.status(400).json({ ok: false, error: 'agent_id is required' });
  }
  await db.addMember(req.params.id, agent_id, role || 'member');
  res.json({ ok: true });
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

module.exports = router;
