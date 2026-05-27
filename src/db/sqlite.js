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
    try {
      this.db.prepare(`ALTER TABLE agents ADD COLUMN model_config_id TEXT DEFAULT NULL`).run();
    } catch (e) {
      // Column already exists, ignore
    }
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
    return this.db.prepare(`SELECT id, name, description, avatar, status, container_id, model_config_id, created_at FROM agents`).all();
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

  createMessage(room_id, sender_id, text, parse_mode = 'markdown', reply_to = null, mentions = []) {
    const result = this.db.prepare(`
      INSERT INTO messages (room_id, sender_id, text, parse_mode, reply_to_message_id, mentions)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(room_id, sender_id, text, parse_mode, reply_to, JSON.stringify(mentions));
    return { id: Number(result.lastInsertRowid), room_id, sender_id, text, parse_mode, reply_to_message_id: reply_to, mentions };
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

  close() {
    this.db.close();
  }
}

module.exports = SQLiteAdapter;
