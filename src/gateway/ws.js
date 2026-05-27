const WebSocket = require('ws');
const { getDatabase } = require('../db/index');

class WSManager {
  constructor() {
    this.connections = new Map(); // agent_id -> Set<ws>
    this.uiConnections = new Set(); // UI client connections (no auth needed for single-user)
  }

  init(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });

    this.wss.on('connection', async (ws, req) => {
      const db = getDatabase();
      const url = new URL(req.url, 'http://localhost');
      const apiKey = url.searchParams.get('api_key');
      const isUI = url.searchParams.get('ui') === '1';

      // UI client connection (no auth for single-user mode)
      if (isUI) {
        this.uiConnections.add(ws);
        ws.on('close', () => this.uiConnections.delete(ws));
        ws.send(JSON.stringify({ type: 'connected', client: 'ui' }));
        return;
      }

      if (!apiKey) {
        ws.close(4001, 'api_key required');
        return;
      }

      const agent = await db.getAgentByKey(apiKey);
      if (!agent) {
        ws.close(4001, 'Invalid api_key');
        return;
      }

      // Register connection
      if (!this.connections.has(agent.id)) {
        this.connections.set(agent.id, new Set());
      }
      this.connections.get(agent.id).add(ws);
      await db.updateAgentStatus(agent.id, 'online');

      console.log(`[WS] Agent "${agent.name}" connected`);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleAgentMessage(agent, msg);
        } catch (e) {
          ws.send(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });

      ws.on('close', async () => {
        this.connections.get(agent.id)?.delete(ws);
        if (this.connections.get(agent.id)?.size === 0) {
          this.connections.delete(agent.id);
          await db.updateAgentStatus(agent.id, 'offline');
          console.log(`[WS] Agent "${agent.name}" disconnected`);
        }
      });

      const rooms = await db.getAgentRooms(agent.id);
      ws.send(JSON.stringify({
        type: 'connected',
        agent: { id: agent.id, name: agent.name },
        rooms
      }));
    });
  }

  async handleAgentMessage(agent, msg) {
    const db = getDatabase();

    switch (msg.type) {
      case 'sendMessage': {
        const { room_id, text, parse_mode, reply_to_message_id, mentions } = msg;
        if (!room_id || !text) return;

        const rooms = await db.getAgentRooms(agent.id);
        if (!rooms.find(r => r.id === room_id)) return;

        const message = await db.createMessage(
          room_id, agent.id, text,
          parse_mode || 'markdown',
          reply_to_message_id || null,
          mentions || []
        );

        const members = await db.getRoomMembers(room_id);
        for (const member of members) {
          if (member.id !== agent.id) {
            const payload = {
              type: 'message',
              message_id: message.id,
              room_id,
              from: { id: agent.id, name: agent.name },
              text,
              parse_mode: parse_mode || 'markdown',
              reply_to_message_id: reply_to_message_id || null,
              mentions: mentions || [],
              date: new Date().toISOString()
            };
            await db.pushUpdate(member.id, 'message', payload);
            this.notify(member.id, payload);
          }
        }

        this.notifyOne(agent.id, { type: 'message_sent', message_id: message.id, room_id });
        break;
      }

      case 'typing': {
        const { room_id } = msg;
        if (!room_id) return;
        const members = await db.getRoomMembers(room_id);
        for (const member of members) {
          if (member.id !== agent.id) {
            this.notify(member.id, {
              type: 'typing',
              room_id,
              from: { id: agent.id, name: agent.name }
            });
          }
        }
        break;
      }
    }
  }

  // Notify agent connections
  notify(agentId, payload) {
    const conns = this.connections.get(agentId);
    if (!conns) return;
    const data = JSON.stringify(payload);
    for (const ws of conns) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  notifyOne(agentId, payload) {
    this.notify(agentId, payload);
  }

  // Notify all UI clients (for streaming, new messages, etc.)
  notifyUI(payload) {
    const data = JSON.stringify(payload);
    for (const ws of this.uiConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  broadcastToRoom(roomId, payload, excludeAgentId = null) {
    const db = getDatabase();
    const members = db.getRoomMembers(roomId);
    const data = JSON.stringify(payload);
    for (const member of members) {
      if (member.id === excludeAgentId) continue;
      const conns = this.connections.get(member.id);
      if (!conns) continue;
      for (const ws of conns) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      }
    }
  }

  getOnlineAgents() {
    return [...this.connections.keys()];
  }
}

module.exports = WSManager;
