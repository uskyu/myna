"""
Database layer - supports SQLite and MySQL via adapter pattern.
Switch via DB_TYPE env var: sqlite (default) or mysql.
"""
import json
import uuid
import os
from datetime import datetime


def get_database(db_path: str = None):
    """Factory: returns SQLite or MySQL Database based on DB_TYPE env."""
    db_type = os.environ.get("DB_TYPE", "sqlite").lower()
    if db_type == "mysql":
        return MySQLDatabase()
    return SQLiteDatabase(db_path or "db/myna.sqlite")


class BaseDatabase:
    """Abstract base with shared logic."""

    def _placeholder(self):
        raise NotImplementedError

    def _now_func(self):
        raise NotImplementedError

    def _now_minus_1h(self):
        raise NotImplementedError

    def _insert_ignore(self):
        raise NotImplementedError

    def _upsert_settings(self):
        raise NotImplementedError

    def execute(self, sql, params=None):
        raise NotImplementedError

    def fetchone(self, sql, params=None):
        raise NotImplementedError

    def fetchall(self, sql, params=None):
        raise NotImplementedError

    def commit(self):
        raise NotImplementedError

    def lastrowid(self):
        raise NotImplementedError

    def close(self):
        raise NotImplementedError

    def _row_to_dict(self, row):
        if row is None:
            return None
        return dict(row) if hasattr(row, "keys") else row

    def _rows_to_list(self, rows):
        return [self._row_to_dict(r) for r in rows]

    def _ensure_column(self, table: str, column: str, definition: str):
        """Idempotently add a column for older deployments."""
        try:
            if isinstance(self, SQLiteDatabase):
                rows = self.fetchall(f"PRAGMA table_info({table})")
                exists = any(r.get("name") == column for r in rows)
                if not exists:
                    self.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            else:
                row = self.fetchone(
                    "SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s",
                    (table, column),
                )
                if not row or int(row.get("count", 0)) == 0:
                    self.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            self.commit()
        except Exception as e:
            print(f"[DB] Column migration skipped for {table}.{column}: {e}")

    # === Agents ===
    def create_agent(self, name: str, description: str = "") -> dict:
        id = str(uuid.uuid4())
        api_key = uuid.uuid4().hex + uuid.uuid4().hex
        ph = self._placeholder()
        self.execute(
            f"INSERT INTO agents (id, name, api_key, description, status) VALUES ({ph}, {ph}, {ph}, {ph}, {ph})",
            (id, name, api_key, description, "online")
        )
        self.commit()
        return {"id": id, "name": name, "api_key": api_key, "description": description, "status": "online"}

    def get_agent_by_key(self, api_key: str):
        ph = self._placeholder()
        return self.fetchone(f"SELECT * FROM agents WHERE api_key = {ph}", (api_key,))

    def get_agent_by_id(self, id: str):
        ph = self._placeholder()
        return self.fetchone(f"SELECT * FROM agents WHERE id = {ph}", (id,))

    def list_agents(self) -> list:
        return self.fetchall(
            "SELECT id, name, description, avatar, status, container_id, model_config_id, "
            "execution_mode, self_improve, self_improve_threshold, tools_config, created_at FROM agents"
        )

    def update_agent(self, id: str, fields: dict):
        ph = self._placeholder()
        sets = []
        vals = []
        allowed = ["name", "description", "status", "model_config_id", "execution_mode",
                   "self_improve", "self_improve_threshold", "tools_config", "container_id"]
        for key in allowed:
            if key in fields and fields[key] is not None:
                sets.append(f"{key} = {ph}")
                vals.append(fields[key])
        if not sets:
            return
        sets.append(f"updated_at = {self._now_func()}")
        vals.append(id)
        self.execute(f"UPDATE agents SET {', '.join(sets)} WHERE id = {ph}", vals)
        self.commit()

    def update_agent_status(self, id: str, status: str):
        ph = self._placeholder()
        self.execute(f"UPDATE agents SET status = {ph}, updated_at = {self._now_func()} WHERE id = {ph}", (status, id))
        self.commit()

    def delete_agent(self, id: str):
        ph = self._placeholder()
        self.execute(f"DELETE FROM agents WHERE id = {ph}", (id,))
        self.commit()

    # === Rooms ===
    def create_room(self, name: str, description: str = "", type: str = "group") -> dict:
        id = str(uuid.uuid4())
        ph = self._placeholder()
        self.execute(f"INSERT INTO rooms (id, name, description, type) VALUES ({ph}, {ph}, {ph}, {ph})",
                     (id, name, description, type))
        self.commit()
        return {"id": id, "name": name, "description": description, "type": type}

    def get_room(self, id: str):
        ph = self._placeholder()
        return self.fetchone(f"SELECT * FROM rooms WHERE id = {ph}", (id,))

    def list_rooms(self) -> list:
        return self.fetchall("SELECT * FROM rooms")

    def delete_room(self, id: str):
        ph = self._placeholder()
        self.execute(f"DELETE FROM rooms WHERE id = {ph}", (id,))
        self.commit()

    def get_room_settings(self, room_id: str) -> dict:
        ph = self._placeholder()
        row = self.fetchone(f"SELECT settings_json FROM rooms WHERE id = {ph}", (room_id,))
        try:
            return json.loads(row["settings_json"]) if row else {}
        except:
            return {}

    def update_room_settings(self, room_id: str, settings: dict) -> dict:
        ph = self._placeholder()
        current = self.get_room_settings(room_id)
        merged = {**current, **settings}
        self.execute(f"UPDATE rooms SET settings_json = {ph} WHERE id = {ph}", (json.dumps(merged), room_id))
        self.commit()
        return merged

    # === Room Members ===
    def add_member(self, room_id: str, agent_id: str, role: str = "member"):
        ph = self._placeholder()
        self.execute(
            f"{self._insert_ignore()} INTO room_members (room_id, agent_id, role) VALUES ({ph}, {ph}, {ph})",
            (room_id, agent_id, role)
        )
        self.commit()

    def remove_member(self, room_id: str, agent_id: str):
        ph = self._placeholder()
        self.execute(f"DELETE FROM room_members WHERE room_id = {ph} AND agent_id = {ph}", (room_id, agent_id))
        self.commit()

    def get_room_members(self, room_id: str) -> list:
        ph = self._placeholder()
        return self.fetchall(f"""
            SELECT a.id, a.name, a.status, rm.role
            FROM room_members rm JOIN agents a ON a.id = rm.agent_id
            WHERE rm.room_id = {ph}
        """, (room_id,))

    def get_agent_rooms(self, agent_id: str) -> list:
        ph = self._placeholder()
        return self.fetchall(f"""
            SELECT r.* FROM rooms r
            JOIN room_members rm ON rm.room_id = r.id
            WHERE rm.agent_id = {ph}
        """, (agent_id,))

    # === Messages ===
    def create_message(self, room_id: str, sender_id: str, text: str,
                       parse_mode: str = "markdown", reply_to=None,
                       mentions: list = None, metadata: dict = None, thread_id: str = None) -> dict:
        ph = self._placeholder()
        mentions_json = json.dumps(mentions or [])
        metadata_json = json.dumps(metadata) if metadata else None
        self.execute(f"""
            INSERT INTO messages (room_id, sender_id, text, parse_mode, reply_to_message_id, mentions, metadata, thread_id)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
        """, (room_id, sender_id, text, parse_mode, reply_to, mentions_json, metadata_json, thread_id))
        self.commit()
        msg_id = self.lastrowid()
        if thread_id:
            self.execute(f"UPDATE threads SET updated_at = {self._now_func()} WHERE id = {ph}", (thread_id,))
            self.commit()
        return {"id": msg_id, "room_id": room_id, "sender_id": sender_id, "text": text,
                "parse_mode": parse_mode, "reply_to_message_id": reply_to, "mentions": mentions or [],
                "metadata": metadata, "thread_id": thread_id, "created_at": datetime.now().isoformat()}

    def get_room_messages(self, room_id: str, limit: int = 50, before_id: int = None) -> list:
        ph = self._placeholder()
        if before_id:
            rows = self.fetchall(f"""
                SELECT m.*, a.name as sender_name FROM messages m
                JOIN agents a ON a.id = m.sender_id
                WHERE m.room_id = {ph} AND m.id < {ph} ORDER BY m.id DESC LIMIT {ph}
            """, (room_id, before_id, limit))
        else:
            rows = self.fetchall(f"""
                SELECT m.*, a.name as sender_name FROM messages m
                JOIN agents a ON a.id = m.sender_id
                WHERE m.room_id = {ph} ORDER BY m.id DESC LIMIT {ph}
            """, (room_id, limit))
        return list(reversed(rows))

    def clear_room_messages(self, room_id: str):
        ph = self._placeholder()
        self.execute(f"DELETE FROM messages WHERE room_id = {ph}", (room_id,))
        self.commit()

    def update_message(self, id: int, text: str):
        ph = self._placeholder()
        self.execute(f"UPDATE messages SET text = {ph} WHERE id = {ph}", (text, id))
        self.commit()

    def delete_message(self, id: int):
        ph = self._placeholder()
        self.execute(f"DELETE FROM messages WHERE id = {ph}", (id,))
        self.commit()

    # === Updates (polling) ===
    def push_update(self, agent_id: str, type: str, payload: dict):
        ph = self._placeholder()
        self.execute(f"INSERT INTO updates (agent_id, type, payload) VALUES ({ph}, {ph}, {ph})",
                     (agent_id, type, json.dumps(payload)))
        self.commit()

    def get_updates(self, agent_id: str, offset: int = 0, limit: int = 100) -> list:
        ph = self._placeholder()
        rows = self.fetchall(f"""
            SELECT * FROM updates WHERE agent_id = {ph} AND consumed = 0 AND id > {ph}
            ORDER BY id ASC LIMIT {ph}
        """, (agent_id, offset, limit))
        if rows:
            max_id = rows[-1]["id"]
            self.execute(f"UPDATE updates SET consumed = 1 WHERE agent_id = {ph} AND id <= {ph}",
                        (agent_id, max_id))
            self.commit()
        for r in rows:
            r["payload"] = json.loads(r["payload"]) if isinstance(r["payload"], str) else r["payload"]
        return rows

    def cleanup_updates(self):
        self.execute(f"DELETE FROM updates WHERE consumed = 1 AND created_at < {self._now_minus_1h()}")
        self.commit()

    # === Model Configs ===
    def create_model_config(self, config: dict) -> dict:
        ph = self._placeholder()
        id = str(uuid.uuid4())
        self.execute(f"""
            INSERT INTO model_configs (id, name, provider, base_url, api_key, model, max_tokens, temperature, is_default, params_json)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
        """, (id, config["name"], config["provider"], config["base_url"], config["api_key"],
              config["model"], config.get("max_tokens", 2048), config.get("temperature", 0.7),
              1 if config.get("is_default") else 0, config.get("params_json")))
        if config.get("is_default"):
            self.execute(f"UPDATE model_configs SET is_default = 0 WHERE id != {ph}", (id,))
        self.commit()
        return {"id": id, **config}

    def list_model_configs(self) -> list:
        return self.fetchall("SELECT * FROM model_configs ORDER BY is_default DESC, created_at ASC")

    def get_model_config(self, id: str):
        ph = self._placeholder()
        return self.fetchone(f"SELECT * FROM model_configs WHERE id = {ph}", (id,))

    def get_default_model_config(self):
        return self.fetchone("SELECT * FROM model_configs WHERE is_default = 1")

    def update_model_config(self, id: str, fields: dict):
        ph = self._placeholder()
        sets = []
        vals = []
        for key in ["name", "provider", "base_url", "api_key", "model", "params_json"]:
            if key in fields:
                sets.append(f"{key} = {ph}")
                vals.append(fields[key])
        if "max_tokens" in fields:
            sets.append(f"max_tokens = {ph}"); vals.append(fields["max_tokens"])
        if "temperature" in fields:
            sets.append(f"temperature = {ph}"); vals.append(fields["temperature"])
        if fields.get("is_default"):
            sets.append("is_default = 1")
            self.execute(f"UPDATE model_configs SET is_default = 0 WHERE id != {ph}", (id,))
        if not sets:
            return
        vals.append(id)
        self.execute(f"UPDATE model_configs SET {', '.join(sets)} WHERE id = {ph}", vals)
        self.commit()

    def delete_model_config(self, id: str):
        ph = self._placeholder()
        self.execute(f"DELETE FROM model_configs WHERE id = {ph}", (id,))
        self.execute(f"UPDATE agents SET model_config_id = NULL WHERE model_config_id = {ph}", (id,))
        self.commit()

    # === Threads ===
    def create_thread(self, room_id: str, title: str, workflow_id: str = None) -> dict:
        ph = self._placeholder()
        id = str(uuid.uuid4())
        self.execute(f"INSERT INTO threads (id, room_id, title, workflow_id) VALUES ({ph}, {ph}, {ph}, {ph})",
                     (id, room_id, title, workflow_id))
        self.commit()
        return self.fetchone(f"SELECT * FROM threads WHERE id = {ph}", (id,))

    def get_threads(self, room_id: str) -> list:
        ph = self._placeholder()
        return self.fetchall(f"SELECT * FROM threads WHERE room_id = {ph} ORDER BY updated_at DESC", (room_id,))

    def get_thread(self, thread_id: str):
        ph = self._placeholder()
        return self.fetchone(f"SELECT * FROM threads WHERE id = {ph}", (thread_id,))

    def update_thread(self, thread_id: str, fields: dict):
        ph = self._placeholder()
        sets = []
        vals = []
        if "title" in fields:
            sets.append(f"title = {ph}"); vals.append(fields["title"])
        if "status" in fields:
            sets.append(f"status = {ph}"); vals.append(fields["status"])
        if not sets:
            return
        sets.append(f"updated_at = {self._now_func()}")
        vals.append(thread_id)
        self.execute(f"UPDATE threads SET {', '.join(sets)} WHERE id = {ph}", vals)
        self.commit()

    def delete_thread(self, thread_id: str):
        ph = self._placeholder()
        self.execute(f"DELETE FROM messages WHERE thread_id = {ph}", (thread_id,))
        self.execute(f"DELETE FROM threads WHERE id = {ph}", (thread_id,))
        self.commit()

    def get_thread_messages(self, thread_id: str, limit: int = 30) -> list:
        ph = self._placeholder()
        rows = self.fetchall(f"""
            SELECT m.*, a.name as sender_name FROM messages m
            JOIN agents a ON a.id = m.sender_id
            WHERE m.thread_id = {ph} ORDER BY m.id DESC LIMIT {ph}
        """, (thread_id, limit))
        return list(reversed(rows))

    # === Workflows ===
    def create_workflow(self, room_id: str, name: str, description: str,
                       steps_json: str, trigger_type: str = "manual", trigger_config: str = "{}") -> dict:
        ph = self._placeholder()
        id = str(uuid.uuid4())
        self.execute(f"""
            INSERT INTO workflows (id, room_id, name, description, steps_json, trigger_type, trigger_config)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
        """, (id, room_id, name, description or "", steps_json, trigger_type, trigger_config))
        self.commit()
        return self.fetchone(f"SELECT * FROM workflows WHERE id = {ph}", (id,))

    def get_workflows(self, room_id: str) -> list:
        ph = self._placeholder()
        return self.fetchall(f"SELECT * FROM workflows WHERE room_id = {ph} ORDER BY created_at DESC", (room_id,))

    def get_workflow(self, workflow_id: str):
        ph = self._placeholder()
        return self.fetchone(f"SELECT * FROM workflows WHERE id = {ph}", (workflow_id,))

    def update_workflow(self, workflow_id: str, fields: dict):
        ph = self._placeholder()
        sets = []
        vals = []
        for key in ["name", "description", "steps_json", "trigger_type", "trigger_config"]:
            if key in fields:
                val = fields[key]
                if key in ("steps_json", "trigger_config") and not isinstance(val, str):
                    val = json.dumps(val)
                sets.append(f"{key} = {ph}")
                vals.append(val)
        if not sets:
            return
        vals.append(workflow_id)
        self.execute(f"UPDATE workflows SET {', '.join(sets)} WHERE id = {ph}", vals)
        self.commit()

    def delete_workflow(self, workflow_id: str):
        ph = self._placeholder()
        self.execute(f"DELETE FROM workflow_runs WHERE workflow_id = {ph}", (workflow_id,))
        self.execute(f"DELETE FROM workflows WHERE id = {ph}", (workflow_id,))
        self.commit()

    def create_workflow_run(self, workflow_id: str, thread_id: str) -> dict:
        ph = self._placeholder()
        id = str(uuid.uuid4())
        self.execute(f"INSERT INTO workflow_runs (id, workflow_id, thread_id) VALUES ({ph}, {ph}, {ph})",
                     (id, workflow_id, thread_id))
        self.commit()
        return self.fetchone(f"SELECT * FROM workflow_runs WHERE id = {ph}", (id,))

    def get_workflow_run(self, run_id: str):
        ph = self._placeholder()
        return self.fetchone(f"SELECT * FROM workflow_runs WHERE id = {ph}", (run_id,))

    def update_workflow_run(self, run_id: str, fields: dict):
        ph = self._placeholder()
        sets = []
        vals = []
        for key in ["status", "current_step", "context_json", "completed_at"]:
            if key in fields:
                val = fields[key]
                if key == "context_json" and not isinstance(val, str):
                    val = json.dumps(val)
                sets.append(f"{key} = {ph}")
                vals.append(val)
        if not sets:
            return
        vals.append(run_id)
        self.execute(f"UPDATE workflow_runs SET {', '.join(sets)} WHERE id = {ph}", vals)
        self.commit()

    def get_workflow_runs(self, workflow_id: str) -> list:
        ph = self._placeholder()
        return self.fetchall(f"""
            SELECT id, workflow_id, thread_id, status, current_step, started_at, completed_at
            FROM workflow_runs WHERE workflow_id = {ph} ORDER BY started_at DESC
        """, (workflow_id,))

    def get_workflow_run_count(self, workflow_id: str) -> int:
        ph = self._placeholder()
        row = self.fetchone(f"SELECT COUNT(*) as cnt FROM workflow_runs WHERE workflow_id = {ph}", (workflow_id,))
        return row["cnt"] if row else 0

    # === Agent Skills ===
    def get_agent_skills(self, agent_id: str) -> list:
        ph = self._placeholder()
        return self.fetchall(f"SELECT * FROM agent_skills WHERE agent_id = {ph} ORDER BY created_at ASC", (agent_id,))

    def get_all_skills(self) -> list:
        return self.fetchall("""
            SELECT s.*, a.name as agent_name FROM agent_skills s
            LEFT JOIN agents a ON s.agent_id = a.id ORDER BY s.created_at DESC
        """)

    def get_skill_by_id(self, skill_id: str):
        ph = self._placeholder()
        return self.fetchone(f"SELECT * FROM agent_skills WHERE id = {ph}", (skill_id,))

    def create_skill(self, agent_id: str, name: str, description: str = "",
                     content: str = "", file_type: str = "text") -> dict:
        ph = self._placeholder()
        id = str(uuid.uuid4())
        self.execute(f"""
            INSERT INTO agent_skills (id, agent_id, name, description, content, file_type)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})
        """, (id, agent_id, name, description, content, file_type))
        self.commit()
        return self.fetchone(f"SELECT * FROM agent_skills WHERE id = {ph}", (id,))

    def update_skill(self, skill_id: str, fields: dict):
        ph = self._placeholder()
        sets = []
        vals = []
        for key in ["name", "description", "content", "file_type"]:
            if key in fields and fields[key] is not None:
                sets.append(f"{key} = {ph}")
                vals.append(fields[key])
        sets.append(f"updated_at = {self._now_func()}")
        vals.append(skill_id)
        self.execute(f"UPDATE agent_skills SET {', '.join(sets)} WHERE id = {ph}", vals)
        self.commit()
        return self.get_skill_by_id(skill_id)

    def delete_skill(self, skill_id: str):
        ph = self._placeholder()
        self.execute(f"DELETE FROM agent_skills WHERE id = {ph}", (skill_id,))
        self.commit()

    def copy_skill_to_agent(self, skill_id: str, target_agent_id: str):
        skill = self.get_skill_by_id(skill_id)
        if not skill:
            return None
        return self.create_skill(target_agent_id, skill["name"], skill["description"],
                                skill["content"], skill["file_type"])

    # === Room Skills (skill isolation per room) ===
    def get_room_skills(self, room_id: str) -> list:
        """Get skill IDs enabled for a specific room."""
        ph = self._placeholder()
        rows = self.fetchall(f"SELECT skill_id FROM room_skills WHERE room_id = {ph}", (room_id,))
        return [r["skill_id"] for r in rows]

    def set_room_skills(self, room_id: str, skill_ids: list):
        """Replace all skill associations for a room."""
        ph = self._placeholder()
        self.execute(f"DELETE FROM room_skills WHERE room_id = {ph}", (room_id,))
        for sid in skill_ids:
            self.execute(f"INSERT INTO room_skills (room_id, skill_id) VALUES ({ph}, {ph})", (room_id, sid))
        self.commit()

    def add_room_skill(self, room_id: str, skill_id: str):
        """Add a single skill to a room."""
        ph = self._placeholder()
        self.execute(f"INSERT OR IGNORE INTO room_skills (room_id, skill_id) VALUES ({ph}, {ph})", (room_id, skill_id))
        self.commit()

    def remove_room_skill(self, room_id: str, skill_id: str):
        """Remove a single skill from a room."""
        ph = self._placeholder()
        self.execute(f"DELETE FROM room_skills WHERE room_id = {ph} AND skill_id = {ph}", (room_id, skill_id))
        self.commit()

    def get_room_skills_full(self, room_id: str) -> list:
        """Get full skill objects enabled for a room."""
        ph = self._placeholder()
        return self.fetchall(f"""
            SELECT s.*, a.name as agent_name FROM room_skills rs
            JOIN agent_skills s ON rs.skill_id = s.id
            LEFT JOIN agents a ON s.agent_id = a.id
            WHERE rs.room_id = {ph}
            ORDER BY s.name ASC
        """, (room_id,))

    # === DM Rooms ===
    def get_dm_room(self, user_id: str, agent_id: str):
        ph = self._placeholder()
        return self.fetchone(f"""
            SELECT r.* FROM rooms r
            WHERE r.type = 'dm'
            AND EXISTS (SELECT 1 FROM room_members rm1 WHERE rm1.room_id = r.id AND rm1.agent_id = {ph})
            AND EXISTS (SELECT 1 FROM room_members rm2 WHERE rm2.room_id = r.id AND rm2.agent_id = {ph})
        """, (user_id, agent_id))

    def list_dm_rooms(self) -> list:
        return self.fetchall("SELECT * FROM rooms WHERE type = 'dm'")

    # === Utility ===
    def ensure_system_agents(self):
        ph = self._placeholder()
        self.execute(
            f"{self._insert_ignore()} INTO agents (id, name, api_key, description, status) VALUES ({ph}, {ph}, {ph}, {ph}, {ph})",
            ('user', 'user', '__user__', '用户', 'online')
        )
        # Migrate: rename '我' to 'user' for clarity in multi-agent context
        self.execute(f"UPDATE agents SET name = {ph} WHERE id = {ph} AND name = {ph}", ('user', 'user', '我'))
        self.execute(
            f"{self._insert_ignore()} INTO agents (id, name, api_key, description, status) VALUES ({ph}, {ph}, {ph}, {ph}, {ph})",
            ('system', '系统', '__system__', '系统消息', 'online')
        )
        # System Agent - handles credentials and git operations
        self.execute(
            f"{self._insert_ignore()} INTO agents (id, name, api_key, description, status) VALUES ({ph}, {ph}, {ph}, {ph}, {ph})",
            ('__system__', 'System', '__sysagent__', '系统智能体：管理凭据与配置、提供 Git/SSH 令牌位置、分发共享资源信息', 'online')
        )
        self.commit()

    # === Hub Settings ===
    def get_hub_setting(self, key: str, default=None):
        ph = self._placeholder()
        row = self.fetchone(f"SELECT value FROM hub_settings WHERE key = {ph}", (key,))
        return row["value"] if row else default

    def set_hub_setting(self, key: str, value: str):
        self.execute(self._upsert_settings(), (key, value))
        self.commit()

    def get_all_hub_settings(self) -> dict:
        rows = self.fetchall("SELECT key, value FROM hub_settings")
        return {r["key"]: r["value"] for r in rows}


class SQLiteDatabase(BaseDatabase):
    """SQLite adapter - default, zero-config."""

    def __init__(self, db_path: str):
        import sqlite3
        from pathlib import Path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA foreign_keys = ON")
        self._last_rowid = None
        self._migrate()

    def _placeholder(self):
        return "?"

    def _now_func(self):
        return "datetime('now')"

    def _now_minus_1h(self):
        return "datetime('now', '-1 hour')"

    def _insert_ignore(self):
        return "INSERT OR IGNORE"

    def _upsert_settings(self):
        return "INSERT OR REPLACE INTO hub_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))"

    def execute(self, sql, params=None):
        cur = self.conn.execute(sql, params or ())
        self._last_rowid = cur.lastrowid
        return cur

    def fetchone(self, sql, params=None):
        row = self.conn.execute(sql, params or ()).fetchone()
        return self._row_to_dict(row)

    def fetchall(self, sql, params=None):
        rows = self.conn.execute(sql, params or ()).fetchall()
        return self._rows_to_list(rows)

    def commit(self):
        self.conn.commit()

    def lastrowid(self):
        return self._last_rowid

    def close(self):
        self.conn.close()

    def _migrate(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                api_key TEXT UNIQUE NOT NULL,
                description TEXT DEFAULT '',
                avatar TEXT DEFAULT '',
                status TEXT DEFAULT 'online',
                container_id TEXT DEFAULT NULL,
                model_config_id TEXT DEFAULT NULL,
                execution_mode TEXT DEFAULT 'auto',
                self_improve INTEGER DEFAULT 0,
                self_improve_threshold INTEGER DEFAULT 2,
                tools_config TEXT DEFAULT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                type TEXT DEFAULT 'group',
                settings_json TEXT DEFAULT '{}',
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
                thread_id TEXT DEFAULT NULL,
                metadata TEXT DEFAULT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
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
                params_json TEXT DEFAULT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );

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

            CREATE TABLE IF NOT EXISTS hub_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now'))
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

            CREATE TABLE IF NOT EXISTS room_skills (
                room_id TEXT NOT NULL,
                skill_id TEXT NOT NULL,
                PRIMARY KEY (room_id, skill_id),
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
                FOREIGN KEY (skill_id) REFERENCES agent_skills(id) ON DELETE CASCADE
            );
        """)
        # Migration: fix old schema where status DEFAULT was 'offline'
        # Update any existing offline agents to online (they should be online by default)
        self._ensure_column("agents", "model_config_id", "TEXT DEFAULT NULL")
        self._ensure_column("agents", "execution_mode", "TEXT DEFAULT 'auto'")
        self._ensure_column("agents", "self_improve", "INTEGER DEFAULT 0")
        self._ensure_column("agents", "self_improve_threshold", "INTEGER DEFAULT 2")
        self._ensure_column("agents", "tools_config", "TEXT DEFAULT NULL")
        self._ensure_column("rooms", "settings_json", "TEXT DEFAULT '{}'")
        self._ensure_column("messages", "thread_id", "TEXT DEFAULT NULL")
        self._ensure_column("messages", "metadata", "TEXT DEFAULT NULL")
        self.conn.execute("UPDATE agents SET status = 'online' WHERE status = 'offline'")
        self.conn.commit()


class MySQLDatabase(BaseDatabase):
    """MySQL adapter - for Docker Compose / production deployments."""

    def __init__(self):
        import pymysql
        import pymysql.cursors
        self._pymysql = pymysql
        self.conn = pymysql.connect(
            host=os.environ.get("MYSQL_HOST", "localhost"),
            port=int(os.environ.get("MYSQL_PORT", 3306)),
            user=os.environ.get("MYSQL_USER", "myna"),
            password=os.environ.get("MYSQL_PASSWORD", "myna"),
            database=os.environ.get("MYSQL_DATABASE", "myna"),
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=False
        )
        self._last_rowid = None
        self._migrate()

    def _placeholder(self):
        return "%s"

    def _now_func(self):
        return "NOW()"

    def _now_minus_1h(self):
        return "DATE_SUB(NOW(), INTERVAL 1 HOUR)"

    def _insert_ignore(self):
        return "INSERT IGNORE"

    def _upsert_settings(self):
        return "INSERT INTO hub_settings (`key`, value, updated_at) VALUES (%s, %s, NOW()) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()"

    def execute(self, sql, params=None):
        with self.conn.cursor() as cur:
            cur.execute(sql, params or ())
            self._last_rowid = cur.lastrowid
            return cur

    def fetchone(self, sql, params=None):
        with self.conn.cursor() as cur:
            cur.execute(sql, params or ())
            return cur.fetchone()

    def fetchall(self, sql, params=None):
        with self.conn.cursor() as cur:
            cur.execute(sql, params or ())
            return list(cur.fetchall())

    def commit(self):
        self.conn.commit()

    def lastrowid(self):
        return self._last_rowid

    def close(self):
        self.conn.close()

    def _migrate(self):
        stmts = [
            """CREATE TABLE IF NOT EXISTS agents (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                api_key VARCHAR(128) UNIQUE NOT NULL,
                description TEXT DEFAULT NULL,
                avatar VARCHAR(512) DEFAULT '',
                status VARCHAR(32) DEFAULT 'online',
                container_id VARCHAR(128) DEFAULT NULL,
                model_config_id VARCHAR(36) DEFAULT NULL,
                execution_mode VARCHAR(32) DEFAULT 'auto',
                self_improve TINYINT DEFAULT 0,
                self_improve_threshold INT DEFAULT 2,
                tools_config TEXT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",

            """CREATE TABLE IF NOT EXISTS rooms (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT DEFAULT NULL,
                type VARCHAR(32) DEFAULT 'group',
                settings_json TEXT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",

            """CREATE TABLE IF NOT EXISTS room_members (
                room_id VARCHAR(36) NOT NULL,
                agent_id VARCHAR(36) NOT NULL,
                role VARCHAR(32) DEFAULT 'member',
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (room_id, agent_id),
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",

            """CREATE TABLE IF NOT EXISTS messages (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                room_id VARCHAR(36) NOT NULL,
                sender_id VARCHAR(36) NOT NULL,
                text LONGTEXT NOT NULL,
                parse_mode VARCHAR(32) DEFAULT 'markdown',
                reply_to_message_id BIGINT DEFAULT NULL,
                mentions TEXT DEFAULT NULL,
                thread_id VARCHAR(36) DEFAULT NULL,
                metadata TEXT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
                INDEX idx_messages_room (room_id, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",

            """CREATE TABLE IF NOT EXISTS updates (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                agent_id VARCHAR(36) NOT NULL,
                type VARCHAR(64) NOT NULL,
                payload LONGTEXT NOT NULL,
                consumed TINYINT DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
                INDEX idx_updates_agent (agent_id, consumed, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",

            """CREATE TABLE IF NOT EXISTS model_configs (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                provider VARCHAR(64) NOT NULL,
                base_url VARCHAR(512) NOT NULL,
                api_key VARCHAR(512) NOT NULL,
                model VARCHAR(255) NOT NULL,
                max_tokens INT DEFAULT 2048,
                temperature FLOAT DEFAULT 0.7,
                is_default TINYINT DEFAULT 0,
                params_json TEXT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",

            """CREATE TABLE IF NOT EXISTS threads (
                id VARCHAR(36) PRIMARY KEY,
                room_id VARCHAR(36) NOT NULL,
                title VARCHAR(512) NOT NULL,
                status VARCHAR(32) DEFAULT 'active',
                workflow_id VARCHAR(36) DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
                INDEX idx_threads_room (room_id, created_at DESC)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",

            """CREATE TABLE IF NOT EXISTS workflows (
                id VARCHAR(36) PRIMARY KEY,
                room_id VARCHAR(36) NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT DEFAULT NULL,
                steps_json LONGTEXT NOT NULL,
                trigger_type VARCHAR(32) DEFAULT 'manual',
                trigger_config TEXT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",

            """CREATE TABLE IF NOT EXISTS workflow_runs (
                id VARCHAR(36) PRIMARY KEY,
                workflow_id VARCHAR(36) NOT NULL,
                thread_id VARCHAR(36) NOT NULL,
                status VARCHAR(32) DEFAULT 'running',
                current_step INT DEFAULT 0,
                context_json LONGTEXT DEFAULT NULL,
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME DEFAULT NULL,
                FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
                FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",

            """CREATE TABLE IF NOT EXISTS hub_settings (
                `key` VARCHAR(255) PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",

            """CREATE TABLE IF NOT EXISTS agent_skills (
                id VARCHAR(36) PRIMARY KEY,
                agent_id VARCHAR(36) NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT DEFAULT NULL,
                content LONGTEXT DEFAULT NULL,
                file_type VARCHAR(32) DEFAULT 'text',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",

            """CREATE TABLE IF NOT EXISTS room_skills (
                room_id VARCHAR(36) NOT NULL,
                skill_id VARCHAR(36) NOT NULL,
                PRIMARY KEY (room_id, skill_id),
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
                FOREIGN KEY (skill_id) REFERENCES agent_skills(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"""
        ]
        with self.conn.cursor() as cur:
            for stmt in stmts:
                cur.execute(stmt)
        self.conn.commit()
        self._ensure_column("agents", "model_config_id", "VARCHAR(36) DEFAULT NULL")
        self._ensure_column("agents", "execution_mode", "VARCHAR(32) DEFAULT 'auto'")
        self._ensure_column("agents", "self_improve", "TINYINT DEFAULT 0")
        self._ensure_column("agents", "self_improve_threshold", "INT DEFAULT 2")
        self._ensure_column("agents", "tools_config", "TEXT DEFAULT NULL")
        self._ensure_column("rooms", "settings_json", "TEXT DEFAULT NULL")
        self._ensure_column("messages", "thread_id", "VARCHAR(36) DEFAULT NULL")
        self._ensure_column("messages", "metadata", "TEXT DEFAULT NULL")
