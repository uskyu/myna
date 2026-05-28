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
      <!-- Thread drawer toggle -->
      <button class="thread-toggle-btn" :class="{ active: threadDrawerOpen }" @click="threadDrawerOpen = !threadDrawerOpen" title="对话列表">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span class="thread-toggle-count" v-if="threads.length > 0">{{ threads.length + 1 }}</span>
      </button>
      <button v-if="type === 'group'" class="more-btn" :class="{ active: showSettings }" @click="showSettings = !showSettings" :title="showSettings ? '返回聊天' : '群聊信息'">
        <svg v-if="!showSettings" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <!-- Group info panel (replaces messages area when active) -->
    <div v-if="type === 'group' && showSettings" class="group-info-panel">
      <RoomInfoPanel :room="room" @changed="onMembersChanged" @close="showSettings = false" @deleted="$emit('close')" />
    </div>

    <!-- Chat body with optional thread panel -->
    <div v-if="!(type === 'group' && showSettings)" class="chat-body-wrapper">
      <!-- Messages area -->
      <div class="messages-area" ref="messagesArea" @scroll="onScroll">
      <template v-for="(group, gi) in messageGroups" :key="gi">
        <div v-if="group.separator" class="time-separator"><span>{{ group.separator }}</span></div>
        <div class="msg-group" :class="{ self: group.self }">
          <div v-for="(msg, mi) in group.messages" :key="msg.id || mi" class="msg" :class="{ self: group.self, streaming: msg.streaming }" @click="!group.self && onBubbleClick(msg)">
            <div v-if="msg.showName" class="sender-name">{{ msg.sender_name }}</div>
            <!-- Working bubble (tool calls - streaming or saved) -->
            <div v-if="msg.toolCalls && msg.toolCalls.length" class="working-bubble" :class="{ collapsed: !msg.toolsExpanded, done: !msg.streaming }">
              <div class="working-header" @click.stop="toggleToolsExpand(msg)">
                <div v-if="msg.streaming" class="working-spinner"></div>
                <svg v-else class="working-done-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                <span class="working-label">{{ msg.streaming ? '工作中' : '工具调用' }}</span>
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
            <!-- Stop button for streaming messages -->
            <button v-if="msg.streaming" class="stop-stream-btn" @click.stop="cancelStream(msg)">⏹ 停止</button>
          </div>
        </div>
      </template>
      <div v-if="typingAgent" class="typing-indicator active">
        <span style="font-size:12px;color:var(--text-dim);margin-right:4px">{{ typingAgent }}</span>
        <div class="dots"><span></span><span></span><span></span></div>
      </div>
      </div>

      <!-- Thread drawer (overlay, does NOT affect main chat layout) -->
      <div v-if="threadDrawerOpen" class="thread-drawer-overlay" @click.self="threadDrawerOpen = false">
        <div class="thread-drawer">
          <div class="thread-drawer-header">
            <span class="thread-drawer-title">对话列表</span>
            <span class="thread-drawer-count">{{ threads.length + 1 }}</span>
            <button class="thread-drawer-close" @click="threadDrawerOpen = false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="thread-drawer-body">
            <button class="thread-new-btn" @click="createThread">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
              + 新建对话
            </button>
            <div class="thread-list">
              <div
                class="thread-item"
                :class="{ active: !activeThreadId }"
                @click="selectThread(null); threadDrawerOpen = false"
              >
                <div class="thread-item-title">主线</div>
                <div class="thread-item-preview">默认对话</div>
              </div>
              <div
                v-for="t in threads"
                :key="t.id"
                class="thread-item"
                :class="{ active: activeThreadId === t.id }"
                @click="selectThread(t.id); threadDrawerOpen = false"
              >
                <div class="thread-item-header">
                  <div class="thread-item-title" @dblclick.stop="startRenameThread(t)">
                    <span v-if="t.status === 'workflow_running'" class="thread-status-icon">🔄</span>
                    <template v-if="renamingThreadId === t.id">
                      <input
                        class="thread-rename-input"
                        v-model="renameThreadTitle"
                        @click.stop
                        @keydown.enter.stop="finishRenameThread(t)"
                        @keydown.escape.stop="cancelRenameThread"
                        @blur="finishRenameThread(t)"
                        ref="renameInput"
                      >
                    </template>
                    <template v-else>{{ t.title }}</template>
                  </div>
                  <button class="thread-item-edit" @click.stop="startRenameThread(t)" title="重命名">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="thread-item-delete" @click.stop="deleteThread(t.id)" title="删除对话">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
                <div class="thread-item-preview">{{ t.last_message || '暂无消息' }}</div>
                <div v-if="t.updated_at" class="thread-item-time">{{ formatThreadTime(t.updated_at) }}</div>
              </div>
            </div>
          </div>
        </div>
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

      <!-- Plus menu popup -->
      <div v-if="showPlusMenu" class="plus-menu-popup">
        <div class="plus-menu-item" @mousedown.prevent="onPlusUploadFile">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
          <span>上传文件</span>
        </div>
        <div class="plus-menu-item" @mousedown.prevent="onPlusUploadImage">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span>添加图片</span>
        </div>
        <div class="plus-menu-item" @mousedown.prevent="showShortcutMenu = true; showPlusMenu = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          <span>快捷指令</span>
        </div>
      </div>

      <!-- Shortcut commands popup -->
      <div v-if="showShortcutMenu" class="plus-menu-popup shortcut-menu">
        <div class="shortcut-header">快捷指令</div>
        <div class="plus-menu-item" v-for="cmd in shortcutCommands" :key="cmd.id" @mousedown.prevent="applyShortcut(cmd)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path :d="cmd.icon"/></svg>
          <span>{{ cmd.label }}</span>
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

      <button class="file-btn plus-btn" @click="togglePlusMenu" title="更多">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <input ref="fileInput" type="file" multiple style="display:none" @change="onFiles">
      <input ref="imageInput" type="file" multiple accept="image/*" style="display:none" @change="onFiles">

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
import { store, api, ws, escapeHtml, getAgentColor, getAgentIcon, loadConversations, clearUnread, currentRoomId, chatSettings, saveChatSettings } from '../store.js'
import RoomInfoPanel from './RoomInfoPanel.vue'

const props = defineProps({ room: Object, type: String })
const emit = defineEmits(['close'])

const messagesArea = ref(null)
const inputEl = ref(null)
const fileInput = ref(null)
const imageInput = ref(null)
const renameInput = ref(null)
const inputText = ref('')
const messages = ref([])
const typingAgent = ref(null)
const showSettings = ref(false)
const attachments = ref([])
const threads = ref([])
const activeThreadId = ref(null)
const threadDrawerOpen = ref(false)
const showPlusMenu = ref(false)
const showShortcutMenu = ref(false)

// Shortcut commands (like TG Hermes slash commands)
const shortcutCommands = [
  { id: 'compress', label: '压缩上下文', icon: 'M4 14h4v4H4zM14 10h4v4h-4zM1 10h4v4H1zM8 6h4v4H8z', command: '/compact' },
  { id: 'stop', label: '立即停止', icon: 'M6 4h4v16H6zM14 4h4v16h-4z', command: '/stop', needsAgent: true },
  { id: 'clear', label: '清空对话', icon: 'M3 6h18M8 6V4h8v2M5 6v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6', command: '/clear' },
  { id: 'retry', label: '重新生成', icon: 'M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15', command: '/retry' },
  { id: 'summary', label: '总结对话', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8', command: '/summary' },
]

// Thread rename state
const renamingThreadId = ref(null)
const renameThreadTitle = ref('')

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
  const sid = String(msg.id).startsWith('stream-') ? msg.id.replace('stream-', '') : `saved-${msg.id}`
  toolsExpandedMap.value[sid] = !msg.toolsExpanded
}

function getToolsExpanded(sid, isStreaming) {
  // If user has manually toggled, respect that
  if (toolsExpandedMap.value[sid] !== undefined) return toolsExpandedMap.value[sid]
  // Otherwise use chatSettings
  const mode = chatSettings.toolCallDisplay
  if (mode === 'expanded') return true
  if (mode === 'collapsed') return false
  // 'collapsed-after-complete': expanded while streaming, collapsed after
  return isStreaming
}

function onSettingsChange(val) {
  chatSettings.toolCallDisplay = val
  saveChatSettings()
}

// === Task 1: Click AI bubble to @mention ===
function onBubbleClick(msg) {
  if (!msg.sender_name) return
  const mention = '@' + msg.sender_name + ' '
  inputText.value = mention + inputText.value
  nextTick(() => {
    const el = inputEl.value
    if (el) {
      el.focus()
      el.selectionStart = el.selectionEnd = mention.length + inputText.value.length - mention.length
    }
  })
}

// === Task 2: Plus menu ===
function togglePlusMenu() {
  showPlusMenu.value = !showPlusMenu.value
  if (showPlusMenu.value) {
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', closePlusMenu, { once: true })
    }, 0)
  }
}
function closePlusMenu() {
  showPlusMenu.value = false
  showShortcutMenu.value = false
}
function onPlusUploadFile() {
  showPlusMenu.value = false
  fileInput.value?.click()
}
function onPlusUploadImage() {
  showPlusMenu.value = false
  imageInput.value?.click()
}
function applyShortcut(cmd) {
  showShortcutMenu.value = false
  // Always insert command and trigger @ mention picker
  inputText.value = cmd.command + ' @'
  nextTick(() => {
    inputEl.value?.focus()
    triggerAt()
  })
}

// === Task 4: Cancel stream ===
function cancelStream(msg) {
  const streamId = String(msg.id).replace('stream-', '')
  // Emit WS event
  if (ws._ws && ws._ws.readyState === WebSocket.OPEN) {
    ws._ws.send(JSON.stringify({ type: 'cancel_stream', stream_id: streamId }))
  }
  // Remove from activeStreams
  delete store.activeStreams[streamId]
  store.activeStreams = { ...store.activeStreams }
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
  // Add @全部 option at the top
  const allOption = { id: '__all__', name: '全部', description: '通知所有智能体' }
  const q = mentionQuery.value.toLowerCase()
  if (!q) return [allOption, ...pool.slice(0, 8)]
  if ('全部'.includes(q) || 'all'.includes(q)) {
    return [allOption, ...pool.filter(m => (m.name || '').toLowerCase().includes(q)).slice(0, 7)]
  }
  return pool.filter(m => (m.name || '').toLowerCase().includes(q)).slice(0, 8)
})

watch(mentionCandidates, (list) => {
  if (mentionIndex.value >= list.length) mentionIndex.value = Math.max(0, list.length - 1)
})

function renderMd(text) {
  if (!text) return ''
  try {
    marked.setOptions({ breaks: true, gfm: true })
    // Escape raw HTML tags in the source to prevent DOM injection
    // But preserve code blocks (``` ... ```) which should show HTML as-is
    let processed = text
    // Temporarily protect code blocks
    const codeBlocks = []
    processed = processed.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match)
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`
    })
    // Escape HTML tags outside code blocks (prevent layout breakage)
    processed = processed.replace(/<(script|style|link|meta|iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, (match) => {
      return '```html\n' + match + '\n```'
    })
    processed = processed.replace(/<(script|style|link|meta|iframe|object|embed|form)[^>]*\/?>/gi, (match) => {
      return '`' + match + '`'
    })
    // Restore code blocks
    processed = processed.replace(/__CODE_BLOCK_(\d+)__/g, (_, i) => codeBlocks[i])
    let html = marked.parse(processed)
    html = html.replace(/<table>/g, '<div class="table-wrapper"><table>').replace(/<\/table>/g, '</table></div>')
    html = html.replace(/<img /g, '<img style="max-width:100%;max-height:300px;border-radius:8px;cursor:pointer;display:block;margin:4px 0" onclick="window.open(this.src)" ')
    return html
  } catch { return escapeHtml(text) }
}

const messageGroups = computed(() => {
  const allMsgs = []
  messages.value.forEach(m => {
    const self = m.sender_id === 'user' || m.sender_id === 'system'
    // Parse metadata for tool_calls
    let toolCalls = null
    if (m.metadata) {
      try {
        const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata
        if (meta.tool_calls && meta.tool_calls.length > 0) {
          toolCalls = meta.tool_calls
        }
      } catch {}
    }
    allMsgs.push({
      id: m.id,
      sender_id: m.sender_id,
      sender_name: m.sender_name,
      text: m.text,
      rendered: renderMd(m.text),
      time: (m.created_at || '').slice(11, 16),
      date: (m.created_at || '').slice(0, 10),
      self,
      showName: !self && (props.type === 'group' || !self),
      toolCalls,
      toolsExpanded: toolCalls ? getToolsExpanded(`saved-${m.id}`, false) : false,
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
      toolsExpanded: getToolsExpanded(sid, true), // streaming = true
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
  const data = await api('GET', `/admin/rooms/${props.room.id}/threads`)
  threads.value = data.result || []
}

function selectThread(threadId) {
  activeThreadId.value = threadId
  messages.value = []
  fetchMessages()
}

async function createThread() {
  const data = await api('POST', `/admin/rooms/${props.room.id}/threads`, { title: '新对话' })
  if (data.ok) {
    await fetchThreads()
    selectThread(data.result.id)
    threadDrawerOpen.value = false
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

// === Task 3: Thread rename ===
function startRenameThread(t) {
  renamingThreadId.value = t.id
  renameThreadTitle.value = t.title
  nextTick(() => {
    const el = renameInput.value
    if (el) {
      // renameInput may be an array due to v-for
      const input = Array.isArray(el) ? el[0] : el
      if (input) input.focus()
    }
  })
}
async function finishRenameThread(t) {
  const newTitle = renameThreadTitle.value.trim()
  if (newTitle && newTitle !== t.title) {
    await api('PATCH', `/admin/threads/${t.id}`, { title: newTitle })
    t.title = newTitle
    await fetchThreads()
  }
  renamingThreadId.value = null
}
function cancelRenameThread() {
  renamingThreadId.value = null
}

// Auto-update thread title on first message
async function autoUpdateThreadTitle(text) {
  if (!activeThreadId.value) return
  const thread = threads.value.find(t => t.id === activeThreadId.value)
  if (!thread || thread.title !== '新对话') return
  // Only update if this is the first message (thread has no prior messages)
  const truncated = text.slice(0, 20)
  await api('PATCH', `/admin/threads/${activeThreadId.value}`, { title: truncated })
  thread.title = truncated
}

function formatThreadTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  if (diff < 604800000) return Math.floor(diff / 86400000) + '天前'
  return ts.slice(0, 10)
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
    const name = match[1]
    // Handle @全部 — add all members
    if (name === '全部' || name === 'all') {
      if (props.room.members) {
        props.room.members.forEach(m => {
          if (m.id !== 'user' && m.id !== 'system' && !mentions.includes(m.id)) mentions.push(m.id)
        })
      }
    } else {
      const id = memberMap[name]
      if (id && !mentions.includes(id)) mentions.push(id)
    }
  }

  // Default mention: if no explicit @, send to last agent that replied
  if (mentions.length === 0 && props.type !== 'dm') {
    const lastAgentMsg = [...messages.value].reverse().find(m => m.sender_id && m.sender_id !== 'user' && m.sender_id !== 'system')
    if (lastAgentMsg) {
      mentions.push(lastAgentMsg.sender_id)
    } else if (props.room.members?.length) {
      // Fallback: first non-user member
      const first = props.room.members.find(m => m.id !== 'user' && m.id !== 'system')
      if (first) mentions.push(first.id)
    }
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
  // Auto-update thread title if this is the first message in a '新对话' thread
  autoUpdateThreadTitle(text)
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
  // If there are already active streams for this room (e.g. from WS reconnect before mount),
  // scroll to bottom to show the generating bubble
  nextTick(() => {
    const hasActiveStream = Object.values(store.activeStreams).some(s => s.roomId === props.room.id)
    if (hasActiveStream) scrollToBottom()
  })
})

onUnmounted(() => {
  clearInterval(pollTimer)
  currentRoomId.value = null
  ws.offMessage(handleWS)
})

// When room prop changes, update currentRoomId and clear unread
watch(() => props.room.id, (newId) => {
  clearUnread(newId)
  currentRoomId.value = newId
})
</script>
