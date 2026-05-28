import { reactive, ref } from 'vue'

const BASE = ''

// Auth state
export const auth = reactive({
  token: localStorage.getItem('hub_auth_token') || '',
  authenticated: false,
})

export function setAuthToken(token) {
  auth.token = token
  auth.authenticated = true
  localStorage.setItem('hub_auth_token', token)
}

export function clearAuth() {
  auth.token = ''
  auth.authenticated = false
  localStorage.removeItem('hub_auth_token')
}

export async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (auth.token) {
    opts.headers['Authorization'] = `Bearer ${auth.token}`
  }
  if (body) opts.body = JSON.stringify(body)
  try {
    const r = await fetch(BASE + path, opts)
    if (r.status === 401 && !path.startsWith('/auth/')) {
      // Session expired
      clearAuth()
      return { ok: false, error: '未登录' }
    }
    return await r.json()
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// Track which room is currently open
export const currentRoomId = ref(null)

// Chat settings (persisted in localStorage)
export const chatSettings = reactive({
  toolCallDisplay: localStorage.getItem('hermes_tool_display') || 'collapsed-after-complete'
})
export function saveChatSettings() {
  localStorage.setItem('hermes_tool_display', chatSettings.toolCallDisplay)
}

// Global state
export const store = reactive({
  agents: [],
  rooms: [],
  dms: [],
  activeStreams: {},
  unreadCounts: {},
  initialized: false,
})

// Update check state
export const updateInfo = reactive({
  available: false,
  latestVersion: '',
  checked: false,
})

const CURRENT_VERSION = '0.3.0'

export async function checkForUpdate() {
  try {
    const res = await fetch('https://api.github.com/repos/uskyu/myna/releases/latest')
    if (!res.ok) return
    const data = await res.json()
    const remote = (data.tag_name || '').replace(/^v/, '')
    if (remote && remote !== CURRENT_VERSION) {
      updateInfo.available = true
      updateInfo.latestVersion = 'v' + remote
    } else {
      updateInfo.available = false
    }
    updateInfo.checked = true
  } catch {
    // Silent fail
  }
}

// Clear unread count for a room
export function clearUnread(roomId) {
  store.unreadCounts[roomId] = 0
}

export async function loadAgents() {
  const data = await api('GET', '/admin/agents')
  store.agents = (data.result || []).filter(a => a.id !== 'system' && a.id !== 'user')
}

export async function loadConversations() {
  const [roomData, dmData] = await Promise.all([
    api('GET', '/admin/rooms'),
    api('GET', '/admin/dms'),
  ])
  store.rooms = (roomData.result || []).filter(r => r.type !== 'dm')
  store.dms = dmData.result || []
  store.initialized = true
}

// WebSocket
export const ws = {
  _ws: null,
  _handlers: [],
  _reconnectTimer: null,
  connected: ref(false),
  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const authParam = auth.token ? `&auth_token=${auth.token}` : ''
    this._ws = new WebSocket(`${proto}//${location.host}/ws?ui=1${authParam}`)
    this._ws.onopen = () => {
      console.log('[WS] Connected')
      this.connected.value = true
    }
    this._ws.onclose = () => {
      console.log('[WS] Disconnected, reconnecting in 3s...')
      this.connected.value = false
      this._reconnectTimer = setTimeout(() => this.connect(), 3000)
    }
    this._ws.onerror = () => {}
    this._ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        // Global handler for activeStreams and unread counts
        _globalWSHandler(msg)
        this._handlers.forEach(h => h(msg))
      } catch {}
    }
  },
  onMessage(handler) {
    this._handlers.push(handler)
  },
  offMessage(handler) {
    const idx = this._handlers.indexOf(handler)
    if (idx !== -1) this._handlers.splice(idx, 1)
  },
  destroy() {
    clearTimeout(this._reconnectTimer)
    this._ws?.close()
    this._handlers = []
    this.connected.value = false
  }
}

// Global WS handler: manages activeStreams and unread counts at store level
function _globalWSHandler(msg) {
  if (msg.type === 'connected') {
    // Server reconnect: clear stale streams — server will replay active ones immediately after
    store.activeStreams = {}
  } else if (msg.type === 'stream_start') {
    store.activeStreams[msg.stream_id] = { roomId: msg.room_id, agentId: msg.agent_id, agentName: msg.agent_name, text: '', toolCalls: [], working: true }
    store.activeStreams = { ...store.activeStreams }
  } else if (msg.type === 'stream_end') {
    if (store.activeStreams[msg.stream_id]) {
      delete store.activeStreams[msg.stream_id]
      store.activeStreams = { ...store.activeStreams }
    }
    // Increment unread if not the current room
    if (msg.room_id && msg.room_id !== currentRoomId.value) {
      store.unreadCounts[msg.room_id] = (store.unreadCounts[msg.room_id] || 0) + 1
    }
  } else if (msg.type === 'new_message') {
    // Increment unread if not the current room
    if (msg.room_id && msg.room_id !== currentRoomId.value) {
      store.unreadCounts[msg.room_id] = (store.unreadCounts[msg.room_id] || 0) + 1
    }
  }
}

// Avatar palette — forest greens, ambers, warm earth tones (NO blue/purple)
export const AVATAR_COLORS = [
  'linear-gradient(135deg, #2d6a4f, #40916c)',  // forest
  'linear-gradient(135deg, #d97706, #b45309)',  // amber
  'linear-gradient(135deg, #7c5e3c, #a07849)',  // bronze
  'linear-gradient(135deg, #c44545, #9b2f2f)',  // brick
  'linear-gradient(135deg, #4a8c6f, #2d6a4f)',  // sage
  'linear-gradient(135deg, #b87333, #8b4513)',  // copper
  'linear-gradient(135deg, #5e6e58, #3e4d3a)',  // moss
  'linear-gradient(135deg, #d4a574, #a47148)',  // sand
]

export const AGENT_ICONS = [
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
]

export function getAgentColor(idx) { return AVATAR_COLORS[idx % AVATAR_COLORS.length] }
export function getAgentIcon(idx) { return AGENT_ICONS[idx % AGENT_ICONS.length] }
export function escapeHtml(s) { if (!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') }

export function timeAgo(dateStr) {
  if (!dateStr) return ''
  const now = Date.now()
  const t = new Date(dateStr).getTime()
  const diff = Math.floor((now - t) / 1000)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前'
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前'
  if (diff < 604800) return Math.floor(diff / 86400) + '天前'
  return dateStr.slice(5, 10)
}
