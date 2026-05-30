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
          <div v-for="(msg, mi) in group.messages" :key="msg.id || mi" class="msg" :class="{ self: group.self, streaming: msg.streaming }">
            <div v-if="msg.showName" class="sender-name">{{ msg.sender_name }}</div>
            <!-- Text/tools content in chronological order -->
            <template v-if="msg.parts && msg.parts.length">
              <template v-for="(part, pi) in msg.parts" :key="pi">
                <div v-if="part.type === 'tool'" class="working-bubble inline-tool" :class="{ done: part.status !== 'running' }">
                  <div class="working-header static">
                    <div v-if="part.status === 'running'" class="working-spinner"></div>
                    <svg v-else-if="part.status === 'done'" class="working-done-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                    <svg v-else class="working-done-icon error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    <span class="working-label">{{ part.status === 'running' ? '调用工具' : '工具完成' }}</span>
                    <span class="working-count">{{ toolLabel(part.name) }}</span>
                  </div>
                  <div class="working-steps">
                    <div class="tool-step" :class="{ running: part.status === 'running', done: part.status === 'done', error: part.status === 'error' }">
                      <div class="step-icon">
                        <svg v-if="part.status === 'running'" class="spin-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                        <svg v-else-if="part.status === 'done'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </div>
                      <div class="step-body">
                        <div class="step-name">{{ toolLabel(part.name) }}</div>
                        <div class="step-summary">{{ part.summary }}</div>
                        <div v-if="part.result" class="step-result" :class="{ error: part.status === 'error' }">{{ part.result }}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="msg-text" v-html="part.rendered + (msg.streaming && pi === msg.parts.length - 1 ? '<span class=stream-cursor>▊</span>' : '')"></div>
              </template>
            </template>
            <template v-else>
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
            </template>
            <div class="msg-meta-row">
              <span class="msg-time">{{ msg.streaming ? (msg.text ? '生成中...' : '思考中...') : msg.time }}</span>
              <!-- Message actions (edit/delete/mention/retry/copy) — always visible for non-streaming -->
              <span v-if="!msg.streaming && !String(msg.id).startsWith('tmp-') && !String(msg.id).startsWith('stream-')" class="msg-actions">
                <button class="msg-action-btn danger" @click.stop="deleteMsg(msg)" title="删除">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
                <button class="msg-action-btn" @click.stop="startEditMsg(msg)" title="编辑">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button v-if="group.self" class="msg-action-btn retry-btn" @click.stop="retryMsg(msg)" title="重试">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                </button>
                <button v-if="!group.self" class="msg-action-btn copy-btn" @click.stop="copyMsg(msg)" title="复制">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
                <button v-if="!group.self && msg.sender_name" class="msg-action-btn mention-btn" @click.stop="onMentionClick(msg)" title="@提及">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>
                </button>
              </span>
            </div>
            <!-- Inline edit textarea -->
            <div v-if="editingMsgId === msg.id" class="msg-edit-box" @click.stop>
              <textarea v-model="editingMsgText" rows="2" class="msg-edit-input" @keydown.enter.ctrl.prevent="saveEditMsg(msg)" @keydown.escape="cancelEditMsg"></textarea>
              <div class="msg-edit-actions">
                <button class="msg-edit-save" @click.stop="saveEditMsg(msg)">保存</button>
                <button class="msg-edit-cancel" @click.stop="cancelEditMsg">取消</button>
              </div>
            </div>
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
    <!-- Approval dialog -->
    <div v-if="pendingApproval" class="approval-overlay">
      <div class="approval-dialog">
        <div class="approval-header">
          <span class="approval-icon">⚠️</span>
          <span class="approval-title">命令审批</span>
        </div>
        <div class="approval-agent">{{ pendingApproval.agentName }} 请求执行：</div>
        <div class="approval-command"><code>{{ pendingApproval.command }}</code></div>
        <div v-if="pendingApproval.description" class="approval-desc">{{ pendingApproval.description }}</div>
        <div class="approval-actions">
          <button class="approval-btn deny" @click="respondApproval('deny')">拒绝</button>
          <button class="approval-btn approve" @click="respondApproval('once')">允许执行</button>
          <button class="approval-btn approve-all" @click="respondApproval('session')" title="本次会话内同类命令自动通过">本次全部允许</button>
        </div>
      </div>
    </div>

    <!-- Input bar (hidden when info panel showing) -->
    <div
      v-if="!(type === 'group' && showSettings)"
      class="input-bar"
      :class="{ 'drag-over': isDraggingFiles, uploading: isUploadingFiles }"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDropFiles"
    >
      <div v-if="isDraggingFiles" class="drop-hint">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <span>松开即可添加到输入框</span>
      </div>
      <!-- Shortcut commands floating card -->
      <div v-if="showShortcutBar" class="shortcut-card" @click.stop>
        <div class="shortcut-card-head">
          <span>快捷指令</span>
          <button class="shortcut-close" @click="showShortcutBar = false">×</button>
        </div>
        <div class="shortcut-card-grid">
          <button v-for="cmd in shortcutCommands" :key="cmd.id" class="shortcut-card-item" @click="applyShortcut(cmd)" :title="cmd.label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path :d="cmd.icon"/></svg>
            <span>{{ cmd.label }}</span>
          </button>
        </div>
      </div>

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

      <button class="shortcut-trigger-btn" :class="{ active: showShortcutBar }" @click.stop="toggleShortcutBar" title="快捷指令">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        <span>快捷指令</span>
      </button>

      <button class="file-btn plus-btn" :class="{ active: showPlusMenu }" @click="togglePlusMenu" title="上传文件">
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
        @keydown.enter.exact.prevent="onEnterKey"
        @keydown.enter.shift.prevent="onShiftEnter"
        @keydown.down.prevent="moveMention(1)"
        @keydown.up.prevent="moveMention(-1)"
        @keydown.tab.prevent="onTab"
        @keydown.escape="closeMentions"
        @input="onInput"
        @paste="onPaste"
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
import { store, api, ws, escapeHtml, getAgentColor, getAgentIcon, loadConversations, clearUnread, currentRoomId, chatSettings, saveChatSettings, markStreamInterrupted } from '../store.js'
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
const pendingApproval = ref(null)
const attachments = ref([])
const isDraggingFiles = ref(false)
const isUploadingFiles = ref(false)
let dragDepth = 0
const threads = ref([])
const activeThreadId = ref(null)
const threadDrawerOpen = ref(false)
const showPlusMenu = ref(false)
const showShortcutBar = ref(false)

const hasActiveStreamInView = computed(() => Object.values(store.activeStreams).some(s => s.roomId === props.room.id && (s.threadId || null) === activeThreadId.value && !s.interrupted))

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

// Markdown render cache to avoid re-parsing on every computed tick
const _mdCache = new Map()
function cachedRenderMd(text, id) {
  if (!text) return ''
  const key = `${id}:${text.length}:${text.slice(0, 64)}`
  if (_mdCache.has(key)) return _mdCache.get(key)
  const html = renderMd(text)
  // Cap cache size
  if (_mdCache.size > 300) {
    const first = _mdCache.keys().next().value
    _mdCache.delete(first)
  }
  _mdCache.set(key, html)
  return html
}

const TOOL_LABELS = {
  run_command: '执行命令',
  read_file: '读取文件',
  write_file: '写入文件',
  http_request: 'HTTP 请求',
  search_files: '搜索文件',
  install_package: '安装依赖',
}
function toolLabel(name) { return TOOL_LABELS[name] || name }
function toggleToolsExpand(msg) {
  const sid = String(msg.id).startsWith('stream-') ? msg.id.replace('stream-', '') : `saved-${msg.id}`
  toolsExpandedMap.value[sid] = !msg.toolsExpanded
}

function getToolsExpanded(sid, isStreaming) {
  // If user has manually toggled, respect that
  if (toolsExpandedMap.value[sid] !== undefined) return toolsExpandedMap.value[sid]
  // Default: always collapsed (user can click to expand)
  return false
}

function onSettingsChange(val) {
  chatSettings.toolCallDisplay = val
  saveChatSettings()
}

// === Task 1: Click AI bubble to @mention ===
function onMentionClick(msg) {
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
    showShortcutBar.value = false
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', closePlusMenu, { once: true })
    }, 0)
  }
}
function closePlusMenu() {
  showPlusMenu.value = false
}
function toggleShortcutBar() {
  showShortcutBar.value = !showShortcutBar.value
  if (showShortcutBar.value) {
    showPlusMenu.value = false
    setTimeout(() => {
      document.addEventListener('click', closeShortcutBar, { once: true })
    }, 0)
  }
}
function closeShortcutBar(e) {
  if (e?.target?.closest?.('.shortcut-card, .shortcut-trigger-btn')) return
  showShortcutBar.value = false
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
  showShortcutBar.value = false

  // Direct-execute commands that don't need agent interaction
  if (cmd.command === '/clear') {
    handleCommand('/clear')
    return
  }
  if (cmd.command === '/stop') {
    // User stop means stop showing the live bubble immediately. Backend may save
    // a compact audit marker, but the long partial stream should disappear now.
    let count = 0
    for (const [streamId, stream] of Object.entries(store.activeStreams)) {
      if (stream.roomId === props.room.id && (stream.threadId || null) === activeThreadId.value) {
        if (ws._ws && ws._ws.readyState === WebSocket.OPEN) {
          ws._ws.send(JSON.stringify({ type: 'cancel_stream', stream_id: streamId }))
        }
        markStreamInterrupted(streamId)
        count++
      }
    }
    showToast(count ? '已停止生成' : '当前没有正在生成的回复')
    return
  }

  // Commands that need to be sent to the agent (compact, retry, summary)
  if (cmd.command === '/compact' || cmd.command === '/retry' || cmd.command === '/summary') {
    const toastMsg = cmd.command === '/compact' ? '正在压缩上下文...' : cmd.command === '/retry' ? '正在重新生成...' : '正在总结对话...'
    showToast(toastMsg)

    // /retry: don't show user message (backend handles deletion + re-trigger)
    if (cmd.command === '/retry') {
      const endpoint = activeThreadId.value ? `/admin/threads/${activeThreadId.value}/send` : `/admin/rooms/${props.room.id}/send`
      // Determine target agent
      const lastAgentMsg = [...messages.value].reverse().find(m => m.sender_id && m.sender_id !== 'user' && m.sender_id !== 'system')
      const mentions = lastAgentMsg ? [lastAgentMsg.sender_id] : []
      api('POST', endpoint, { text: '/retry', mentions })
      return
    }

    // Determine target agent (last agent that replied)
    const lastAgentMsg = [...messages.value].reverse().find(m => m.sender_id && m.sender_id !== 'user' && m.sender_id !== 'system')
    const mentions = []
    if (lastAgentMsg) mentions.push(lastAgentMsg.sender_id)
    else if (props.room.members?.length) {
      const first = props.room.members.find(m => m.id !== 'user' && m.id !== 'system')
      if (first) mentions.push(first.id)
    }

    // Add user message to UI
    messages.value.push({
      id: 'tmp-' + Date.now(),
      sender_id: 'user',
      sender_name: '我',
      text: cmd.command,
      created_at: new Date().toISOString(),
      clientSortTs: Date.now(),
    })
    nextTick(scrollToBottom)

    // Send to backend
    const endpoint = activeThreadId.value ? `/admin/threads/${activeThreadId.value}/send` : `/admin/rooms/${props.room.id}/send`
    api('POST', endpoint, { text: cmd.command, mentions })
    return
  }

  // Fallback: insert command and trigger @ mention picker
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
  markStreamInterrupted(streamId)
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

// Time formatting — convert UTC/ISO to local timezone
function formatMsgTime(ts) {
  if (!ts) return ''
  try {
    // Backend stores UTC without Z suffix, format: "2026-05-28 07:04:42"
    const normalized = ts.replace(' ', 'T') + (ts.includes('Z') || ts.includes('+') ? '' : 'Z')
    const d = new Date(normalized)
    if (isNaN(d.getTime())) return ts.slice(11, 16)
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch { return ts.slice(11, 16) }
}
function formatMsgDate(ts) {
  if (!ts) return ''
  try {
    const normalized = ts.replace(' ', 'T') + (ts.includes('Z') || ts.includes('+') ? '' : 'Z')
    const d = new Date(normalized)
    if (isNaN(d.getTime())) return ts.slice(0, 10)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch { return ts.slice(0, 10) }
}

function parseMessageTs(ts) {
  if (!ts) return 0
  if (typeof ts === 'number') return ts
  try {
    const value = String(ts)
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
    const normalized = value.replace(' ', 'T') + (hasZone ? '' : 'Z')
    const d = new Date(normalized)
    return isNaN(d.getTime()) ? 0 : d.getTime()
  } catch { return 0 }
}

function renderMd(text) {
  if (!text) return ''
  try {
    marked.setOptions({ breaks: true, gfm: true })

    // Convert MEDIA:/path/to/file to displayable content
    // Supports: MEDIA:/path, MEDIA:`/path`, **MEDIA:** `/path`
    let processed = text.replace(/(?:\*{0,2}MEDIA:?\*{0,2})\s*`?(\/[^\s\n`]+)`?/g, (match, filePath) => {
      const ext = filePath.split('.').pop().toLowerCase()
      const mediaUrl = `/admin/media${filePath}`
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
        return `![image](${mediaUrl})`
      } else if (['mp4', 'webm'].includes(ext)) {
        return `<video src="${mediaUrl}" controls style="max-width:100%;border-radius:8px"></video>`
      } else if (ext === 'pdf') {
        const fileName = filePath.split('/').pop()
        return `<a href="${mediaUrl}" target="_blank" class="file-card"><span class="file-card-icon">📄</span><span class="file-card-info"><span class="file-card-name">${fileName}</span><span class="file-card-meta">PDF 文档 · 点击预览</span></span></a>`
      } else {
        const fileName = filePath.split('/').pop()
        const downloadUrl = `${mediaUrl}?download=1`
        const icons = { zip: '🗜️', tar: '🗜️', gz: '🗜️', '7z': '🗜️', rar: '🗜️', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', ppt: '📽️', pptx: '📽️', txt: '📃', md: '📃', json: '📋', csv: '📊', sql: '🗃️' }
        const icon = icons[ext] || '📎'
        return `<a href="${downloadUrl}" download="${fileName}" class="file-card"><span class="file-card-icon">${icon}</span><span class="file-card-info"><span class="file-card-name">${fileName}</span><span class="file-card-meta">${ext.toUpperCase()} 文件 · 点击下载</span></span><span class="file-card-dl">⬇</span></a>`
      }
    })

    // Temporarily protect code blocks
    const codeBlocks = []
    processed = processed.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match)
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`
    })
    // Highlight @mentions (outside code blocks)
    processed = processed.replace(/@(\S+?)(?=[.,;:!?\s，。；：！？]|$)/g, '<span class="at-mention">@$1</span>')
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
  const replacedInterruptedStreams = new Set()
  messages.value.forEach(m => {
    const self = m.sender_id === 'user' || m.sender_id === 'system'
    // Parse metadata for tool_calls and chronological parts
    let toolCalls = null
    let parts = null
    if (m.metadata) {
      try {
        const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata
        if (meta.tool_calls && meta.tool_calls.length > 0) {
          toolCalls = meta.tool_calls
        }
        if (meta.parts && meta.parts.length > 0) {
          parts = meta.parts.map(p => p.type === 'text' ? { ...p, rendered: cachedRenderMd(p.text, `${m.id}-part-${p.text?.length || 0}`) } : p)
        }
        if (meta.interrupted && meta.stream_id && store.activeStreams[meta.stream_id]?.interrupted) {
          replacedInterruptedStreams.add(meta.stream_id)
        }
      } catch {}
    }
    const metaSortTs = (() => {
      try {
        const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : (m.metadata || {})
        return meta.sort_ts || meta.stream_started_at || 0
      } catch { return 0 }
    })()
    allMsgs.push({
      id: m.id,
      sender_id: m.sender_id,
      sender_name: m.sender_name,
      text: m.text,
      rendered: cachedRenderMd(m.text, m.id),
      time: formatMsgTime(m.created_at),
      date: formatMsgDate(m.created_at),
      sortTs: m.clientSortTs || metaSortTs || parseMessageTs(m.created_at),
      self,
      showName: !self && (props.type === 'group' || !self),
      toolCalls,
      parts,
      toolsExpanded: toolCalls ? getToolsExpanded(`saved-${m.id}`, false) : false,
    })
  })
  for (const sid in store.activeStreams) {
    const s = store.activeStreams[sid]
    if (replacedInterruptedStreams.has(sid)) continue
    if (s.roomId !== props.room.id) continue
    if ((s.threadId || null) !== activeThreadId.value) continue
    const startedAt = s.startedAt || Date.now()
    allMsgs.push({
      id: `stream-${sid}`,
      sender_id: s.agentId,
      sender_name: s.agentName,
      text: s.text,
      rendered: renderMd(s.text),
      time: s.interrupted ? '已中断' : '',
      date: '',
      sortTs: startedAt,
      self: false,
      showName: props.type === 'group',
      streaming: !s.interrupted,
      interrupted: s.interrupted,
      working: s.working,
      parts: (s.parts || []).map(p => p.type === 'text' ? { ...p, rendered: renderMd(p.text) } : p),
      toolCalls: s.toolCalls || [],
      toolsExpanded: getToolsExpanded(sid, true), // streaming = true
    })
  }
  allMsgs.sort((a, b) => {
    const ta = a.sortTs || 0
    const tb = b.sortTs || 0
    if (ta !== tb) return ta - tb
    return String(a.id).localeCompare(String(b.id))
  })
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

async function fetchMessages({ keepPosition = false, forceScroll = false } = {}) {
  const area = messagesArea.value
  const wasNearBottom = !area || (area.scrollHeight - area.scrollTop - area.clientHeight < 120)
  const prevHeight = area?.scrollHeight || 0
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
  if (keepPosition && area) {
    area.scrollTop += area.scrollHeight - prevHeight
  } else if (forceScroll || wasNearBottom) {
    scrollToBottom()
  }
}

async function fetchThreads() {
  const data = await api('GET', `/admin/rooms/${props.room.id}/threads`)
  threads.value = data.result || []
}

function selectThread(threadId) {
  activeThreadId.value = threadId
  messages.value = []
  fetchMessages({ forceScroll: true })
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
  fetchMessages({ forceScroll: true })
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

// === Message edit/delete ===
const editingMsgId = ref(null)
const editingMsgText = ref('')

function startEditMsg(msg) {
  editingMsgId.value = msg.id
  editingMsgText.value = msg.text
}

function cancelEditMsg() {
  editingMsgId.value = null
  editingMsgText.value = ''
}

async function saveEditMsg(msg) {
  const newText = editingMsgText.value.trim()
  if (!newText) return
  await api('PATCH', `/admin/messages/${msg.id}`, { text: newText })
  // Update local state
  const found = messages.value.find(m => m.id === msg.id)
  if (found) found.text = newText
  editingMsgId.value = null
  editingMsgText.value = ''
  fetchMessages()
}

async function deleteMsg(msg) {
  if (!confirm('确定删除这条消息？')) return
  await api('DELETE', `/admin/messages/${msg.id}`)
  messages.value = messages.value.filter(m => m.id !== msg.id)
}

async function retryMsg(msg) {
  // For user messages: delete and re-send the same text
  // For AI messages: delete the AI response and re-send the last user message before it
  if (msg.sender_id === 'user') {
    const text = msg.text
    await api('DELETE', `/admin/messages/${msg.id}`)
    messages.value = messages.value.filter(m => m.id !== msg.id)
    // Re-send
    inputText.value = text
    await nextTick()
    send()
  } else {
    // Find the last user message before this AI message
    const idx = messages.value.findIndex(m => m.id === msg.id)
    let userMsg = null
    for (let i = idx - 1; i >= 0; i--) {
      if (messages.value[i].sender_id === 'user') {
        userMsg = messages.value[i]
        break
      }
    }
    // Delete the AI message
    await api('DELETE', `/admin/messages/${msg.id}`)
    messages.value = messages.value.filter(m => m.id !== msg.id)
    // Re-send the user message (or just re-trigger with @agent)
    if (userMsg) {
      inputText.value = userMsg.text
      await nextTick()
      send()
    }
  }
}

async function copyMsg(msg) {
  try {
    await navigator.clipboard.writeText(msg.text)
    showToast('已复制到剪贴板')
  } catch (err) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea')
    textarea.value = msg.text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    showToast('已复制到剪贴板')
  }
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

const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

function onEnterKey() {
  if (showMentions.value && mentionCandidates.value[mentionIndex.value]) {
    selectMention(mentionCandidates.value[mentionIndex.value])
    return
  }
  if (isMobile) {
    // Mobile: Enter = newline
    insertNewline()
  } else {
    // Desktop: Enter = send
    send()
  }
}

function onShiftEnter() {
  // Desktop: Shift+Enter = newline (mobile won't trigger this)
  insertNewline()
}

function insertNewline() {
  const el = inputEl.value
  if (!el) return
  const start = el.selectionStart
  const end = el.selectionEnd
  inputText.value = inputText.value.slice(0, start) + '\n' + inputText.value.slice(end)
  nextTick(() => {
    el.selectionStart = el.selectionEnd = start + 1
    autoResize({ target: el })
  })
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
function getEventFiles(e) {
  return Array.from(e?.dataTransfer?.files || []).filter(f => f && f.size >= 0)
}

function hasDraggedFiles(e) {
  return Array.from(e?.dataTransfer?.types || []).includes('Files')
}

async function uploadFiles(files, source = '上传') {
  if (!files?.length) return
  isUploadingFiles.value = true
  const token = localStorage.getItem('hub_auth_token')
  let okCount = 0
  for (const f of files) {
    const fd = new FormData()
    fd.append('file', f, f.name || `${source}-${Date.now()}.${f.type?.split('/')[1] || 'bin'}`)
    try {
      const headers = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const r = await fetch('/admin/upload', { method: 'POST', body: fd, headers })
      const data = await r.json()
      if (data.ok) {
        attachments.value.push({ url: data.url, type: data.type, name: data.name, size: data.size })
        okCount++
      } else {
        showToast(`${source}失败: ` + (data.error || '未知错误'))
      }
    } catch (err) {
      showToast(`${source}失败: ` + err.message)
    }
  }
  isUploadingFiles.value = false
  if (okCount) {
    inputEl.value?.focus()
    showToast(okCount === 1 ? '已添加到输入框' : `已添加 ${okCount} 个文件`)
  }
}

function onDragEnter(e) {
  if (!hasDraggedFiles(e)) return
  dragDepth++
  isDraggingFiles.value = true
}

function onDragOver(e) {
  if (!hasDraggedFiles(e)) return
  e.dataTransfer.dropEffect = 'copy'
  isDraggingFiles.value = true
}

function onDragLeave(e) {
  if (!hasDraggedFiles(e)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) isDraggingFiles.value = false
}

async function onDropFiles(e) {
  dragDepth = 0
  isDraggingFiles.value = false
  const files = getEventFiles(e)
  if (!files.length) return
  await uploadFiles(files, '拖拽上传')
}

async function onPaste(e) {
  const items = e.clipboardData?.items
  if (!items) return
  const files = []
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  if (!files.length) return
  // Prevent default paste of image as text
  e.preventDefault()
  await uploadFiles(files, '粘贴上传')
}

async function onFiles(e) {
  const files = Array.from(e.target.files || [])
  await uploadFiles(files, '上传')
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
  const mentionRegex = /@([^\s@,，.。;；:：!！?？]+)/g
  let match
  while ((match = mentionRegex.exec(text)) !== null) {
    const name = match[1].replace(/[*_`~|]/g, '').trim()
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

  // Auto-interrupt: keep the old stream in-place and mark it interrupted so the
  // next user turn appears below it in the correct order.
  if (ws._ws && ws._ws.readyState === WebSocket.OPEN) {
    for (const [streamId, stream] of Object.entries(store.activeStreams)) {
      if (stream.roomId === props.room.id && (stream.threadId || null) === activeThreadId.value && (mentions.includes(stream.agentId) || mentions.length === 0)) {
        ws._ws.send(JSON.stringify({ type: 'cancel_stream', stream_id: streamId }))
        markStreamInterrupted(streamId)
      }
    }
  }

  // Optimistic add
  messages.value.push({
    id: 'tmp-' + Date.now(),
    sender_id: 'user',
    sender_name: '我',
    text: body,
    created_at: new Date().toISOString(),
    clientSortTs: Date.now(),
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
  } else if (cmd === '/compact' || cmd === '/summary') {
    // These need to be sent to the agent as regular messages
    const toastMsg = cmd === '/compact' ? '正在压缩上下文...' : '正在总结对话...'
    showToast(toastMsg)
    const lastAgentMsg = [...messages.value].reverse().find(m => m.sender_id && m.sender_id !== 'user' && m.sender_id !== 'system')
    const mentions = []
    if (lastAgentMsg) mentions.push(lastAgentMsg.sender_id)
    else if (props.room.members?.length) {
      const first = props.room.members.find(m => m.id !== 'user' && m.id !== 'system')
      if (first) mentions.push(first.id)
    }
    messages.value.push({
      id: 'tmp-' + Date.now(),
      sender_id: 'user',
      sender_name: '我',
      text: cmd,
      created_at: new Date().toISOString(),
      clientSortTs: Date.now(),
    })
    nextTick(scrollToBottom)
    const endpoint = activeThreadId.value ? `/admin/threads/${activeThreadId.value}/send` : `/admin/rooms/${props.room.id}/send`
    api('POST', endpoint, { text: cmd, mentions })
  } else if (cmd === '/retry') {
    showToast('正在重新生成...')
    const lastAgentMsg = [...messages.value].reverse().find(m => m.sender_id && m.sender_id !== 'user' && m.sender_id !== 'system')
    const mentions = lastAgentMsg ? [lastAgentMsg.sender_id] : []
    const endpoint = activeThreadId.value ? `/admin/threads/${activeThreadId.value}/send` : `/admin/rooms/${props.room.id}/send`
    api('POST', endpoint, { text: '/retry', mentions })
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
  // Also refresh room members directly for mention candidates
  try {
    const data = await api('GET', '/admin/rooms')
    const updated = (data.result || []).find(r => r.id === props.room.id)
    if (updated && updated.members) {
      props.room.members = updated.members
    }
  } catch {}
}

async function respondApproval(decision) {
  if (!pendingApproval.value) return
  const id = pendingApproval.value.id
  pendingApproval.value = null
  await api('POST', `/admin/approvals/${id}`, { decision })
}

function handleWS(msg) {
  if (msg.type === 'stream_start' && msg.room_id === props.room.id) {
    // activeStreams is now managed globally in store.js
    typingAgent.value = null
    nextTick(scrollToBottomIfNeeded)
  } else if (msg.type === 'tool_call' && store.activeStreams[msg.stream_id]) {
    // Tool calls are now handled globally in store.js — just scroll
    nextTick(scrollToBottomIfNeeded)
  } else if (msg.type === 'tool_result' && store.activeStreams[msg.stream_id]) {
    // Tool results are now handled globally in store.js — just scroll
    nextTick(scrollToBottomIfNeeded)
  } else if (msg.type === 'stream_token' && store.activeStreams[msg.stream_id]) {
    // Stream tokens are now handled globally in store.js — just scroll
    nextTick(scrollToBottomIfNeeded)
  } else if (msg.type === 'stream_end' && msg.room_id === props.room.id) {
    // new_message arrives before stream_end; let stream_end do the final refresh
    if (!store.activeStreams[msg.stream_id]) {
      setTimeout(() => fetchMessages({ forceScroll: true }), 120)
    }
  } else if (msg.type === 'new_message' && msg.room_id === props.room.id) {
    // Only fetch if thread matches current view
    const msgThread = msg.thread_id || null
    if (msgThread === activeThreadId.value && !hasActiveStreamInView.value) {
      fetchMessages({ forceScroll: true })
    }
    // Refresh threads list in case a workflow created a new thread
    fetchThreads()
  } else if (msg.type === 'typing' && msg.room_id === props.room.id) {
    typingAgent.value = msg.from?.name || null
    setTimeout(() => { typingAgent.value = null }, 3000)
  } else if (msg.type === 'approval_request' && msg.room_id === props.room.id) {
    // Show approval dialog
    pendingApproval.value = {
      id: msg.approval_id,
      command: msg.command,
      description: msg.description,
      agentName: msg.agent_name,
    }
  } else if (msg.type === 'message_deleted' && msg.room_id === props.room.id) {
    // Remove deleted message from local list
    const msgThread = msg.thread_id || null
    if (msgThread === activeThreadId.value) {
      messages.value = messages.value.filter(m => m.id !== msg.message_id)
    }
  }
}

onMounted(() => {
  clearUnread(props.room.id)
  currentRoomId.value = props.room.id
  fetchMessages({ forceScroll: true })
  fetchThreads()
  pollTimer = setInterval(() => {
    if (!hasActiveStreamInView.value) fetchMessages({ keepPosition: true })
  }, 3000)
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

// Note: room switching is handled by :key on <ChatView> which destroys/recreates the component
</script>
