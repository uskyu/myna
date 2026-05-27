require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { getDatabase } = require('./db/index');
const WSManager = require('./gateway/ws');
const gatewayRouter = require('./gateway/index');
const orchestratorRouter = require('./orchestrator/index');
const agentManagerRouter = require('./agent-manager/index');
const configRouter = require('./config/index');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS for local dev
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// WebSocket manager
const wsManager = new WSManager();
wsManager.init(server);
app.set('wsManager', wsManager);

// Routes
app.use('/', gatewayRouter);           // /bot{key}/...
app.use('/admin', orchestratorRouter); // /admin/agents, /admin/rooms
app.use('/admin', agentManagerRouter); // /admin/agents/:id/start|stop|logs
app.use('/admin/config', configRouter); // /admin/config

// Static web UI
app.use(express.static(path.join(__dirname, 'web', 'public')));

// Uploaded files static serve
app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads')));

// File upload endpoint
const multer = require('multer');
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'data', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB max

app.post('/admin/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
  const url = '/uploads/' + req.file.filename;
  const type = req.file.mimetype.startsWith('image/') ? 'image' : 'file';
  res.json({ ok: true, url, type, name: req.file.originalname, size: req.file.size });
});

// Health check
app.get('/health', async (req, res) => {
  const db = getDatabase();
  const agents = await db.listAgents();
  const rooms = await db.listRooms();
  res.json({
    status: 'ok',
    agents: agents.length,
    rooms: rooms.length,
    online: wsManager.getOnlineAgents().length
  });
});

// Cleanup job every 5 minutes
setInterval(async () => {
  const db = getDatabase();
  await db.cleanupUpdates();
}, 5 * 60 * 1000);

// Start
async function main() {
  const db = getDatabase();
  await db.ready();

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║          hermes-hub v0.1.0              ║
╠══════════════════════════════════════════╣
║  Web UI:    http://localhost:${PORT}        ║
║  Gateway:   http://localhost:${PORT}/bot*   ║
║  WebSocket: ws://localhost:${PORT}/ws       ║
║  Admin API: http://localhost:${PORT}/admin  ║
║  DB Driver: ${(process.env.DB_DRIVER || 'sqlite').padEnd(24)}║
╚══════════════════════════════════════════╝
    `);
  });
}

main().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
