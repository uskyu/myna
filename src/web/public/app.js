let currentPage = 'chats';
let currentRoomId = null;
let currentRoomType = 'group';
let currentAgentId = null;
let agents = [];
let rooms = [];
let dms = [];
let pollTimer = null;
let selectedModel = '';
let modelTab = 'fetch';
let isWaitingReply = false;

const AVATAR_COLORS = [
  'linear-gradient(135deg, #667eea, #764ba2)',
  'linear-gradient(135deg, #f093fb, #f5576c)',
  'linear-gradient(135deg, #4facfe, #00f2fe)',
  'linear-gradient(135deg, #43e97b, #38f9d7)',
  'linear-gradient(135deg, #fa709a, #fee140)',
  'linear-gradient(135deg, #a18cd1, #fbc2eb)',
  'linear-gradient(135deg, #fccb90, #d57eeb)',
  'linear-gradient(135deg, #667eea, #f093fb)',
];
const AGENT_ICONS = [
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="9" cy="16" r="1"/><circle cx="15" cy="16" r="1"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 12 18.469a3.374 3.374 0 0 0-.986-2.386l-.548-.547z"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
];
const GROUP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

const SLASH_COMMANDS = [
  { cmd: '/clear', desc: '清空当前对话' },
  { cmd: '/help', desc: '显示帮助信息' },
  { cmd: '/members', desc: '查看群成员' },
];

function getAgentColor(idx) { return AVATAR_COLORS[idx % AVATAR_COLORS.length]; }
function getAgentIcon(idx) { return AGENT_ICONS[idx % AGENT_ICONS.length]; }
function escapeHtml(s) { if (!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

// Theme
function initTheme() {
  const dark = localStorage.getItem('hub-theme') === 'dark';
  if (dark) { document.documentElement.setAttribute('data-theme', 'dark'); document.getElementById('theme-toggle').classList.add('on'); }
}
function toggleTheme() {
  const el = document.documentElement; const toggle = document.getElementById('theme-toggle');
  const isDark = el.getAttribute('data-theme') === 'dark';
  if (isDark) { el.removeAttribute('data-theme'); toggle.classList.remove('on'); localStorage.setItem('hub-theme', 'light'); }
  else { el.setAttribute('data-theme', 'dark'); toggle.classList.add('on'); localStorage.setItem('hub-theme', 'dark'); }
}

// API helper
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(path, opts); return await r.json(); }
  catch(e) { return { ok: false, error: e.message }; }
}

// Navigation
function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-item').forEach((n, i) => n.classList.toggle('active', ['chats','agents','settings'][i] === page));
  document.getElementById('chat-view').classList.remove('active');
  document.getElementById('agent-detail').classList.remove('active');
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (page === 'chats') loadConversations();
  if (page === 'agents') loadAgents();
  if (page === 'settings') loadConfig();
}

// ===== CONVERSATIONS (Groups + DMs) =====
async function loadConversations() {
  const [roomData, dmData, agentData] = await Promise.all([
    api('GET', '/admin/rooms'),
    api('GET', '/admin/dms'),
    api('GET', '/admin/agents')
  ]);
  rooms = (roomData.result || []).filter(r => r.type !== 'dm');
  dms = dmData.result || [];
  agents = (agentData.result || []).filter(a => a.id !== 'system' && a.id !== 'user');
  renderConversationList();
}

function renderConversationList() {
  const el = document.getElementById('chat-list');
  const empty = document.getElementById('chats-empty');
  if (!rooms.length && !dms.length) { el.innerHTML = ''; empty.style.display = 'flex'; return; }
  empty.style.display = 'none';

  let html = '';
  // Groups
  if (rooms.length) {
    html += '<div class="list-section-title">群聊</div>';
    html += rooms.map((r, i) => {
      const preview = r.last_message ? r.last_message.sender_name + ': ' + r.last_message.text.slice(0, 30) : (r.members||[]).length + ' 个成员';
      const time = r.last_message ? (r.last_message.created_at||'').slice(11,16) : '';
      const color = AVATAR_COLORS[(i + 2) % AVATAR_COLORS.length];
      return '<div class="chat-item" onclick="openChat(\''+r.id+'\',\'group\')">'+
        '<div class="avatar" style="background:'+color+'">'+GROUP_ICON+'</div>'+
        '<div class="info"><div class="name">'+escapeHtml(r.name)+'</div><div class="preview">'+escapeHtml(preview)+'</div></div>'+
        '<div class="meta"><span class="time">'+time+'</span></div></div>';
    }).join('');
  }
  // DMs
  if (dms.length) {
    html += '<div class="list-section-title">私聊</div>';
    html += dms.map((dm, i) => {
      const agentName = dm.agent ? dm.agent.name : '未知';
      const agentIdx = agents.findIndex(a => a.id === (dm.agent||{}).id);
      const color = getAgentColor(agentIdx >= 0 ? agentIdx : i);
      const icon = getAgentIcon(agentIdx >= 0 ? agentIdx : i);
      const preview = dm.last_message ? dm.last_message.text.slice(0, 30) : '开始对话';
      const time = dm.last_message ? (dm.last_message.created_at||'').slice(11,16) : '';
      return '<div class="chat-item" onclick="openChat(\''+dm.id+'\',\'dm\')">'+
        '<div class="avatar round" style="background:'+color+'">'+icon+'</div>'+
        '<div class="info"><div class="name">'+escapeHtml(agentName)+'</div><div class="preview">'+escapeHtml(preview)+'</div></div>'+
        '<div class="meta"><span class="time">'+time+'</span></div></div>';
    }).join('');
  }
  el.innerHTML = html;
}

// ===== CHAT VIEW =====
function openChat(roomId, type) {
  currentRoomId = roomId;
  currentRoomType = type || 'group';
  let title = '';
  if (type === 'dm') {
    const dm = dms.find(d => d.id === roomId);
    title = dm && dm.agent ? dm.agent.name : '私聊';
    document.getElementById('chat-more-btn').style.display = 'none';
  } else {
    const room = rooms.find(r => r.id === roomId);
    title = room ? room.name : '群聊';
    document.getElementById('chat-more-btn').style.display = '';
  }
  document.getElementById('chat-title').textContent = title;
  document.getElementById('chat-view').classList.add('active');
  document.getElementById('typing-indicator').classList.remove('active');
  refreshMessages();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshMessages, 2000);
}

function closeChat() {
  document.getElementById('chat-view').classList.remove('active');
  currentRoomId = null;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function refreshMessages() {
  if (!currentRoomId) return;
  const data = await api('GET', '/admin/rooms/' + currentRoomId + '/messages?limit=100');
  const msgs = data.result || [];
  const area = document.getElementById('messages-area');
  const indicator = document.getElementById('typing-indicator');
  const atBottom = area.scrollHeight - area.scrollTop <= area.clientHeight + 80;

  // Check if we got a new AI reply
  if (isWaitingReply && msgs.length > 0) {
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg.sender_id !== 'user' && lastMsg.sender_id !== 'system') {
      isWaitingReply = false;
      indicator.classList.remove('active');
    }
  }

  let html = msgs.map(m => {
    const self = m.sender_id === 'user' || m.sender_id === 'system';
    const showName = !self && currentRoomType === 'group';
    return '<div class="msg '+(self?'self':'other')+'">'+
      (showName ? '<div class="sender-name">'+escapeHtml(m.sender_name)+'</div>' : '')+
      '<div class="msg-text">'+escapeHtml(m.text)+'</div>'+
      '<div class="msg-time">'+(m.created_at||'').slice(11,16)+'</div></div>';
  }).join('');
  
  // Keep typing indicator at end
  area.innerHTML = html;
  area.appendChild(indicator);
  if (atBottom || msgs.length <= 10) area.scrollTop = area.scrollHeight;
}

async function sendMsg() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text || !currentRoomId) return;

  // Handle slash commands
  if (text.startsWith('/')) {
    handleSlashCommand(text);
    input.value = ''; autoResize(input);
    return;
  }

  input.value = ''; autoResize(input);
  hideAutocomplete();

  // Parse @mentions
  const mentions = [];
  const mentionRegex = /@(\S+)/g;
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const agent = agents.find(a => a.name === match[1]);
    if (agent) mentions.push(agent.id);
  }

  // Show typing indicator
  isWaitingReply = true;
  document.getElementById('typing-indicator').classList.add('active');
  const area = document.getElementById('messages-area');
  area.scrollTop = area.scrollHeight;

  await api('POST', '/admin/rooms/' + currentRoomId + '/send', { text, mentions });
  refreshMessages();

  // Auto-hide typing after 30s max
  setTimeout(() => {
    isWaitingReply = false;
    document.getElementById('typing-indicator').classList.remove('active');
  }, 30000);
}

function handleSlashCommand(text) {
  const cmd = text.split(' ')[0];
  if (cmd === '/clear') {
    showToast('对话已清空（仅前端）');
    document.getElementById('messages-area').innerHTML = '';
    document.getElementById('messages-area').appendChild(document.getElementById('typing-indicator'));
  } else if (cmd === '/help') {
    showToast('可用指令: /clear /help /members');
  } else if (cmd === '/members') {
    showRoomSettings();
  } else {
    showToast('未知指令: ' + cmd);
  }
}

function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; }

// ===== AUTOCOMPLETE (@mentions and /commands) =====
function onInputChange(el) {
  autoResize(el);
  const text = el.value;
  const cursorPos = el.selectionStart;
  
  // Check for / at start
  if (text.startsWith('/') && !text.includes(' ')) {
    const query = text.slice(1).toLowerCase();
    const matches = SLASH_COMMANDS.filter(c => c.cmd.slice(1).startsWith(query));
    if (matches.length > 0) {
      showSlashAutocomplete(matches);
      return;
    }
  }

  // Check for @ mention
  const beforeCursor = text.slice(0, cursorPos);
  const atMatch = beforeCursor.match(/@([^\s]*)$/);
  if (atMatch) {
    const query = atMatch[1].toLowerCase();
    const roomMembers = getCurrentRoomMembers();
    const matches = roomMembers.filter(a => a.name.toLowerCase().includes(query));
    if (matches.length > 0) {
      showMentionAutocomplete(matches);
      return;
    }
  }

  hideAutocomplete();
}

function onInputKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    const ac = document.getElementById('autocomplete');
    if (ac.classList.contains('active')) {
      // Select first item
      const first = ac.querySelector('.autocomplete-item');
      if (first) first.click();
    } else {
      sendMsg();
    }
  }
  if (event.key === 'Escape') {
    hideAutocomplete();
  }
}

function getCurrentRoomMembers() {
  if (currentRoomType === 'group') {
    const room = rooms.find(r => r.id === currentRoomId);
    return (room && room.members) ? room.members.filter(m => m.id !== 'user' && m.id !== 'system') : agents;
  }
  return agents;
}

function showMentionAutocomplete(matches) {
  const ac = document.getElementById('autocomplete');
  ac.innerHTML = matches.map((a, i) => {
    const idx = agents.findIndex(ag => ag.id === a.id);
    const color = getAgentColor(idx >= 0 ? idx : i);
    const icon = getAgentIcon(idx >= 0 ? idx : i);
    return '<div class="autocomplete-item" onclick="insertMention(\''+escapeHtml(a.name)+'\')">'+
      '<div class="ac-avatar" style="background:'+color+'">'+icon+'</div>'+
      '<span class="ac-name">'+escapeHtml(a.name)+'</span></div>';
  }).join('');
  ac.classList.add('active');
}

function showSlashAutocomplete(matches) {
  const ac = document.getElementById('autocomplete');
  ac.innerHTML = matches.map(c =>
    '<div class="autocomplete-item" onclick="insertSlashCommand(\''+c.cmd+'\')">'+
      '<span class="ac-icon">/</span>'+
      '<span class="ac-name">'+c.cmd+'</span>'+
      '<span class="ac-desc" style="margin-left:auto">'+c.desc+'</span></div>'
  ).join('');
  ac.classList.add('active');
}

function hideAutocomplete() {
  document.getElementById('autocomplete').classList.remove('active');
}

function insertMention(name) {
  const input = document.getElementById('msg-input');
  const text = input.value;
  const cursorPos = input.selectionStart;
  const beforeCursor = text.slice(0, cursorPos);
  const afterCursor = text.slice(cursorPos);
  const newBefore = beforeCursor.replace(/@[^\s]*$/, '@' + name + ' ');
  input.value = newBefore + afterCursor;
  input.focus();
  input.selectionStart = input.selectionEnd = newBefore.length;
  hideAutocomplete();
}

function insertSlashCommand(cmd) {
  const input = document.getElementById('msg-input');
  input.value = cmd + ' ';
  input.focus();
  hideAutocomplete();
}

// ===== AGENTS =====
async function loadAgents() {
  const data = await api('GET', '/admin/agents');
  agents = (data.result || []).filter(a => a.id !== 'system' && a.id !== 'user');
  renderAgents();
}

function renderAgents() {
  const el = document.getElementById('agent-grid');
  const empty = document.getElementById('agents-empty');
  if (!agents.length) { el.innerHTML = ''; empty.style.display = 'flex'; return; }
  empty.style.display = 'none';
  el.innerHTML = agents.map((a, i) => {
    return '<div class="agent-card">'+
      '<div class="agent-avatar" style="background:'+getAgentColor(i)+'">'+getAgentIcon(i)+'</div>'+
      '<div class="agent-name">'+escapeHtml(a.name)+'</div>'+
      '<div class="agent-desc">'+escapeHtml(a.description||'通用智能体')+'</div>'+
      '<div class="agent-status"><span class="dot '+(a.status==='online'?'online':'offline')+'"></span>'+(a.status==='online'?'在线':'离线')+'</div>'+
      '<div class="card-actions">'+
        '<button class="btn-chat" onclick="event.stopPropagation();startDM(\''+a.id+'\')">发消息</button>'+
        '<button class="btn-edit" onclick="event.stopPropagation();openAgentDetail(\''+a.id+'\')">编辑</button>'+
      '</div></div>';
  }).join('');
}

async function startDM(agentId) {
  const data = await api('POST', '/admin/dm/' + agentId);
  if (data.ok) {
    // Switch to chats page and open the DM
    await loadConversations();
    switchPage('chats');
    setTimeout(() => openChat(data.result.room_id, 'dm'), 100);
  } else {
    showToast(data.error || '创建私聊失败');
  }
}

function openAgentDetail(id) {
  const agent = agents.find(a => a.id === id);
  if (!agent) return;
  currentAgentId = id;
  const idx = agents.indexOf(agent);
  document.getElementById('agent-edit-avatar').style.background = getAgentColor(idx);
  document.getElementById('agent-edit-avatar').innerHTML = getAgentIcon(idx);
  document.getElementById('agent-edit-name').value = agent.name;
  document.getElementById('agent-edit-desc').value = agent.description || '';
  document.getElementById('agent-edit-status').value = agent.status === 'online' ? '在线' : '离线';
  document.getElementById('agent-detail').classList.add('active');
}

function closeAgentDetail() {
  document.getElementById('agent-detail').classList.remove('active');
  currentAgentId = null;
}

async function saveAgent() {
  if (!currentAgentId) return;
  const name = document.getElementById('agent-edit-name').value.trim();
  const desc = document.getElementById('agent-edit-desc').value.trim();
  if (!name) { showToast('名称不能为空'); return; }
  await api('PUT', '/admin/agents/' + currentAgentId, { name, description: desc });
  showToast('已保存');
  closeAgentDetail();
  loadAgents();
}

async function deleteAgent() {
  if (!currentAgentId) return;
  if (!confirm('确定删除该智能体？此操作不可撤销。')) return;
  await api('DELETE', '/admin/agents/' + currentAgentId);
  showToast('已删除');
  closeAgentDetail();
  loadAgents();
}

// ===== CONFIG =====
async function loadConfig() {
  const data = await api('GET', '/admin/config');
  if (data.ok) {
    const c = data.result;
    document.getElementById('current-model-display').textContent = c.model || '-';
    document.getElementById('config-status').textContent = c.has_key ? '已配置' : '点击配置';
  }
}

function showModelSetup() {
  api('GET', '/admin/config').then(data => {
    if (data.ok) {
      document.getElementById('setup-base-url').value = data.result.base_url || '';
      document.getElementById('setup-base-url-2').value = data.result.base_url || '';
      document.getElementById('setup-api-key').value = '';
      document.getElementById('setup-api-key-2').value = '';
      document.getElementById('setup-api-key').placeholder = data.result.has_key ? 'API Key (留空使用已保存的密钥)' : 'API Key (sk-...)';
      document.getElementById('setup-api-key-2').placeholder = data.result.has_key ? 'API Key (留空使用已保存的密钥)' : 'API Key (sk-...)';
      document.getElementById('setup-custom-model').value = data.result.model || '';
    }
  });
  document.getElementById('model-list-container').style.display = 'none';
  document.getElementById('model-fetch-status').innerHTML = '';
  selectedModel = '';
  switchModelTab('fetch');
  document.getElementById('modal-model-setup').classList.add('active');
}

function switchModelTab(tab) {
  modelTab = tab;
  document.getElementById('model-tab-fetch').style.display = tab === 'fetch' ? 'block' : 'none';
  document.getElementById('model-tab-custom').style.display = tab === 'custom' ? 'block' : 'none';
  document.querySelectorAll('#modal-model-setup .tab').forEach((t, i) => t.classList.toggle('active', (i === 0 && tab === 'fetch') || (i === 1 && tab === 'custom')));
}

async function fetchModels() {
  const baseUrl = document.getElementById('setup-base-url').value.trim();
  const apiKey = document.getElementById('setup-api-key').value.trim();
  document.getElementById('fetch-models-btn').disabled = true;
  document.getElementById('fetch-models-btn').innerHTML = '<span class="spinner"></span> 获取中...';
  const body = {};
  if (baseUrl) body.base_url = baseUrl;
  if (apiKey) body.api_key = apiKey;
  const data = await api('POST', '/admin/config/models', body);
  document.getElementById('fetch-models-btn').disabled = false;
  document.getElementById('fetch-models-btn').textContent = '获取模型列表';
  if (data.ok && data.result.length > 0) {
    document.getElementById('model-fetch-status').innerHTML = '<div class="status-msg success">获取到 '+data.result.length+' 个模型</div>';
    renderModelList(data.result);
    document.getElementById('model-list-container').style.display = 'block';
  } else if (data.ok) {
    document.getElementById('model-fetch-status').innerHTML = '<div class="status-msg error">未获取到模型</div>';
  } else {
    document.getElementById('model-fetch-status').innerHTML = '<div class="status-msg error">'+(data.error||'获取失败')+'</div>';
  }
}

function renderModelList(models) {
  const el = document.getElementById('model-list');
  el.innerHTML = models.map(m =>
    '<div class="model-item" onclick="selectModel(\''+m.id.replace(/'/g, "\\'")+'\')">' +
    '<span class="check"></span><span>'+escapeHtml(m.name)+'</span></div>'
  ).join('');
}

function selectModel(id) {
  selectedModel = id;
  document.querySelectorAll('.model-item').forEach(el => {
    el.classList.toggle('selected', el.querySelector('span:last-child').textContent === id);
  });
}

async function saveModelSetup() {
  let baseUrl, apiKey, model;
  if (modelTab === 'fetch') {
    baseUrl = document.getElementById('setup-base-url').value.trim();
    apiKey = document.getElementById('setup-api-key').value.trim();
    model = selectedModel;
  } else {
    baseUrl = document.getElementById('setup-base-url-2').value.trim();
    apiKey = document.getElementById('setup-api-key-2').value.trim();
    model = document.getElementById('setup-custom-model').value.trim();
  }
  if (!baseUrl && !model) { showToast('请至少填写 API 地址或模型名称'); return; }
  const body = {};
  if (baseUrl) body.base_url = baseUrl;
  if (apiKey) body.api_key = apiKey;
  if (model) body.model = model;
  try { const host = new URL(baseUrl).hostname.split('.')[0]; body.provider_name = host; }
  catch(e) { body.provider_name = 'custom'; }
  const data = await api('POST', '/admin/config', body);
  if (data.ok) { closeModals(); loadConfig(); showToast('配置已保存'); }
  else { showToast(data.error || '保存失败'); }
}

// ===== MODALS =====
function showCreateRoom() { document.getElementById('modal-room').classList.add('active'); }
function showCreateAgent() { document.getElementById('modal-agent').classList.add('active'); }
function closeModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active')); }

async function createRoom() {
  const name = document.getElementById('room-name').value.trim();
  if (!name) return;
  await api('POST', '/admin/rooms', { name, description: document.getElementById('room-desc').value.trim() });
  document.getElementById('room-name').value = '';
  document.getElementById('room-desc').value = '';
  closeModals(); loadConversations();
}

async function createAgent() {
  const name = document.getElementById('new-agent-name').value.trim();
  if (!name) return;
  await api('POST', '/admin/agents', { name, description: document.getElementById('new-agent-desc').value.trim() });
  document.getElementById('new-agent-name').value = '';
  document.getElementById('new-agent-desc').value = '';
  closeModals(); loadAgents();
}

// Room settings
function showRoomSettings() {
  if (!currentRoomId) return;
  const room = rooms.find(r => r.id === currentRoomId);
  if (!room) return;
  document.getElementById('room-settings-title').textContent = room.name + ' - 设置';
  const members = room.members || [];
  document.getElementById('room-members-list').innerHTML =
    '<div class="hint">成员 ('+members.length+')</div>' +
    members.map(m => '<div style="padding:8px 0;font-size:14px;border-bottom:0.5px solid var(--border)">'+escapeHtml(m.name)+'</div>').join('');
  const select = document.getElementById('add-member-select');
  const available = agents.filter(a => !members.find(m => m.id === a.id));
  select.innerHTML = available.length ?
    available.map(a => '<option value="'+a.id+'">'+escapeHtml(a.name)+'</option>').join('') :
    '<option disabled>无可添加的智能体</option>';
  document.getElementById('modal-room-settings').classList.add('active');
}

async function addMemberToRoom() {
  const agentId = document.getElementById('add-member-select').value;
  if (!agentId || !currentRoomId) return;
  await api('POST', '/admin/rooms/' + currentRoomId + '/members', { agent_id: agentId });
  showToast('已添加');
  closeModals(); loadConversations();
}

async function deleteCurrentRoom() {
  if (!confirm('确定删除该群聊？')) return;
  await api('DELETE', '/admin/rooms/' + currentRoomId);
  closeModals(); closeChat(); loadConversations();
  showToast('已删除');
}

// Init
initTheme();
loadConversations();
loadAgents();
loadConfig();
