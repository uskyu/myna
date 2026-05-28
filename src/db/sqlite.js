const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const DatabaseAdapter = require('./adapter');

class SQLiteAdapter extends DatabaseAdapter {
  constructor(dataDir) {
    super();
    const dbPath = path.join(dataDir, 'hermes-hub.sqlite');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._migrate();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_key TEXT UNIQUE NOT NULL,
        description TEXT DEFAULT '',
        avatar TEXT DEFAULT '',
        status TEXT DEFAULT 'offline',
        container_id TEXT DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        type TEXT DEFAULT 'group',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS room_members (
        room_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (room_id, agent_id),
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        text TEXT NOT NULL,
        parse_mode TEXT DEFAULT 'markdown',
        reply_to_message_id INTEGER DEFAULT NULL,
        mentions TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        FOREIGN KEY (sender_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        consumed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, id);
      CREATE INDEX IF NOT EXISTS idx_updates_agent ON updates(agent_id, consumed, id);
      CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key);

      CREATE TABLE IF NOT EXISTS model_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        model TEXT NOT NULL,
        max_tokens INTEGER DEFAULT 2048,
        temperature REAL DEFAULT 0.7,
        is_default INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Add model_config_id column to agents if not exists
    try { this.db.prepare(`ALTER TABLE agents ADD COLUMN model_config_id TEXT`).run(); } catch(e) {}
    // Add params_json column to model_configs if not exists
    try { this.db.prepare(`ALTER TABLE model_configs ADD COLUMN params_json TEXT`).run(); } catch(e) {}
    // Add metadata column to messages for tool_calls persistence
    try { this.db.prepare(`ALTER TABLE messages ADD COLUMN metadata TEXT DEFAULT NULL`).run(); } catch(e) {}
    try {
      this.db.prepare(`ALTER TABLE agents ADD COLUMN model_config_id TEXT DEFAULT NULL`).run();
    } catch (e) {
      // Column already exists, ignore
    }
    // Agent config fields: execution_mode, self_improve, tools_config
    try { this.db.prepare(`ALTER TABLE agents ADD COLUMN execution_mode TEXT DEFAULT 'auto'`).run(); } catch(e) {}
    try { this.db.prepare(`ALTER TABLE agents ADD COLUMN self_improve INTEGER DEFAULT 1`).run(); } catch(e) {}
    try { this.db.prepare(`ALTER TABLE agents ADD COLUMN self_improve_threshold INTEGER DEFAULT 2`).run(); } catch(e) {}
    try { this.db.prepare(`ALTER TABLE agents ADD COLUMN tools_config TEXT DEFAULT NULL`).run(); } catch(e) {}
    // Add settings_json column to rooms if not exists
    try { this.db.prepare(`ALTER TABLE rooms ADD COLUMN settings_json TEXT DEFAULT '{}'`).run(); } catch(e) {}

    // === Thread system ===
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        workflow_id TEXT DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_threads_room ON threads(room_id, created_at DESC);
    `);

    // Add thread_id column to messages if not exists
    try { this.db.prepare(`ALTER TABLE messages ADD COLUMN thread_id TEXT DEFAULT NULL`).run(); } catch(e) {}

    // === Workflow system ===
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        steps_json TEXT NOT NULL,
        trigger_type TEXT DEFAULT 'manual',
        trigger_config TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        current_step INTEGER DEFAULT 0,
        context_json TEXT DEFAULT '{}',
        started_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT DEFAULT NULL,
        FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_skills (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        content TEXT DEFAULT '',
        file_type TEXT DEFAULT 'text',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );
    `);
  }

  createAgent(name, description = '') {
    const id = uuidv4();
    const api_key = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
    this.db.prepare(`INSERT INTO agents (id, name, api_key, description) VALUES (?, ?, ?, ?)`)
      .run(id, name, api_key, description);
    return { id, name, api_key, description };
  }

  getAgentByKey(api_key) {
    return this.db.prepare(`SELECT * FROM agents WHERE api_key = ?`).get(api_key);
  }

  getAgentById(id) {
    return this.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(id);
  }

  listAgents() {
    return this.db.prepare(`SELECT id, name, description, avatar, status, container_id, model_config_id, execution_mode, self_improve, self_improve_threshold, tools_config, created_at FROM agents`).all();
  }

  updateAgentStatus(id, status) {
    this.db.prepare(`UPDATE agents SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  }

  updateAgentContainer(id, container_id) {
    this.db.prepare(`UPDATE agents SET container_id = ?, updated_at = datetime('now') WHERE id = ?`).run(container_id, id);
  }

  deleteAgent(id) {
    this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
  }

  createRoom(name, description = '', type = 'group') {
    const id = uuidv4();
    this.db.prepare(`INSERT INTO rooms (id, name, description, type) VALUES (?, ?, ?, ?)`)
      .run(id, name, description, type);
    return { id, name, description, type };
  }

  getRoom(id) {
    return this.db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(id);
  }

  listRooms() {
    return this.db.prepare(`SELECT * FROM rooms`).all();
  }

  deleteRoom(id) {
    this.db.prepare(`DELETE FROM rooms WHERE id = ?`).run(id);
  }

  getRoomSettings(roomId) {
    const row = this.db.prepare(`SELECT settings_json FROM rooms WHERE id = ?`).get(roomId);
    try {
      return JSON.parse(row?.settings_json || '{}');
    } catch {
      return {};
    }
  }

  updateRoomSettings(roomId, settings) {
    const current = this.getRoomSettings(roomId);
    const merged = { ...current, ...settings };
    this.db.prepare(`UPDATE rooms SET settings_json = ? WHERE id = ?`).run(JSON.stringify(merged), roomId);
    return merged;
  }

  addMember(room_id, agent_id, role = 'member') {
    this.db.prepare(`INSERT OR IGNORE INTO room_members (room_id, agent_id, role) VALUES (?, ?, ?)`)
      .run(room_id, agent_id, role);
  }

  removeMember(room_id, agent_id) {
    this.db.prepare(`DELETE FROM room_members WHERE room_id = ? AND agent_id = ?`)
      .run(room_id, agent_id);
  }

  getRoomMembers(room_id) {
    return this.db.prepare(`
      SELECT a.id, a.name, a.status, rm.role 
      FROM room_members rm 
      JOIN agents a ON a.id = rm.agent_id 
      WHERE rm.room_id = ?
    `).all(room_id);
  }

  getAgentRooms(agent_id) {
    return this.db.prepare(`
      SELECT r.* FROM rooms r
      JOIN room_members rm ON rm.room_id = r.id
      WHERE rm.agent_id = ?
    `).all(agent_id);
  }

  createMessage(room_id, sender_id, text, parse_mode = 'markdown', reply_to = null, mentions = [], metadata = null) {
    const result = this.db.prepare(`
      INSERT INTO messages (room_id, sender_id, text, parse_mode, reply_to_message_id, mentions, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(room_id, sender_id, text, parse_mode, reply_to, JSON.stringify(mentions), metadata ? JSON.stringify(metadata) : null);
    return { id: Number(result.lastInsertRowid), room_id, sender_id, text, parse_mode, reply_to_message_id: reply_to, mentions, metadata };
  }

  getRoomMessages(room_id, limit = 50, before_id = null) {
    if (before_id) {
      return this.db.prepare(`
        SELECT m.*, a.name as sender_name FROM messages m
        JOIN agents a ON a.id = m.sender_id
        WHERE m.room_id = ? AND m.id < ?
        ORDER BY m.id DESC LIMIT ?
      `).all(room_id, before_id, limit).reverse();
    }
    return this.db.prepare(`
      SELECT m.*, a.name as sender_name FROM messages m
      JOIN agents a ON a.id = m.sender_id
      WHERE m.room_id = ?
      ORDER BY m.id DESC LIMIT ?
    `).all(room_id, limit).reverse();
  }

  clearRoomMessages(room_id) {
    this.db.prepare(`DELETE FROM messages WHERE room_id = ?`).run(room_id);
  }

  pushUpdate(agent_id, type, payload) {
    this.db.prepare(`INSERT INTO updates (agent_id, type, payload) VALUES (?, ?, ?)`)
      .run(agent_id, type, JSON.stringify(payload));
  }

  getUpdates(agent_id, offset = 0, limit = 100) {
    const rows = this.db.prepare(`
      SELECT * FROM updates 
      WHERE agent_id = ? AND consumed = 0 AND id > ?
      ORDER BY id ASC LIMIT ?
    `).all(agent_id, offset, limit);

    if (rows.length > 0) {
      const maxId = rows[rows.length - 1].id;
      this.db.prepare(`UPDATE updates SET consumed = 1 WHERE agent_id = ? AND id <= ?`)
        .run(agent_id, maxId);
    }

    return rows.map(r => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  cleanupUpdates() {
    this.db.prepare(`DELETE FROM updates WHERE consumed = 1 AND created_at < datetime('now', '-1 hour')`).run();
  }

  // Update agent name/description/status/model_config_id
  updateAgent(id, fields) {
    const sets = [];
    const vals = [];
    if (fields.name !== undefined) { sets.push('name = ?'); vals.push(fields.name); }
    if (fields.description !== undefined) { sets.push('description = ?'); vals.push(fields.description); }
    if (fields.status !== undefined) { sets.push('status = ?'); vals.push(fields.status); }
    if (fields.model_config_id !== undefined) { sets.push('model_config_id = ?'); vals.push(fields.model_config_id || null); }
    if (fields.sort_order !== undefined) { sets.push('container_id = ?'); vals.push(String(fields.sort_order)); }
    if (fields.execution_mode !== undefined) { sets.push('execution_mode = ?'); vals.push(fields.execution_mode); }
    if (fields.self_improve !== undefined) { sets.push('self_improve = ?'); vals.push(fields.self_improve); }
    if (fields.self_improve_threshold !== undefined) { sets.push('self_improve_threshold = ?'); vals.push(fields.self_improve_threshold); }
    if (fields.tools_config !== undefined) { sets.push('tools_config = ?'); vals.push(fields.tools_config); }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    this.db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  // Get DM room between two agents
  getDMRoom(userId, agentId) {
    return this.db.prepare(`
      SELECT r.* FROM rooms r
      WHERE r.type = 'dm'
      AND EXISTS (SELECT 1 FROM room_members rm1 WHERE rm1.room_id = r.id AND rm1.agent_id = ?)
      AND EXISTS (SELECT 1 FROM room_members rm2 WHERE rm2.room_id = r.id AND rm2.agent_id = ?)
    `).get(userId, agentId);
  }

  // List all DM rooms
  listDMRooms() {
    return this.db.prepare(`SELECT * FROM rooms WHERE type = 'dm'`).all();
  }

  // === Model Configs ===
  createModelConfig(config) {
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO model_configs (id, name, provider, base_url, api_key, model, max_tokens, temperature, is_default, params_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, config.name, config.provider, config.base_url, config.api_key, config.model, config.max_tokens || 2048, config.temperature || 0.7, config.is_default ? 1 : 0, config.params_json || null);
    if (config.is_default) {
      this.db.prepare(`UPDATE model_configs SET is_default = 0 WHERE id != ?`).run(id);
    }
    return { id, ...config };
  }

  listModelConfigs() {
    return this.db.prepare(`SELECT * FROM model_configs ORDER BY is_default DESC, created_at ASC`).all();
  }

  getModelConfig(id) {
    return this.db.prepare(`SELECT * FROM model_configs WHERE id = ?`).get(id);
  }

  getDefaultModelConfig() {
    return this.db.prepare(`SELECT * FROM model_configs WHERE is_default = 1`).get();
  }

  updateModelConfig(id, fields) {
    const sets = [];
    const vals = [];
    for (const [key, val] of Object.entries(fields)) {
      if (['name', 'provider', 'base_url', 'api_key', 'model', 'params_json'].includes(key)) {
        sets.push(`${key} = ?`); vals.push(val);
      } else if (key === 'max_tokens') {
        sets.push('max_tokens = ?'); vals.push(val);
      } else if (key === 'temperature') {
        sets.push('temperature = ?'); vals.push(val);
      } else if (key === 'is_default' && val) {
        sets.push('is_default = 1');
        this.db.prepare(`UPDATE model_configs SET is_default = 0 WHERE id != ?`).run(id);
      }
    }
    if (sets.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE model_configs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  deleteModelConfig(id) {
    this.db.prepare(`DELETE FROM model_configs WHERE id = ?`).run(id);
    // Clear agents referencing this config
    this.db.prepare(`UPDATE agents SET model_config_id = NULL WHERE model_config_id = ?`).run(id);
  }

  // === Threads ===
  createThread(roomId, title, workflowId = null) {
    const id = uuidv4();
    this.db.prepare(`INSERT INTO threads (id, room_id, title, workflow_id) VALUES (?, ?, ?, ?)`).run(id, roomId, title, workflowId);
    return this.db.prepare(`SELECT * FROM threads WHERE id = ?`).get(id);
  }

  getThreads(roomId) {
    return this.db.prepare(`SELECT * FROM threads WHERE room_id = ? ORDER BY updated_at DESC`).all(roomId);
  }

  getThread(threadId) {
    return this.db.prepare(`SELECT * FROM threads WHERE id = ?`).get(threadId);
  }

  updateThread(threadId, fields) {
    const sets = [];
    const vals = [];
    if (fields.title !== undefined) { sets.push('title = ?'); vals.push(fields.title); }
    if (fields.status !== undefined) { sets.push('status = ?'); vals.push(fields.status); }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    vals.push(threadId);
    this.db.prepare(`UPDATE threads SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  deleteThread(threadId) {
    this.db.prepare(`DELETE FROM messages WHERE thread_id = ?`).run(threadId);
    this.db.prepare(`DELETE FROM threads WHERE id = ?`).run(threadId);
  }

  getThreadMessages(threadId, limit = 30) {
    return this.db.prepare(`
      SELECT m.*, a.name as sender_name FROM messages m
      JOIN agents a ON a.id = m.sender_id
      WHERE m.thread_id = ?
      ORDER BY m.id DESC LIMIT ?
    `).all(threadId, limit).reverse();
  }

  createMessageInThread(roomId, threadId, senderId, text, parseMode = 'markdown', replyTo = null, mentions = [], metadata = null) {
    const result = this.db.prepare(`
      INSERT INTO messages (room_id, sender_id, text, parse_mode, reply_to_message_id, mentions, thread_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(roomId, senderId, text, parseMode, replyTo, JSON.stringify(mentions), threadId, metadata ? JSON.stringify(metadata) : null);
    // Touch thread updated_at
    this.db.prepare(`UPDATE threads SET updated_at = datetime('now') WHERE id = ?`).run(threadId);
    return { id: Number(result.lastInsertRowid), room_id: roomId, sender_id: senderId, text, parse_mode: parseMode, reply_to_message_id: replyTo, mentions, thread_id: threadId, metadata };
  }

  // === Workflows ===
  createWorkflow(roomId, name, description, stepsJson, triggerType = 'manual', triggerConfig = '{}') {
    const id = uuidv4();
    this.db.prepare(`INSERT INTO workflows (id, room_id, name, description, steps_json, trigger_type, trigger_config) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, roomId, name, description || '', typeof stepsJson === 'string' ? stepsJson : JSON.stringify(stepsJson), triggerType, typeof triggerConfig === 'string' ? triggerConfig : JSON.stringify(triggerConfig));
    return this.db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(id);
  }

  getWorkflows(roomId) {
    return this.db.prepare(`SELECT * FROM workflows WHERE room_id = ? ORDER BY created_at DESC`).all(roomId);
  }

  getWorkflow(workflowId) {
    return this.db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(workflowId);
  }

  updateWorkflow(workflowId, fields) {
    const sets = [];
    const vals = [];
    if (fields.name !== undefined) { sets.push('name = ?'); vals.push(fields.name); }
    if (fields.description !== undefined) { sets.push('description = ?'); vals.push(fields.description); }
    if (fields.steps_json !== undefined) { sets.push('steps_json = ?'); vals.push(typeof fields.steps_json === 'string' ? fields.steps_json : JSON.stringify(fields.steps_json)); }
    if (fields.trigger_type !== undefined) { sets.push('trigger_type = ?'); vals.push(fields.trigger_type); }
    if (fields.trigger_config !== undefined) { sets.push('trigger_config = ?'); vals.push(typeof fields.trigger_config === 'string' ? fields.trigger_config : JSON.stringify(fields.trigger_config)); }
    if (sets.length === 0) return;
    vals.push(workflowId);
    this.db.prepare(`UPDATE workflows SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  deleteWorkflow(workflowId) {
    this.db.prepare(`DELETE FROM workflow_runs WHERE workflow_id = ?`).run(workflowId);
    this.db.prepare(`DELETE FROM workflows WHERE id = ?`).run(workflowId);
  }

  createWorkflowRun(workflowId, threadId) {
    const id = uuidv4();
    this.db.prepare(`INSERT INTO workflow_runs (id, workflow_id, thread_id) VALUES (?, ?, ?)`).run(id, workflowId, threadId);
    return this.db.prepare(`SELECT * FROM workflow_runs WHERE id = ?`).get(id);
  }

  getWorkflowRun(runId) {
    return this.db.prepare(`SELECT * FROM workflow_runs WHERE id = ?`).get(runId);
  }

  updateWorkflowRun(runId, fields) {
    const sets = [];
    const vals = [];
    if (fields.status !== undefined) { sets.push('status = ?'); vals.push(fields.status); }
    if (fields.current_step !== undefined) { sets.push('current_step = ?'); vals.push(fields.current_step); }
    if (fields.context_json !== undefined) { sets.push('context_json = ?'); vals.push(typeof fields.context_json === 'string' ? fields.context_json : JSON.stringify(fields.context_json)); }
    if (fields.completed_at !== undefined) { sets.push('completed_at = ?'); vals.push(fields.completed_at); }
    if (sets.length === 0) return;
    vals.push(runId);
    this.db.prepare(`UPDATE workflow_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  getWorkflowRunCount(workflowId) {
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM workflow_runs WHERE workflow_id = ?`).get(workflowId);
    return row ? row.cnt : 0;
  }

  getWorkflowRuns(workflowId) {
    return this.db.prepare(`SELECT id, workflow_id, thread_id, status, current_step, started_at, completed_at FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC`).all(workflowId);
  }

  // === Agent Skills ===
  getAgentSkills(agentId) {
    return this.db.prepare(`SELECT * FROM agent_skills WHERE agent_id = ? ORDER BY created_at ASC`).all(agentId);
  }

  getAllSkills() {
    return this.db.prepare(`SELECT s.*, a.name as agent_name FROM agent_skills s LEFT JOIN agents a ON s.agent_id = a.id ORDER BY s.created_at DESC`).all();
  }

  getSkillById(skillId) {
    return this.db.prepare(`SELECT * FROM agent_skills WHERE id = ?`).get(skillId);
  }

  createSkill(agentId, name, description = '', content = '', fileType = 'text') {
    const id = uuidv4();
    this.db.prepare(`INSERT INTO agent_skills (id, agent_id, name, description, content, file_type) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, agentId, name, description, content, fileType);
    return this.db.prepare(`SELECT * FROM agent_skills WHERE id = ?`).get(id);
  }

  updateSkill(skillId, fields) {
    const sets = [];
    const vals = [];
    if (fields.name !== undefined) { sets.push('name = ?'); vals.push(fields.name); }
    if (fields.description !== undefined) { sets.push('description = ?'); vals.push(fields.description); }
    if (fields.content !== undefined) { sets.push('content = ?'); vals.push(fields.content); }
    if (fields.file_type !== undefined) { sets.push('file_type = ?'); vals.push(fields.file_type); }
    sets.push("updated_at = datetime('now')");
    if (sets.length === 0) return;
    vals.push(skillId);
    this.db.prepare(`UPDATE agent_skills SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return this.db.prepare(`SELECT * FROM agent_skills WHERE id = ?`).get(skillId);
  }

  deleteSkill(skillId) {
    this.db.prepare(`DELETE FROM agent_skills WHERE id = ?`).run(skillId);
  }

  copySkillToAgent(skillId, targetAgentId) {
    const skill = this.getSkillById(skillId);
    if (!skill) return null;
    return this.createSkill(targetAgentId, skill.name, skill.description, skill.content, skill.file_type);
  }

  close() {
    this.db.close();
  }
}

module.exports = SQLiteAdapter;
