<template>
  <div class="chat-view active">
    <div class="chat-header">
      <button class="back-btn" @click="$emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <span class="title">
        {{ title }}
        <span v-if="subtitle" style="font-size:12px;color:var(--text-dim);font-weight:400;margin-left:8px">{{ subtitle }}</span>
      </span>
      <button v-if="type === 'group'" class="more-btn" :class="{ active: showSettings }" @click="showSettings = !showSettings" :title="showSettings ? '返回聊天' : '群聊信息'">
        <svg v-if="!showSettings" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <!-- Group info panel (replaces messages area when active) -->
    <div v-if="type === 'group' && showSettings" class="group-info-panel">
      <RoomInfoPanel :room="room" @changed="onMembersChanged" @close="showSettings = false" @deleted="$emit('close')" />
    </div>

    <!-- Thread bar (group chats only) -->
    <div v-else-if="type === 'group'" class="thread-bar-wrapper">
      <div class="thread-bar">
        <div class="thread-tab" :class="{ active: !activeThreadId }" @click="selectThread(null)">主线</div>
        <div
          v-for="t in threads"
          :key="t.id"
          class="thread-tab"
          :class="{ active: activeThreadId === t.id }"
          @click="selectThread(t.id)"
        >
          <span v-if="t.status === 'workflow_running'" class="thread-status">🔄</span>
          {{ t.title }}
          <button class="thread-close" @click.stop="deleteThread(t.id)" title="删除话题">×</button>
        </div>
        <button class="thread-add" @click="createThread" title="新建话题">+</button>
      </div>
    </div>

    <div v-if="!(type === 'group' && showSettings)" class="messages-area" ref="messagesArea" @scroll="onScroll">
      <template v-for="(group, gi) in messageGroups" :key="gi">
        <div v-if="group.separator" class="time-separator"><span>{{ group.separator }}</span></div>
        <div class="msg-group" :class="{ self: group.self }">
          <div v-for="(msg, mi) in group.messages" :key="msg.id || mi" class="msg" :class="{ self: group.self, streaming: msg.streaming }">
            <div v-if="msg.showName" class="sender-name">{{ msg.sender_name }}</div>
            <!-- Working bubble (tool calls in progress) -->
            <div v-if="msg.streaming && msg.toolCalls && msg.toolCalls.length" class="working-bubble" :class="{ collapsed: !msg.toolsExpanded }">
              <div class="working-header" @click="toggleToolsExpand(msg)">
                <div class="working-spinner"></div>
                <span class="working-label">工作中</span>
                <span class="working-count">{{ msg.toolCalls.length }} 步</span>
                <svg class="working-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </div>
              <div v-if="msg.toolsExpanded" class="working-steps">
                <div v-for="(tc, ti) in msg.toolCalls" :key="ti" class="tool-step" :class="{ running: tc.status === 'running', done: tc.status === 'done', error: tc.status === 'error', flash: tc.flash }">
                  <div class="step-icon">
                    <svg v-if="tc.status === 'running'" class="spin-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    <svg v-else-if="tc.status === 'done'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </div>
                  <div class="step-body">
                    <div class="step-name">{{ toolLabel(tc.name) }}</div>
                    <div class="step-summary">{{ tc.summary }}</div>
                    <div v-if="tc.result" class="step-result" :class="{ error: tc.status === 'error' }">{{ tc.result }}</div>
                  </div>
                </div>
              </div>
            </div>
            <!-- Text content (shown after tools or for non-tool messages) -->
            <div v-if="msg.streaming && !msg.text && msg.toolCalls && msg.toolCalls.length" class="msg-text working-placeholder"></div>
            <div v-else class="msg-text" v-html="msg.streaming ? (msg.rendered + '<span class=stream-cursor>▊</span>') : msg.rendered"></div>
            <div class="msg-time">{{ msg.streaming ? (msg.working ? '思考中...' : '生成中...') : msg.time }}</div>
          </div>
        </div>
      </template>
      <div v-if="typingAgent" class="typing-indicator active">
        <span style="font-size:12px;color:var(--text-dim);margin-right:4px">{{ typingAgent }}</span>
        <div class="dots"><span></span><span></span><span></span></div>
      </div>
    </div>
    <!-- Input bar (hidden when info panel showing) -->
    <div v-if="!(type === 'group' && showSettings)" class="input-bar">
      <!-- Mention popup -->
      <div v-if="showMentions && mentionCandidates.length" class="mention-popup">
        <div
          v-for="(c, idx) in mentionCandidates"
          :key="c.id"
          class="mention-item"
          :class="{ active: idx === mentionIndex }"
          @mousedown.prevent="selectMention(c)"
        >
          <div class="avatar" :style="{ background: getAgentColor(agentColorIdx(c.id)) }">
            <span v-html="getAgentIcon(agentColorIdx(c.id))"></span>
          </div>
          <span class="name">{{ c.name }}</span>
          <span class="status-dot" :class="c.status === 'online' ? 'online' : 'offline'"></span>
        </div>
      </div>

      <!-- Attachment preview -->
      <div v-if="attachments.length" class="attach-preview">
        <div v-for="(a, idx) in attachments" :key="idx" class="attach-chip">
          <img v-if="a.type === 'image'" :src="a.url">
          <span v-else class="file-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </span>
          <span class="name">{{ a.name }}</span>
          <button class="remove" @click="attachments.splice(idx, 1)">×</button>
        </div>
      </div>

      <button class="file-btn" @click="$refs.fileInput.click()" title="上传文件">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
      </button>
      <input ref="fileInput" type="file" multiple style="display:none" @change="onFiles">

      <button class="at-btn" @click="triggerAt" title="@提及">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0V12a10 10 0 1 0-3.92 7.94"/></svg>
      </button>

      <textarea
        ref="inputEl"
        rows="1"
        placeholder="输入消息..."
        v-model="inputText"
        @keydown.enter.exact.prevent="onEnter"
        @keydown.down.prevent="moveMention(1)"
        @keydown.up.prevent="moveMention(-1)"
        @keydown.tab.prevent="onTab"
        @keydown.escape="closeMentions"
        @input="onInput"
      ></textarea>

      <button class="send-btn" :disabled="!canSend" @click="send">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
      </button>
    </div>

    <!-- (Modal-mode RoomMembersModal removed — replaced by RoomInfoPanel inline) -->
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { marked } from 'marked'
import { store, api, ws, escapeHtml, getAgentColor, getAgentIcon, loadConversations, clearUnread, currentRoomId } from '../store.js'
import RoomInfoPanel from './RoomInfoPanel.vue'

const props = defineProps({ room: Object, type: String })
const emit = defineEmits(['close'])

const messagesArea = ref(null)
const inputEl = ref(null)
const fileInput = ref(null)
const inputText = ref('')
const messages = ref([])
const typingAgent = ref(null)
const showSettings = ref(false)
const attachments = ref([])
const threads = ref([])
const activeThreadId = ref(null)

// Mention autocomplete
const showMentions = ref(false)
const mentionQuery = ref('')
const mentionIndex = ref(0)
const mentionStartPos = ref(-1)

let pollTimer = null

// Tool expand state per stream
const toolsExpandedMap = ref({})

const TOOL_LABELS = {
  run_command: '执行命令',
  read_file: '读取文件',
  write_file: '写入文件',
  http_request: 'HTTP 请求',
  search_files: '搜索文件',
}
function toolLabel(name) { return TOOL_LABELS[name] || name }
function toggleToolsExpand(msg) {
  const sid = msg.id.replace('stream-', '')
  toolsExpandedMap.value[sid] = !msg.toolsExpanded
}

const title = computed(() => {
  if (props.type === 'dm') return props.room.agent?.name || '私聊'
  return props.room.name || '群聊'
})
const subtitle = computed(() => {
  if (props.type === 'group') return (props.room.members?.length || 0) + ' 个成员'
  return ''
})

const canSend = computed(() => inputText.value.trim().length > 0 || attachments.value.length > 0)

const agentColorIdx = (id) => store.agents.findIndex(a => a.id === id)

// Mention candidates: room members (group) or all agents (dm)
const mentionCandidates = computed(() => {
  let pool = []
  if (props.type === 'group' && props.room.members) {
    pool = props.room.members.filter(m => m.id !== 'user')
  } else {
    pool = store.agents
  }
  const q = mentionQuery.value.toLowerCase()
  if (!q) return pool.slice(0, 8)
  return pool.filter(m => (m.name || '').toLowerCase().includes(q)).slice(0, 8)
})

watch(mentionCandidates, (list) => {
  if (mentionIndex.value >= list.length) mentionIndex.value = Math.max(0, list.length - 1)
})

function renderMd(text) {
  if (!text) return ''
  try {
    marked.setOptions({ breaks: true, gfm: true })
    let html = marked.parse(text)
    html = html.replace(/<table>/g, '<div class="table-wrapper"><table>').replace(/<\/table>/g, '</table></div>')
    html = html.replace(/<img /g, '<img style="max-width:100%;max-height:300px;border-radius:8px;cursor:pointer;display:block;margin:4px 0" onclick="window.open(this.src)" ')
    return html
  } catch { return escapeHtml(text) }
}

const messageGroups = computed(() => {
  const allMsgs = []
  messages.value.forEach(m => {
    const self = m.sender_id === 'user' || m.sender_id === 'system'
    allMsgs.push({
      id: m.id,
      sender_id: m.sender_id,
      sender_name: m.sender_name,
      text: m.text,
      rendered: renderMd(m.text),
      time: (m.created_at || '').slice(11, 16),
      date: (m.created_at || '').slice(0, 10),
      self,
      showName: !self && props.type === 'group',
    })
  })
  for (const sid in store.activeStreams) {
    const s = store.activeStreams[sid]
    if (s.roomId !== props.room.id) continue
    allMsgs.push({
      id: `stream-${sid}`,
      sender_id: s.agentId,
      sender_name: s.agentName,
      text: s.text,
      rendered: renderMd(s.text),
      time: '',
      date: '',
      self: false,
      showName: props.type === 'group',
      streaming: true,
      working: s.working,
      toolCalls: s.toolCalls || [],
      toolsExpanded: toolsExpandedMap.value[sid] !== false, // default expanded
    })
  }
  const groups = []
  let prevSender = null
  let prevDate = null
  for (const m of allMsgs) {
    if (m.date && prevDate && m.date !== prevDate) {
      groups.push({ separator: m.date, self: false, messages: [] })
    }
    if (m.sender_id !== prevSender) {
      groups.push({ self: m.self, messages: [m] })
    } else {
      groups[groups.length - 1].messages.push(m)
    }
    prevSender = m.sender_id
    prevDate = m.date
  }
  return groups
})

async function fetchMessages() {
  let data
  if (activeThreadId.value) {
    data = await api('GET', `/admin/threads/${activeThreadId.value}/messages?limit=100`)
  } else {
    data = await api('GET', `/admin/rooms/${props.room.id}/messages?limit=100`)
  }
  const newMsgs = data.result || []
  // Preserve optimistic messages that haven't appeared in server response yet
  const serverIds = new Set(newMsgs.map(m => m.id))
  const optimistic = messages.value.filter(m => String(m.id).startsWith('tmp-'))
  // Check if optimistic msg text exists in server response (means it was saved)
  const unsaved = optimistic.filter(om => !newMsgs.some(sm => sm.sender_id === 'user' && sm.text === om.text))
  messages.value = [...newMsgs, ...unsaved]
  await nextTick()
  scrollToBottomIfNeeded()
}

async function fetchThreads() {
  if (props.type !== 'group') return
  const data = await api('GET', `/admin/rooms/${props.room.id}/threads`)
  threads.value = data.result || []
}

function selectThread(threadId) {
  activeThreadId.value = threadId
  messages.value = []
  fetchMessages()
}

async function createThread() {
  const title = prompt('话题名称：')
  if (!title || !title.trim()) return
  const data = await api('POST', `/admin/rooms/${props.room.id}/threads`, { title: title.trim() })
  if (data.ok) {
    await fetchThreads()
    selectThread(data.result.id)
  }
}

async function deleteThread(threadId) {
  if (!confirm('确定删除此话题及其所有消息？')) return
  await api('DELETE', `/admin/threads/${threadId}`)
  if (activeThreadId.value === threadId) {
    activeThreadId.value = null
  }
  await fetchThreads()
  fetchMessages()
}

// Smart scroll: only auto-scroll if user is near bottom
let userScrolledUp = false
function onScroll() {
  const el = messagesArea.value
  if (!el) return
  const threshold = 80
  userScrolledUp = (el.scrollHeight - el.scrollTop - el.clientHeight) > threshold
}
function scrollToBottom() {
  const el = messagesArea.value
  if (el) el.scrollTop = el.scrollHeight
  userScrolledUp = false
}
function scrollToBottomIfNeeded() {
  if (!userScrolledUp) scrollToBottom()
}

// === Mention logic ===
function onInput(e) {
  autoResize(e)
  const el = inputEl.value
  const pos = el.selectionStart
  const text = inputText.value
  // Find latest @ before cursor with no space between
  let i = pos - 1
  let atPos = -1
  while (i >= 0) {
    const ch = text[i]
    if (ch === '@') { atPos = i; break }
    if (ch === ' ' || ch === '\n') break
    i--
  }
  if (atPos === -1) {
    showMentions.value = false
    mentionStartPos.value = -1
    return
  }
  const query = text.slice(atPos + 1, pos)
  mentionStartPos.value = atPos
  mentionQuery.value = query
  showMentions.value = true
  mentionIndex.value = 0
}

function moveMention(delta) {
  if (!showMentions.value) return
  const len = mentionCandidates.value.length
  if (!len) return
  mentionIndex.value = (mentionIndex.value + delta + len) % len
}

function selectMention(candidate) {
  if (mentionStartPos.value < 0) return
  const before = inputText.value.slice(0, mentionStartPos.value)
  const after = inputText.value.slice(inputEl.value.selectionStart)
  const insert = '@' + candidate.name + ' '
  inputText.value = before + insert + after
  closeMentions()
  nextTick(() => {
    const newPos = before.length + insert.length
    inputEl.value.focus()
    inputEl.value.selectionStart = inputEl.value.selectionEnd = newPos
  })
}

function closeMentions() {
  showMentions.value = false
  mentionStartPos.value = -1
}

function onEnter() {
  if (showMentions.value && mentionCandidates.value[mentionIndex.value]) {
    selectMention(mentionCandidates.value[mentionIndex.value])
    return
  }
  send()
}

function onTab() {
  if (showMentions.value && mentionCandidates.value[mentionIndex.value]) {
    selectMention(mentionCandidates.value[mentionIndex.value])
  }
}

function triggerAt() {
  const el = inputEl.value
  if (!el) return
  el.focus()
  const pos = el.selectionStart || inputText.value.length
  inputText.value = inputText.value.slice(0, pos) + '@' + inputText.value.slice(pos)
  nextTick(() => {
    el.selectionStart = el.selectionEnd = pos + 1
    onInput({ target: el })
  })
}

// === File upload ===
async function onFiles(e) {
  const files = Array.from(e.target.files || [])
  for (const f of files) {
    const fd = new FormData()
    fd.append('file', f)
    try {
      const r = await fetch('/admin/upload', { method: 'POST', body: fd })
      const data = await r.json()
      if (data.ok) {
        attachments.value.push({ url: data.url, type: data.type, name: data.name, size: data.size })
      } else {
        showToast('上传失败: ' + (data.error || '未知错误'))
      }
    } catch (err) {
      showToast('上传失败: ' + err.message)
    }
  }
  e.target.value = ''
}

async function send() {
  const text = inputText.value.trim()
  const atts = attachments.value.slice()
  if (!text && !atts.length) return

  if (text.startsWith('/')) {
    handleCommand(text)
    inputText.value = ''
    return
  }

  // Build message body — append attachments as markdown
  let body = text
  for (const a of atts) {
    if (a.type === 'image') body += `\n![${a.name}](${a.url})`
    else body += `\n[${a.name}](${a.url})`
  }

  // Extract mentions
  const mentions = []
  const memberMap = {}
  if (props.room.members) {
    props.room.members.forEach(m => { memberMap[m.name] = m.id })
  }
  store.agents.forEach(a => { memberMap[a.name] = a.id })
  const mentionRegex = /@(\S+)/g
  let match
  while ((match = mentionRegex.exec(text)) !== null) {
    const id = memberMap[match[1]]
    if (id && !mentions.includes(id)) mentions.push(id)
  }

  inputText.value = ''
  attachments.value = []
  if (inputEl.value) inputEl.value.style.height = 'auto'

  // Optimistic add
  messages.value.push({
    id: 'tmp-' + Date.now(),
    sender_id: 'user',
    sender_name: '我',
    text: body,
    created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  })
  await nextTick()
  scrollToBottom()

  await api('POST', activeThreadId.value ? `/admin/threads/${activeThreadId.value}/send` : `/admin/rooms/${props.room.id}/send`, { text: body, mentions })
}

async function handleCommand(text) {
  const cmd = text.split(' ')[0]
  if (cmd === '/clear') {
    const data = await api('DELETE', `/admin/rooms/${props.room.id}/messages`)
    if (data.ok) { messages.value = []; showToast('对话已清空') }
  } else if (cmd === '/members') {
    showSettings.value = true
  }
}

function autoResize(e) {
  const el = e.target
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

function showToast(msg) {
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2000)
}

async function onMembersChanged() {
  // refresh conversation list so room.members reflects latest
  await loadConversations()
}

function handleWS(msg) {
  if (msg.type === 'stream_start' && msg.room_id === props.room.id) {
    // activeStreams is now managed globally in store.js
    typingAgent.value = null
    nextTick(scrollToBottomIfNeeded)
  } else if (msg.type === 'tool_call' && store.activeStreams[msg.stream_id]) {
    const stream = store.activeStreams[msg.stream_id]
    stream.toolCalls.push({ name: msg.tool, summary: msg.args_summary, status: 'running', result: null, ts: msg.timestamp })
    // Force reactivity
    store.activeStreams = { ...store.activeStreams }
    nextTick(scrollToBottomIfNeeded)
  } else if (msg.type === 'tool_result' && store.activeStreams[msg.stream_id]) {
    const stream = store.activeStreams[msg.stream_id]
    const last = stream.toolCalls.findLast(t => t.name === msg.tool && t.status === 'running')
    if (last) {
      last.status = msg.ok ? 'done' : 'error'
      last.result = msg.output_preview || ''
    }
    store.activeStreams = { ...store.activeStreams }
    nextTick(scrollToBottomIfNeeded)
  } else if (msg.type === 'stream_token' && store.activeStreams[msg.stream_id]) {
    const stream = store.activeStreams[msg.stream_id]
    stream.working = false
    stream.text += msg.chunk
    store.activeStreams = { ...store.activeStreams }
    nextTick(scrollToBottomIfNeeded)
  } else if (msg.type === 'stream_end' && msg.room_id === props.room.id) {
    // activeStreams cleanup is handled globally; just refresh messages
    setTimeout(fetchMessages, 300)
  } else if (msg.type === 'new_message' && msg.room_id === props.room.id) {
    // Only fetch if thread matches current view
    const msgThread = msg.thread_id || null
    if (msgThread === activeThreadId.value) {
      fetchMessages()
    }
    // Refresh threads list in case a workflow created a new thread
    fetchThreads()
  } else if (msg.type === 'typing' && msg.room_id === props.room.id) {
    typingAgent.value = msg.from?.name || null
    setTimeout(() => { typingAgent.value = null }, 3000)
  }
}

onMounted(() => {
  clearUnread(props.room.id)
  currentRoomId.value = props.room.id
  fetchMessages()
  fetchThreads()
  pollTimer = setInterval(fetchMessages, 3000)
  ws.onMessage(handleWS)
})

onUnmounted(() => {
  clearInterval(pollTimer)
  currentRoomId.value = null
})

// When room prop changes, update currentRoomId and clear unread
watch(() => props.room.id, (newId) => {
  clearUnread(newId)
  currentRoomId.value = newId
})
</script>
