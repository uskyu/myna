<template>
  <div class="page active">
    <div class="header">
      <h1>消息</h1>
      <div class="actions">
        <button @click="$emit('create-room')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
    </div>
    <div class="chat-list">
      <template v-if="store.rooms.length">
        <div class="list-section-title">群聊</div>
        <div v-for="(r, i) in store.rooms" :key="r.id" class="chat-item" @click="$emit('open-chat', r, 'group')">
          <div class="avatar" :style="{ background: getAgentColor(i + 2) }">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div class="info">
            <div class="name">{{ r.name }}</div>
            <div class="preview">{{ r.last_message ? r.last_message.sender_name + ': ' + r.last_message.text.slice(0, 30) : (r.members?.length || 0) + ' 个成员' }}</div>
          </div>
          <div class="meta">
            <span class="time">{{ r.last_message?.created_at?.slice(11, 16) || '' }}</span>
            <span v-if="store.unreadCounts[r.id] > 0" class="unread-badge">{{ store.unreadCounts[r.id] }}</span>
            <span v-else-if="isRoomActive(r.id)" class="active-badge"><span class="pulse-dot"></span>生成中</span>
          </div>
        </div>
      </template>
      <template v-if="store.dms.length">
        <div class="list-section-title">私聊</div>
        <div v-for="dm in store.dms" :key="dm.id" class="chat-item" @click="$emit('open-chat', dm, 'dm')">
          <div class="avatar round" :style="{ background: getAgentColor(agentIndex(dm.agent?.id)) }">
            <span v-html="getAgentIcon(agentIndex(dm.agent?.id))"></span>
          </div>
          <div class="info">
            <div class="name">{{ dm.agent?.name || '未知' }}</div>
            <div class="preview">{{ dm.last_message?.text?.slice(0, 30) || '开始对话' }}</div>
          </div>
          <div class="meta">
            <span class="time">{{ dm.last_message?.created_at?.slice(11, 16) || '' }}</span>
            <span v-if="store.unreadCounts[dm.id] > 0" class="unread-badge">{{ store.unreadCounts[dm.id] }}</span>
            <span v-else-if="isRoomActive(dm.id)" class="active-badge"><span class="pulse-dot"></span>生成中</span>
          </div>
        </div>
      </template>
      <div v-if="!store.rooms.length && !store.dms.length" class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <p>还没有对话</p>
        <p>点击右上角 + 创建群聊</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { store, loadConversations, loadAgents, getAgentColor, getAgentIcon } from '../store.js'

defineEmits(['open-chat', 'create-room'])

const agentIndex = (id) => store.agents.findIndex(a => a.id === id)

function isRoomActive(roomId) {
  return Object.values(store.activeStreams).some(s => s.roomId === roomId)
}

let timer
onMounted(() => {
  loadConversations()
  loadAgents()
  timer = setInterval(loadConversations, 5000)
})
onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.unread-badge {
  background: var(--accent);
  color: white;
  font-size: 11px;
  min-width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}
</style>
