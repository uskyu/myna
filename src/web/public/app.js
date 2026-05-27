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
let ws = null;
let activeStreams = {}; // streamId -> { roomId, agentId, agentName, text }

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
function escapeHtml(s) { if (!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function renderMarkdown(text) {
  if (!text) return '';
  if (typeof marked !== 'undefined' && marked.parse) {
    try {
      marked.setOptions({ breaks: true, gfm: true });
      let html = marked.parse(text);
      // Wrap tables in scrollable container
      html = html.replace(/<table>/g, '<div class="table-wrapper"><table>').replace(/<\/table>/g, '</table></div>');
      // Style images in messages
      html = html.replace(/<img /g, '<img style="max-width:100%;max-height:300px;border-radius:8px;cursor:pointer;display:block;margin:4px 0" onclick="window.open(this.src)" ');
      // Add copy buttons to code blocks
      html = html.replace(/<pre><code(.*?)>([\s\S]*?)<\/code><\/pre>/g, (match, attrs, code) => {
        const decoded = code.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
        const escaped = decoded.replace(/'/g, '&#39;').replace(/\\/g, '\\\\');
        return `<pre><code${attrs}>${code}<button class="copy-btn" onclick="copyCode(this, '${btoa(unescape(encodeURIComponent(decoded)))}')">复制</button></code></pre>`;
      });
      return html;
    } catch (e) {
      return escapeHtml(text);
    }
  }
  return escapeHtml(text);
}

// Copy code block content
function copyCode(btn, encoded) {
  try {
    const text = decodeURIComponent(escape(atob(encoded)));
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = '已复制';
      setTimeout(() => btn.textContent = '复制', 1500);
    });
  } catch(e) {
    // Fallback
    btn.textContent = '失败';
    setTimeout(() => btn.textContent = '复制', 1500);
  }
}

// Render user messages — full markdown support
function renderUserMessage(text) {
  if (!text) return '';
  return renderMarkdown(text);
}

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
  if (page === 'settings') loadModelConfigs();
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

  // Collect active stream room IDs
  const activeRoomIds = new Set();
  const activeRoomAgents = {};
  for (const sid in activeStreams) {
    const s = activeStreams[sid];
    activeRoomIds.add(s.roomId);
    activeRoomAgents[s.roomId] = s.agentName;
  }

  let html = '';
  // Groups
  if (rooms.length) {
    html += '<div class="list-section-title">群聊</div>';
    html += rooms.map((r, i) => {
      const preview = r.last_message ? r.last_message.sender_name + ': ' + r.last_message.text.slice(0, 30) : (r.members||[]).length + ' 个成员';
      const time = r.last_message ? (r.last_message.created_at||'').slice(11,16) : '';
      const color = AVATAR_COLORS[(i + 2) % AVATAR_COLORS.length];
      const isActive = activeRoomIds.has(r.id);
      const activeBadge = isActive ? '<span class="active-badge"><span class="pulse-dot"></span>' + escapeHtml(activeRoomAgents[r.id] || 'AI') + ' 生成中</span>' : '';
      return '<div class="chat-item" onclick="openChat(\''+r.id+'\',\'group\')">'+
        '<div class="avatar" style="background:'+color+'">'+GROUP_ICON+'</div>'+
        '<div class="info"><div class="name">'+escapeHtml(r.name)+'</div><div class="preview">'+escapeHtml(preview)+'</div></div>'+
        '<div class="meta"><span class="time">'+time+'</span>'+activeBadge+'</div></div>';
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
      const isActive = activeRoomIds.has(dm.id);
      const activeBadge = isActive ? '<span class="active-badge"><span class="pulse-dot"></span>生成中</span>' : '';
      return '<div class="chat-item" onclick="openChat(\''+dm.id+'\',\'dm\')">'+
        '<div class="avatar round" style="background:'+color+'">'+icon+'</div>'+
        '<div class="info"><div class="name">'+escapeHtml(agentName)+'</div><div class="preview">'+escapeHtml(preview)+'</div></div>'+
        '<div class="meta"><span class="time">'+time+'</span>'+activeBadge+'</div></div>';
    }).join('');
  }
  el.innerHTML = html;
}

// Debounced conversation list refresh to prevent flicker
let _convListTimer = null;
function renderConversationListDebounced() {
  if (_convListTimer) clearTimeout(_convListTimer);
  _convListTimer = setTimeout(renderConversationList, 300);
}
function updateRoomTypingState(roomId, isTyping, agentName, lastText) {
  const chatItems = document.querySelectorAll('.chat-item');
  for (const item of chatItems) {
    const onclick = item.getAttribute('onclick') || '';
    if (!onclick.includes(roomId)) continue;
    
    const previewEl = item.querySelector('.preview');
    if (!previewEl) continue;
    
    if (isTyping) {
      previewEl.innerHTML = '<span class="typing-dots">' + (agentName ? escapeHtml(agentName) + ' ' : '') + 
        '<span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
    } else if (lastText) {
      previewEl.textContent = lastText.slice(0, 40);
    }
    break;
  }
}

// ===== CHAT VIEW =====
function openChat(roomId, type) {
  currentRoomId = roomId;
  currentRoomType = type || 'group';
  lastRenderedMsgCount = 0;
  lastRenderedMsgId = 0;
  let title = '';
  let subtitle = '';
  if (type === 'dm') {
    const dm = dms.find(d => d.id === roomId);
    title = dm && dm.agent ? dm.agent.name : '私聊';
    document.getElementById('chat-more-btn').style.display = 'none';
  } else {
    const room = rooms.find(r => r.id === roomId);
    title = room ? room.name : '群聊';
    const memberCount = room && room.members ? room.members.length : 0;
    subtitle = memberCount + ' 个成员';
    document.getElementById('chat-more-btn').style.display = '';
  }
  const titleEl = document.getElementById('chat-title');
  titleEl.innerHTML = escapeHtml(title) + (subtitle ? '<span style="font-size:12px;color:var(--text-dim);font-weight:400;margin-left:8px">' + subtitle + '</span>' : '');
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
  // Refresh conversation list and agents to show updated last_message & status
  loadConversations();
  loadAgents();
}

let lastRenderedMsgCount = 0;
let lastRenderedMsgId = 0;

async function refreshMessages() {
  if (!currentRoomId) return;
  // Don't refresh while streaming — the WS handles live updates
  if (Object.keys(activeStreams).some(k => activeStreams[k].roomId === currentRoomId)) return;
  
  const data = await api('GET', '/admin/rooms/' + currentRoomId + '/messages?limit=100');
  const msgs = data.result || [];
  const area = document.getElementById('messages-area');
  const indicator = document.getElementById('typing-indicator');

  // Check if we got a new AI reply
  if (isWaitingReply && msgs.length > 0) {
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg.sender_id !== 'user' && lastMsg.sender_id !== 'system') {
      isWaitingReply = false;
      indicator.classList.remove('active');
    }
  }

  // Skip re-render if nothing changed
  const latestId = msgs.length > 0 ? msgs[msgs.length - 1].id : 0;
  if (msgs.length === lastRenderedMsgCount && latestId === lastRenderedMsgId) return;
  
  const atBottom = area.scrollHeight - area.scrollTop <= area.clientHeight + 80;
  
  lastRenderedMsgCount = msgs.length;
  lastRenderedMsgId = latestId;

  let html = '';
  let prevSender = null;
  let prevTime = null;
  let groupOpen = false;

  msgs.forEach((m, idx) => {
    const self = m.sender_id === 'user' || m.sender_id === 'system';
    const senderId = m.sender_id;
    const msgTime = (m.created_at || '').slice(11, 16);
    const msgDate = (m.created_at || '').slice(0, 10);
    const prevDate = prevTime ? prevTime.slice(0, 10) : null;

    // Time separator between different days
    if (prevDate && msgDate !== prevDate) {
      if (groupOpen) { html += '</div>'; groupOpen = false; }
      html += `<div class="time-separator"><span>${msgDate}</span></div>`;
    }

    // Check if this is a continuation of the same sender group
    const sameGroup = senderId === prevSender && (self || currentRoomType === 'group');

    if (!sameGroup) {
      if (groupOpen) html += '</div>';
      html += `<div class="msg-group ${self ? 'self' : ''}">`;
      groupOpen = true;
    }

    const rendered = self ? renderUserMessage(m.text) : renderMarkdown(m.text);
    const showName = !self && currentRoomType === 'group' && !sameGroup;

    html += '<div class="msg ' + (self ? 'self' : 'other') + '">' +
      (showName ? '<div class="sender-name">' + escapeHtml(m.sender_name) + '</div>' : '') +
      '<div class="msg-text">' + rendered + '</div>' +
      '<div class="msg-time">' + msgTime + '</div></div>';

    prevSender = senderId;
    prevTime = m.created_at;
  });

  if (groupOpen) html += '</div>';

  area.innerHTML = html;
  area.appendChild(indicator);
  if (atBottom || msgs.length <= 10) area.scrollTop = area.scrollHeight;
}

// ===== FILE UPLOAD =====
let pendingAttachments = []; // [{url, type, name, size}]

function triggerFileUpload() {
  document.getElementById('file-input').click();
}

async function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = ''; // reset for re-select
  
  const formData = new FormData();
  formData.append('file', file);
  
  const previewEl = document.getElementById('upload-preview');
  previewEl.style.display = 'flex';
  previewEl.innerHTML = '<div style="display:flex;align-items:center;gap:8px;width:100%"><span style="font-size:12px;color:var(--text-dim)">上传中...</span></div>';
  
  try {
    const resp = await fetch('/admin/upload', { method: 'POST', body: formData });
    const data = await resp.json();
    if (data.ok) {
      pendingAttachments.push(data);
      renderUploadPreview();
    } else {
      previewEl.innerHTML = '<span style="color:var(--danger);font-size:12px">上传失败: ' + escapeHtml(data.error || '未知错误') + '</span>';
      setTimeout(() => { previewEl.style.display = 'none'; }, 2000);
    }
  } catch(e) {
    previewEl.innerHTML = '<span style="color:var(--danger);font-size:12px">上传失败</span>';
    setTimeout(() => { previewEl.style.display = 'none'; }, 2000);
  }
}

function renderUploadPreview() {
  const previewEl = document.getElementById('upload-preview');
  if (!pendingAttachments.length) { previewEl.style.display = 'none'; return; }
  previewEl.style.display = 'flex';
  previewEl.style.gap = '8px';
  previewEl.style.flexWrap = 'wrap';
  previewEl.style.alignItems = 'center';
  previewEl.innerHTML = pendingAttachments.map((att, i) => {
    if (att.type === 'image') {
      return '<div style="position:relative;display:inline-block">' +
        '<img src="' + att.url + '" style="height:60px;border-radius:8px;object-fit:cover">' +
        '<button onclick="removeAttachment(' + i + ')" style="position:absolute;top:-4px;right:-4px;width:18px;height:18px;border-radius:50%;background:var(--danger);color:white;border:none;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center">×</button></div>';
    }
    return '<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--surface2);border-radius:8px;position:relative">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
      '<span style="font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(att.name) + '</span>' +
      '<button onclick="removeAttachment(' + i + ')" style="margin-left:4px;background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px">×</button></div>';
  }).join('');
}

function removeAttachment(idx) {
  pendingAttachments.splice(idx, 1);
  renderUploadPreview();
}

async function sendMsg() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text && !pendingAttachments.length) return;
  if (!currentRoomId) return;

  // Handle slash commands
  if (text.startsWith('/') && !pendingAttachments.length) {
    handleSlashCommand(text);
    input.value = ''; autoResize(input);
    return;
  }

  input.value = ''; autoResize(input);
  hideAutocomplete();

  // Collect attachments
  const attachments = [...pendingAttachments];
  pendingAttachments = [];
  renderUploadPreview();

  // Parse @mentions
  const mentions = [];
  const mentionRegex = /@(\S+)/g;
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const agent = agents.find(a => a.name === match[1]);
    if (agent) mentions.push(agent.id);
  }

  // Build message text with attachments
  let fullText = text;
  if (attachments.length) {
    const attParts = attachments.map(a => a.type === 'image' ? `![${a.name}](${a.url})` : `[${a.name}](${a.url})`);
    fullText = fullText ? fullText + '\n' + attParts.join('\n') : attParts.join('\n');
  }

  // Immediately show user's message in the chat (optimistic UI)
  const area = document.getElementById('messages-area');
  const indicator = document.getElementById('typing-indicator');
  const bubble = document.createElement('div');
  bubble.className = 'msg self';
  let msgHtml = '';
  if (attachments.length) {
    msgHtml += attachments.map(a => {
      if (a.type === 'image') return '<img src="' + a.url + '" style="max-width:200px;max-height:200px;border-radius:8px;margin-bottom:4px;display:block;cursor:pointer" onclick="window.open(this.src)">';
      return '<a href="' + a.url + '" target="_blank" style="display:flex;align-items:center;gap:4px;font-size:13px;color:var(--accent);margin-bottom:4px">📎 ' + escapeHtml(a.name) + '</a>';
    }).join('');
  }
  if (text) msgHtml += '<div class="msg-text">' + escapeHtml(text) + '</div>';
  msgHtml += '<div class="msg-time">' + new Date().toTimeString().slice(0, 5) + '</div>';
  bubble.innerHTML = msgHtml;
  area.insertBefore(bubble, indicator);
  area.scrollTop = area.scrollHeight;

  // Show typing indicator (three dots)
  isWaitingReply = true;
  indicator.classList.add('active');
  area.scrollTop = area.scrollHeight;

  await api('POST', '/admin/rooms/' + currentRoomId + '/send', { text: fullText, mentions });

  // Auto-hide typing after 60s max
  setTimeout(() => {
    isWaitingReply = false;
    document.getElementById('typing-indicator').classList.remove('active');
  }, 60000);
}

function handleSlashCommand(text) {
  const cmd = text.split(' ')[0];
  if (cmd === '/clear') {
    if (currentRoomId) {
      api('DELETE', '/admin/rooms/' + currentRoomId + '/messages').then(data => {
        if (data.ok) {
          showToast('对话已清空');
          refreshMessages();
        } else {
          showToast('清空失败: ' + (data.error || '未知错误'));
        }
      });
    }
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

// Trigger @ menu from button click
function triggerAtMenu() {
  const input = document.getElementById('msg-input');
  const cursorPos = input.selectionStart;
  const text = input.value;
  // Insert @ at cursor position
  input.value = text.slice(0, cursorPos) + '@' + text.slice(cursorPos);
  input.focus();
  input.selectionStart = input.selectionEnd = cursorPos + 1;
  // Show all room members
  const roomMembers = getCurrentRoomMembers();
  if (roomMembers.length > 0) {
    showMentionAutocomplete(roomMembers);
  } else {
    showToast('当前群聊没有智能体成员');
  }
}

// ===== AGENTS =====
async function loadAgents() {
  const data = await api('GET', '/admin/agents');
  agents = (data.result || []).filter(a => a.id !== 'system' && a.id !== 'user');
  // Sync sort dropdown
  const sortSelect = document.getElementById('agent-sort-select');
  if (sortSelect) sortSelect.value = agentSort;
  renderAgents();
}

function renderAgents() {
  const el = document.getElementById('agent-grid');
  const empty = document.getElementById('agents-empty');
  const sorted = getSortedAgents();
  if (!sorted.length) {
    el.innerHTML = '';
    empty.style.display = 'flex';
    if (agentFilter) {
      empty.querySelector('p').textContent = '没有匹配的智能体';
    } else {
      empty.querySelector('p').textContent = '还没有智能体';
    }
    return;
  }
  empty.style.display = 'none';
  el.innerHTML = sorted.map((a) => {
    const i = agents.indexOf(a);
    return '<div class="agent-card" onclick="openAgentDetail(\'' + a.id + '\')">' +
      '<div class="agent-avatar" style="background:' + getAgentColor(i) + '">' + getAgentIcon(i) + '</div>' +
      '<div class="agent-name">' + escapeHtml(a.name) + '</div>' +
      '<div class="agent-desc">' + escapeHtml(a.description || '通用智能体') + '</div>' +
      '<div class="agent-status"><span class="dot ' + (a.status === 'online' ? 'online' : 'offline') + '"></span>' + (a.status === 'online' ? '在线' : '离线') + '</div>' +
      '<div class="card-actions">' +
        '<button class="btn-chat" onclick="event.stopPropagation();startDM(\'' + a.id + '\')">发消息</button>' +
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
  
  // Fill profile info
  document.getElementById('agent-detail-avatar').style.background = getAgentColor(idx);
  document.getElementById('agent-detail-avatar').innerHTML = getAgentIcon(idx);
  document.getElementById('agent-detail-name').textContent = agent.name;
  document.getElementById('agent-detail-desc').textContent = agent.description || '通用智能体';
  document.getElementById('agent-detail-title').textContent = agent.name;
  document.getElementById('agent-detail-status').innerHTML = '<span class="dot ' + (agent.status === 'online' ? 'online' : 'offline') + '"></span>' + (agent.status === 'online' ? '在线' : '离线');
  
  // Fill edit fields
  document.getElementById('agent-edit-name').value = agent.name;
  document.getElementById('agent-edit-desc').value = agent.description || '';
  editAgentStatus = agent.status || 'online';
  const toggle = document.getElementById('agent-status-toggle');
  const label = document.getElementById('agent-status-label');
  if (toggle) toggle.classList.toggle('on', editAgentStatus === 'online');
  if (label) label.textContent = editAgentStatus === 'online' ? '在线' : '离线';
  
  // Hide edit section by default
  document.getElementById('agent-edit-section').style.display = 'none';
  
  // Load model configs for the select dropdown
  loadAgentModelSelect(agent.model_config_id);
  
  document.getElementById('agent-detail').classList.add('active');
}

function toggleAgentEdit() {
  const section = document.getElementById('agent-edit-section');
  section.style.display = section.style.display === 'none' ? 'block' : 'none';
}

async function loadAgentModelSelect(currentConfigId) {
  const select = document.getElementById('agent-edit-model');
  select.innerHTML = '<option value="">使用默认配置</option>';
  const data = await api('GET', '/admin/models');
  if (data.ok && data.result) {
    data.result.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name + ' (' + c.model + ')';
      if (c.id === currentConfigId) opt.selected = true;
      select.appendChild(opt);
    });
  }
}

function closeAgentDetail() {
  document.getElementById('agent-detail').classList.remove('active');
  currentAgentId = null;
}

async function saveAgent() {
  if (!currentAgentId) return;
  const name = document.getElementById('agent-edit-name').value.trim();
  const desc = document.getElementById('agent-edit-desc').value.trim();
  const modelConfigId = document.getElementById('agent-edit-model').value || null;
  if (!name) { showToast('名称不能为空'); return; }
  await api('PUT', '/admin/agents/' + currentAgentId, { name, description: desc, status: editAgentStatus, model_config_id: modelConfigId });
  showToast('已保存');
  document.getElementById('agent-edit-section').style.display = 'none';
  loadAgents();
  // Refresh detail view
  setTimeout(() => openAgentDetail(currentAgentId), 200);
}

async function deleteAgent() {
  if (!currentAgentId) return;
  if (!confirm('确定删除该智能体？此操作不可撤销。')) return;
  await api('DELETE', '/admin/agents/' + currentAgentId);
  showToast('已删除');
  closeAgentDetail();
  loadAgents();
}

// ===== MODEL CONFIGS (Multi-provider) =====
let modelConfigs = [];
let editingModelConfigId = null;

async function loadModelConfigs() {
  const data = await api('GET', '/admin/models');
  if (data.ok) {
    modelConfigs = data.result || [];
    const countEl = document.getElementById('model-config-count');
    if (countEl) countEl.textContent = modelConfigs.length + ' 个配置';
  }
}

function showModelConfigs() {
  loadModelConfigs().then(() => {
    renderModelConfigsList();
    document.getElementById('modal-model-configs').classList.add('active');
  });
}

function renderModelConfigsList() {
  const el = document.getElementById('model-configs-list');
  if (!modelConfigs.length) {
    el.innerHTML = '<div class="hint" style="text-align:center;padding:20px">暂无模型配置<br>点击下方按钮添加</div>';
    return;
  }
  el.innerHTML = modelConfigs.map(c => 
    '<div style="display:flex;align-items:center;padding:12px;border-bottom:0.5px solid var(--border);gap:12px">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:600;font-size:15px">' + escapeHtml(c.name) + (c.is_default ? ' <span style="font-size:11px;background:var(--accent);color:white;padding:2px 6px;border-radius:4px">默认</span>' : '') + '</div>' +
        '<div style="font-size:13px;color:var(--text-dim);margin-top:2px">' + escapeHtml(c.provider) + ' · ' + escapeHtml(c.model) + '</div>' +
      '</div>' +
      '<button onclick="editModelConfig(\'' + c.id + '\')" style="background:none;border:none;color:var(--accent);font-size:14px;cursor:pointer">编辑</button>' +
      '<button onclick="deleteModelConfig(\'' + c.id + '\')" style="background:none;border:none;color:#e53e3e;font-size:14px;cursor:pointer">删除</button>' +
    '</div>'
  ).join('');
}

function showAddModelConfig() {
  editingModelConfigId = null;
  document.getElementById('model-edit-title').textContent = '添加供应商';
  document.getElementById('mc-name').value = '';
  document.getElementById('mc-provider').value = '';
  document.getElementById('mc-base-url').value = '';
  document.getElementById('mc-api-key').value = '';
  document.getElementById('mc-api-key').placeholder = 'API Key';
  document.getElementById('mc-model').value = '';
  document.getElementById('mc-context-length').value = '4096';
  document.getElementById('mc-max-tokens').value = '2048';
  document.getElementById('mc-temperature').value = '0.7';
  document.getElementById('mc-top-p').value = '1';
  document.getElementById('mc-freq-penalty').value = '0';
  document.getElementById('mc-pres-penalty').value = '0';
  document.getElementById('mc-is-default').checked = modelConfigs.length === 0;
  document.getElementById('mc-model-list').style.display = 'none';
  document.getElementById('mc-fetch-status').innerHTML = '';
  document.getElementById('modal-model-edit').classList.add('active');
}

function editModelConfig(id) {
  const c = modelConfigs.find(x => x.id === id);
  if (!c) return;
  editingModelConfigId = id;
  document.getElementById('model-edit-title').textContent = '编辑供应商';
  document.getElementById('mc-name').value = c.name;
  document.getElementById('mc-provider').value = c.provider;
  document.getElementById('mc-base-url').value = c.base_url;
  document.getElementById('mc-api-key').value = '';
  document.getElementById('mc-api-key').placeholder = 'API Key (留空不修改, 当前: ' + (c.api_key || '***') + ')';
  document.getElementById('mc-model').value = c.model;
  const params = c.params_json ? (typeof c.params_json === 'string' ? JSON.parse(c.params_json) : c.params_json) : {};
  document.getElementById('mc-context-length').value = params.context_length || c.context_length || 4096;
  document.getElementById('mc-max-tokens').value = params.max_tokens || c.max_tokens || 2048;
  document.getElementById('mc-temperature').value = params.temperature !== undefined ? params.temperature : (c.temperature !== undefined ? c.temperature : 0.7);
  document.getElementById('mc-top-p').value = params.top_p !== undefined ? params.top_p : 1;
  document.getElementById('mc-freq-penalty').value = params.frequency_penalty || 0;
  document.getElementById('mc-pres-penalty').value = params.presence_penalty || 0;
  document.getElementById('mc-is-default').checked = !!c.is_default;
  document.getElementById('mc-model-list').style.display = 'none';
  document.getElementById('mc-fetch-status').innerHTML = '';
  document.getElementById('modal-model-edit').classList.add('active');
}

async function fetchModelList() {
  const baseUrl = document.getElementById('mc-base-url').value.trim();
  const apiKey = document.getElementById('mc-api-key').value.trim();
  if (!baseUrl) { showToast('请先填写 API 地址'); return; }
  const btn = document.getElementById('mc-fetch-btn');
  btn.disabled = true;
  btn.textContent = '获取中...';
  document.getElementById('mc-fetch-status').innerHTML = '';
  try {
    const body = { base_url: baseUrl };
    if (apiKey) body.api_key = apiKey;
    const data = await api('POST', '/admin/config/models', body);
    btn.disabled = false;
    btn.textContent = '获取列表';
    if (data.ok && data.result && data.result.length > 0) {
      document.getElementById('mc-fetch-status').innerHTML = '<span style="color:var(--success)">获取到 ' + data.result.length + ' 个模型</span>';
      const listEl = document.getElementById('mc-model-list');
      listEl.style.display = 'block';
      listEl.innerHTML = data.result.map(m =>
        '<div style="padding:8px 12px;cursor:pointer;border-bottom:0.5px solid var(--border);font-size:14px" onclick="selectFetchedModel(\'' + escapeHtml(m.id).replace(/'/g, "\\'") + '\')">' + escapeHtml(m.id) + '</div>'
      ).join('');
    } else {
      document.getElementById('mc-fetch-status').innerHTML = '<span style="color:var(--danger)">' + (data.error || '未获取到模型') + '</span>';
      document.getElementById('mc-model-list').style.display = 'none';
    }
  } catch(e) {
    btn.disabled = false;
    btn.textContent = '获取列表';
    document.getElementById('mc-fetch-status').innerHTML = '<span style="color:var(--danger)">请求失败</span>';
  }
}

function selectFetchedModel(id) {
  document.getElementById('mc-model').value = id;
  document.getElementById('mc-model-list').style.display = 'none';
  document.getElementById('mc-fetch-status').innerHTML = '<span style="color:var(--success)">已选择: ' + escapeHtml(id) + '</span>';
  // Auto-lookup official params
  lookupModelMetadata(id);
}

// === Model Metadata Auto-fill ===
let modelLookupTimer = null;

function debounceModelLookup() {
  if (modelLookupTimer) clearTimeout(modelLookupTimer);
  modelLookupTimer = setTimeout(() => {
    const model = document.getElementById('mc-model').value.trim();
    if (model.length >= 3) lookupModelMetadata(model);
  }, 600);
}

async function lookupModelMetadata(modelId) {
  const hintEl = document.getElementById('mc-official-hint');
  const sourceEl = document.getElementById('mc-params-source');
  try {
    const data = await api('GET', '/admin/models/metadata?id=' + encodeURIComponent(modelId));
    if (data.ok && data.result) {
      const keys = Object.keys(data.result);
      if (keys.length === 0) {
        hintEl.style.display = 'none';
        sourceEl.textContent = '手动配置';
        return;
      }
      // Use exact match first, otherwise first result
      const matchKey = data.result[modelId] ? modelId : keys[0];
      const info = data.result[matchKey];
      
      if (info.max_input_tokens) {
        document.getElementById('mc-context-length').value = info.max_input_tokens;
      }
      if (info.max_output_tokens) {
        document.getElementById('mc-max-tokens').value = info.max_output_tokens;
      }
      
      hintEl.style.display = 'block';
      hintEl.innerHTML = '✓ 已匹配 <b>' + escapeHtml(matchKey) + '</b> — 上下文 ' + 
        (info.max_input_tokens ? (info.max_input_tokens / 1000) + 'K' : '?') + 
        '，最大输出 ' + (info.max_output_tokens ? (info.max_output_tokens / 1000) + 'K' : '?') +
        (info.supports_vision ? ' · 支持视觉' : '') +
        (info.supports_function_calling ? ' · 支持工具' : '');
      sourceEl.textContent = '官方推荐值 (可手动修改)';
    } else {
      hintEl.style.display = 'none';
      sourceEl.textContent = '手动配置';
    }
  } catch(e) {
    hintEl.style.display = 'none';
    sourceEl.textContent = '手动配置';
  }
}

function closeModelEdit() {
  document.getElementById('modal-model-edit').classList.remove('active');
}

async function saveModelConfig() {
  const name = document.getElementById('mc-name').value.trim();
  const provider = document.getElementById('mc-provider').value.trim();
  const base_url = document.getElementById('mc-base-url').value.trim();
  const api_key = document.getElementById('mc-api-key').value.trim();
  const model = document.getElementById('mc-model').value.trim();
  const context_length = parseInt(document.getElementById('mc-context-length').value) || 4096;
  const max_tokens = parseInt(document.getElementById('mc-max-tokens').value) || 2048;
  const temperature = parseFloat(document.getElementById('mc-temperature').value) || 0.7;
  const top_p = parseFloat(document.getElementById('mc-top-p').value);
  const frequency_penalty = parseFloat(document.getElementById('mc-freq-penalty').value) || 0;
  const presence_penalty = parseFloat(document.getElementById('mc-pres-penalty').value) || 0;
  const is_default = document.getElementById('mc-is-default').checked;

  if (!name || !provider || !base_url || !model) {
    showToast('请填写名称、供应商、API地址和模型');
    return;
  }

  const params_json = JSON.stringify({ context_length, max_tokens, temperature, top_p, frequency_penalty, presence_penalty });

  if (editingModelConfigId) {
    // Update
    const body = { name, provider, base_url, model, params_json, is_default };
    if (api_key) body.api_key = api_key;
    await api('PUT', '/admin/models/' + editingModelConfigId, body);
    showToast('已更新');
  } else {
    // Create
    if (!api_key) { showToast('新配置需要填写 API Key'); return; }
    await api('POST', '/admin/models', { name, provider, base_url, api_key, model, params_json, is_default });
    showToast('已添加');
  }
  closeModelEdit();
  await loadModelConfigs();
  renderModelConfigsList();
}

async function deleteModelConfig(id) {
  if (!confirm('确定删除该模型配置？关联的智能体将使用默认配置。')) return;
  await api('DELETE', '/admin/models/' + id);
  showToast('已删除');
  await loadModelConfigs();
  renderModelConfigsList();
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
async function showRoomSettings() {
  if (!currentRoomId) return;
  const roomData = await api('GET', '/admin/rooms');
  rooms = (roomData.result || []).filter(r => r.type !== 'dm');
  const room = rooms.find(r => r.id === currentRoomId);
  if (!room) return;
  document.getElementById('room-settings-title').textContent = room.name + ' - 设置';
  const members = room.members || [];
  document.getElementById('room-members-list').innerHTML =
    '<div class="hint">成员 (' + members.length + ')</div>' +
    members.map((m, i) => {
      const isSystem = m.id === 'user' || m.id === 'system';
      const idx = agents.findIndex(a => a.id === m.id);
      const color = idx >= 0 ? getAgentColor(idx) : 'var(--text-dim)';
      return '<div style="padding:10px 0;font-size:14px;border-bottom:0.5px solid var(--border);display:flex;align-items:center;gap:10px">' +
        '<div style="width:28px;height:28px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" style="width:14px;height:14px"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>' +
        '</div>' +
        '<span style="flex:1">' + escapeHtml(m.name) + '</span>' +
        '<span style="font-size:12px;color:var(--text-dim)">' + (m.role || 'member') + '</span>' +
        (isSystem ? '' : '<button onclick="removeMember(\'' + m.id + '\')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:12px;padding:4px 8px">移除</button>') +
      '</div>';
    }).join('');
  // Show/hide add button based on available agents
  const available = agents.filter(a => !members.find(m => m.id === a.id));
  const addBtn = document.getElementById('btn-show-add-members');
  if (addBtn) addBtn.style.display = available.length ? '' : 'none';
  document.getElementById('modal-room-settings').classList.add('active');
}

// Show multi-select add members modal
function showAddMembers() {
  if (!currentRoomId) return;
  const room = rooms.find(r => r.id === currentRoomId);
  const members = room ? (room.members || []) : [];
  const available = agents.filter(a => !members.find(m => m.id === a.id));
  const list = document.getElementById('add-members-list');
  if (!available.length) { showToast('所有智能体已在群中'); return; }
  list.innerHTML = available.map((a, i) => {
    const idx = agents.indexOf(a);
    const color = getAgentColor(idx);
    const icon = getAgentIcon(idx);
    return '<div class="checkbox-item" data-id="' + a.id + '" onclick="this.classList.toggle(\'checked\')">' +
      '<div class="cb"></div>' +
      '<div class="cb-avatar" style="background:' + color + '">' + icon + '</div>' +
      '<div class="cb-info"><div class="cb-name">' + escapeHtml(a.name) + '</div>' +
      '<div class="cb-desc">' + escapeHtml(a.description || '通用智能体') + '</div></div></div>';
  }).join('');
  document.getElementById('modal-add-members').classList.add('active');
}

// Confirm batch add members
async function confirmAddMembers() {
  const checked = document.querySelectorAll('#add-members-list .checkbox-item.checked');
  const ids = Array.from(checked).map(el => el.dataset.id);
  if (!ids.length) { showToast('请至少选择一个智能体'); return; }
  await api('POST', '/admin/rooms/' + currentRoomId + '/members', { agent_ids: ids });
  showToast('已添加 ' + ids.length + ' 个智能体');
  closeModals();
  loadConversations();
}

async function removeMember(agentId) {
  if (!currentRoomId) return;
  await api('DELETE', '/admin/rooms/' + currentRoomId + '/members/' + agentId);
  showToast('已移除');
  showRoomSettings();
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
loadModelConfigs();
connectWebSocket();

// ===== AGENT VIEW & SORT =====
let agentView = localStorage.getItem('hub-agent-view') || 'grid';
let agentSort = localStorage.getItem('hub-agent-sort') || 'default';
let agentFilter = '';

function setAgentView(view) {
  agentView = view;
  localStorage.setItem('hub-agent-view', view);
  const grid = document.getElementById('agent-grid');
  if (view === 'list') { grid.classList.add('list-view'); } else { grid.classList.remove('list-view'); }
  const gridBtn = document.getElementById('view-grid-btn');
  const listBtn = document.getElementById('view-list-btn');
  if (gridBtn) gridBtn.classList.toggle('active', view === 'grid');
  if (listBtn) listBtn.classList.toggle('active', view === 'list');
}

function sortAgents(sort) {
  agentSort = sort;
  localStorage.setItem('hub-agent-sort', sort);
  renderAgents();
}

function filterAgents(query) {
  agentFilter = (query || '').toLowerCase().trim();
  renderAgents();
}

function getSortedAgents() {
  let sorted = [...agents];
  // Apply filter
  if (agentFilter) {
    sorted = sorted.filter(a =>
      (a.name || '').toLowerCase().includes(agentFilter) ||
      (a.description || '').toLowerCase().includes(agentFilter)
    );
  }
  // Apply sort
  if (agentSort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
  else if (agentSort === 'status') sorted.sort((a, b) => (a.status === 'online' ? -1 : 1) - (b.status === 'online' ? -1 : 1));
  else if (agentSort === 'newest') sorted.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return sorted;
}

// ===== AGENT STATUS TOGGLE =====
let editAgentStatus = 'online';

function toggleAgentStatus() {
  const toggle = document.getElementById('agent-status-toggle');
  const label = document.getElementById('agent-status-label');
  if (!toggle || !label) return;
  editAgentStatus = editAgentStatus === 'online' ? 'offline' : 'online';
  toggle.classList.toggle('on', editAgentStatus === 'online');
  label.textContent = editAgentStatus === 'online' ? '在线' : '离线';
}

// ===== KEYBOARD DETECTION =====
if (window.visualViewport) {
  let lastHeight = window.visualViewport.height;
  window.visualViewport.addEventListener('resize', () => {
    const diff = lastHeight - window.visualViewport.height;
    if (diff > 100) {
      document.body.classList.add('keyboard-open');
    } else {
      document.body.classList.remove('keyboard-open');
    }
  });
}

// Apply saved view on load
setTimeout(() => {
  setAgentView(agentView);
}, 100);

// ===== WEBSOCKET STREAMING =====
function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws?ui=1`;
  ws = new WebSocket(url);

  ws.onopen = () => console.log('[WS] Connected');
  ws.onclose = () => {
    console.log('[WS] Disconnected, reconnecting in 3s...');
    setTimeout(connectWebSocket, 3000);
  };
  ws.onerror = () => {};

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWSMessage(msg);
    } catch {}
  };
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case 'stream_start': {
      const { stream_id, room_id, agent_id, agent_name } = msg;
      activeStreams[stream_id] = { roomId: room_id, agentId: agent_id, agentName: agent_name, text: '' };
      
      // Update message list to show typing indicator for this room
      updateRoomTypingState(room_id, true, agent_name);
      // Update conversation list to show active badge (debounced to prevent flicker)
      renderConversationListDebounced();

      // If we're viewing this room, create a streaming bubble
      if (room_id === currentRoomId) {
        isWaitingReply = false;
        const indicator = document.getElementById('typing-indicator');
        indicator.classList.remove('active');
        
        const area = document.getElementById('messages-area');
        // Create a group for the streaming agent
        const group = document.createElement('div');
        group.className = 'msg-group';
        group.id = `stream-group-${stream_id}`;
        const bubble = document.createElement('div');
        bubble.className = 'msg other streaming';
        bubble.id = `stream-${stream_id}`;
        const showName = currentRoomType === 'group';
        bubble.innerHTML = 
          (showName ? `<div class="sender-name">${escapeHtml(agent_name)}</div>` : '') +
          '<div class="msg-text"><span class="stream-cursor">▊</span></div>' +
          '<div class="msg-time">生成中...</div>';
        group.appendChild(bubble);
        area.insertBefore(group, indicator);
        area.scrollTop = area.scrollHeight;
      }
      break;
    }

    case 'stream_token': {
      const { stream_id, chunk } = msg;
      const stream = activeStreams[stream_id];
      if (!stream) return;
      stream.text += chunk;

      // Update the streaming bubble if visible
      if (stream.roomId === currentRoomId) {
        const bubble = document.getElementById(`stream-${stream_id}`);
        if (bubble) {
          const textEl = bubble.querySelector('.msg-text');
          textEl.innerHTML = renderMarkdown(stream.text) + '<span class="stream-cursor">▊</span>';
          const area = document.getElementById('messages-area');
          const atBottom = area.scrollHeight - area.scrollTop <= area.clientHeight + 120;
          if (atBottom) area.scrollTop = area.scrollHeight;
        }
      }
      break;
    }

    case 'stream_end': {
      const { stream_id } = msg;
      const stream = activeStreams[stream_id];
      if (!stream) return;

      // Finalize the streaming bubble
      if (stream.roomId === currentRoomId) {
        const bubble = document.getElementById(`stream-${stream_id}`);
        if (bubble) {
          bubble.classList.remove('streaming');
          const textEl = bubble.querySelector('.msg-text');
          textEl.innerHTML = renderMarkdown(stream.text);
          const timeEl = bubble.querySelector('.msg-time');
          timeEl.textContent = new Date().toTimeString().slice(0, 5);
        }
        // Remove group wrapper ID to avoid conflicts
        const group = document.getElementById(`stream-group-${stream_id}`);
        if (group) group.removeAttribute('id');
      }
      // Reset counters so next refreshMessages() can detect changes
      lastRenderedMsgCount = 0;
      lastRenderedMsgId = 0;
      delete activeStreams[stream_id];
      // Update message list — remove typing, show latest text
      updateRoomTypingState(stream.roomId, false, null, stream.text);
      // Refresh conversation list to remove active badge (debounced)
      renderConversationListDebounced();
      break;
    }

    case 'new_message': {
      // A final saved message arrived — refresh if we're in that room
      // (streaming already showed it, so just refresh to get the DB version)
      if (msg.room_id === currentRoomId) {
        // Small delay to avoid flicker with stream_end
        setTimeout(() => refreshMessages(), 500);
      }
      break;
    }
  }
}

