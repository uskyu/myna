<template>
  <!-- Login gate -->
  <LoginPage v-if="!isAuthenticated" @authenticated="onAuthenticated" />

  <div v-else class="app" :class="{ 'desktop-layout': isDesktop }">
    <!-- Desktop sidebar (icon bar) -->
    <div class="desktop-sidebar" v-if="isDesktop">
      <div class="sidebar-icon" :class="{ active: page === 'chats' }" @click="page = 'chats'" title="消息">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <div class="sidebar-icon" :class="{ active: page === 'agents' }" @click="page = 'agents'" title="智能体">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>
      </div>
      <div class="sidebar-icon" :class="{ active: page === 'admin' }" @click="page = 'admin'" title="管理中心">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      </div>
      <div class="sidebar-icon" :class="{ active: page === 'settings' }" @click="page = 'settings'" title="设置">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span v-if="updateInfo.available" class="red-dot"></span>
      </div>
    </div>

    <!-- Desktop list panel -->
    <div class="desktop-list-panel" v-if="isDesktop">
      <ChatList v-if="page === 'chats'" @open-chat="openChat" @create-room="showModal('room')" />
      <AgentList v-if="page === 'agents'" @open-detail="openAgentDetail" @create-agent="showModal('agent')" />
      <AdminCenter v-if="page === 'admin'" />
      <SettingsPage v-if="page === 'settings'" />
    </div>

    <!-- Desktop chat panel -->
    <div class="desktop-chat-panel" v-if="isDesktop">
      <ChatView v-if="currentRoom" :room="currentRoom" :type="currentRoomType" @close="closeChat" />
      <AgentDetail v-if="currentAgent" :agent="currentAgent" @close="currentAgent = null" @delete="deleteAgent" />
      <div v-if="!currentRoom && !currentAgent" class="desktop-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="48" height="48"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <p>选择一个对话开始聊天</p>
      </div>
    </div>

    <!-- Mobile layout (original) -->
    <template v-if="!isDesktop">
      <div class="app-inner">
        <ChatList v-if="page === 'chats'" @open-chat="openChat" @create-room="showModal('room')" />
        <AgentList v-if="page === 'agents'" @open-detail="openAgentDetail" @create-agent="showModal('agent')" />
        <AdminCenter v-if="page === 'admin'" />
        <SettingsPage v-if="page === 'settings'" />
        <ChatView v-if="currentRoom" :room="currentRoom" :type="currentRoomType" @close="closeChat" />
        <AgentDetail v-if="currentAgent" :agent="currentAgent" @close="currentAgent = null" @delete="deleteAgent" />
      </div>
      <div class="bottom-nav" v-if="!currentRoom && !currentAgent">
        <div class="nav-item" :class="{ active: page === 'chats' }" @click="page = 'chats'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span class="label">消息</span>
        </div>
        <div class="nav-item" :class="{ active: page === 'agents' }" @click="page = 'agents'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>
          <span class="label">智能体</span>
        </div>
        <div class="nav-item" :class="{ active: page === 'admin' }" @click="page = 'admin'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          <span class="label">管理</span>
        </div>
        <div class="nav-item" :class="{ active: page === 'settings' }" @click="page = 'settings'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span class="label">设置</span>
          <span v-if="updateInfo.available" class="red-dot"></span>
        </div>
      </div>
    </template>

    <RoomModal v-if="modals.room" @close="modals.room = false" @created="onRoomCreated" />
    <AgentModal v-if="modals.agent" @close="modals.agent = false" @created="onAgentCreated" />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, provide, computed, watch } from 'vue'
import ChatList from './components/ChatList.vue'
import ChatView from './components/ChatView.vue'
import AgentList from './components/AgentList.vue'
import AgentDetail from './components/AgentDetail.vue'
import SettingsPage from './components/SettingsPage.vue'
import AdminCenter from './components/AdminCenter.vue'
import RoomModal from './components/RoomModal.vue'
import AgentModal from './components/AgentModal.vue'
import LoginPage from './components/LoginPage.vue'
import { api, ws, auth, setAuthToken, clearAuth, updateInfo, checkForUpdate } from './store.js'

const isAuthenticated = ref(false)
const page = ref('chats')
const currentRoom = ref(null)
const currentRoomType = ref('group')
const currentAgent = ref(null)
const modals = reactive({ room: false, agent: false })

// Desktop detection (reactive)
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 0)
const isDesktop = computed(() => windowWidth.value >= 768)

function onResize() {
  windowWidth.value = window.innerWidth
}

provide('page', page)
provide('isDesktop', isDesktop)

// Fix page overlap: clear opposite panel when switching pages
watch(page, (newPage) => {
  if (newPage === 'agents') currentRoom.value = null
  else if (newPage === 'chats') currentAgent.value = null
  else { currentRoom.value = null; currentAgent.value = null }
})

function openChat(room, type) {
  currentRoom.value = room
  currentRoomType.value = type
  // Push history state so mobile back button works
  history.pushState({ view: 'chat', roomId: room.id }, '', `#chat/${room.id}`)
}

function closeChat() {
  currentRoom.value = null
  // Replace state to list view
  history.replaceState({ view: 'list' }, '', '#')
}

function openAgentDetail(agent) {
  currentAgent.value = agent
  history.pushState({ view: 'agent', agentId: agent.id }, '', `#agent/${agent.id}`)
}

// Handle browser back button (mobile)
function onPopState(e) {
  if (currentRoom.value) {
    currentRoom.value = null
  } else if (currentAgent.value) {
    currentAgent.value = null
  }
}

function showModal(name) { modals[name] = true }

function onRoomCreated(room) {
  modals.room = false
  openChat(room, 'group')
}

function onAgentCreated(agent) {
  modals.agent = false
}

function onAuthenticated() {
  isAuthenticated.value = true
  // Connect WS after auth
  ws.connect()
  // Auto check for updates
  checkForUpdate()
}

async function checkAuth() {
  if (auth.token) {
    const res = await api('GET', '/auth/check')
    if (res.authenticated) {
      isAuthenticated.value = true
      ws.connect()
      checkForUpdate()
      return
    }
    clearAuth()
  }
  isAuthenticated.value = false
}

async function deleteAgent(id) {
  await api('DELETE', `/admin/agents/${id}`)
  currentAgent.value = null
}

onMounted(() => {
  // Init theme
  const dark = localStorage.getItem('hub-theme') === 'dark'
  if (dark) document.documentElement.setAttribute('data-theme', 'dark')
  // Check auth first, WS connects after auth
  checkAuth()
  // Listen for back button
  window.addEventListener('popstate', onPopState)
  // Listen for resize (desktop detection)
  window.addEventListener('resize', onResize)
  // Set initial state
  history.replaceState({ view: 'list' }, '', '#')
})

onUnmounted(() => {
  window.removeEventListener('popstate', onPopState)
  window.removeEventListener('resize', onResize)
})
</script>
