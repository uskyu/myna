<template>
  <div class="page active">
    <div class="header">
      <h1>智能体</h1>
      <div class="actions">
        <button @click="$emit('create-agent')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
    </div>
    <div class="search-bar">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input type="text" v-model="filter" placeholder="搜索智能体...">
    </div>
    <div class="agent-grid list-view">
      <div v-for="a in filtered" :key="a.id" class="agent-card" @click="$emit('open-detail', a)">
        <div class="avatar-wrap">
          <div class="agent-avatar" :style="{ background: getAgentColor(agentIndex(a.id)) }">
            <span v-html="getAgentIcon(agentIndex(a.id))"></span>
          </div>
          <span class="status-dot" :class="a.status === 'online' ? 'online' : 'offline'"></span>
        </div>
        <div class="info-block">
          <div class="agent-name">{{ a.name }}</div>
          <div class="agent-desc">{{ a.description || '通用智能体' }}</div>
        </div>
        <button class="btn-dm" @click.stop="startDM(a.id)" title="发消息">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </button>
      </div>
    </div>
    <div v-if="!filtered.length" class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>
      <p>{{ filter ? '没有匹配的智能体' : '还没有智能体' }}</p>
      <p>点击右上角 + 创建</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { store, loadAgents, api, getAgentColor, getAgentIcon } from '../store.js'

const emit = defineEmits(['open-detail', 'create-agent'])
const filter = ref('')
const sort = ref(localStorage.getItem('hub-agent-sort') || 'name')

watch(sort, (v) => localStorage.setItem('hub-agent-sort', v))

const agentIndex = (id) => store.agents.findIndex(a => a.id === id)

const filtered = computed(() => {
  let list = [...store.agents]
  if (filter.value) {
    const q = filter.value.toLowerCase()
    list = list.filter(a => (a.name || '').toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q))
  }
  if (sort.value === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
  else if (sort.value === 'status') list.sort((a, b) => (a.status === 'online' ? -1 : 1) - (b.status === 'online' ? -1 : 1))
  else if (sort.value === 'newest') list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  return list
})

async function startDM(agentId) {
  const data = await api('POST', `/admin/dm/${agentId}`)
  if (data.ok) {
    window.location.reload()
  }
}

onMounted(loadAgents)
</script>

<style scoped>
.agent-grid.list-view .agent-card {
  display: grid;
  grid-template-columns: 44px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.agent-grid.list-view .agent-card:hover {
  background: rgba(255, 255, 255, 0.05);
}

.avatar-wrap {
  position: relative;
  width: 44px;
  height: 44px;
}

.agent-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #fff;
}

.status-dot {
  position: absolute;
  bottom: 1px;
  right: 1px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1.5px solid var(--bg-primary, #1a1a2e);
  box-sizing: content-box;
}

.status-dot.online {
  background: #4ade80;
}

.status-dot.offline {
  background: #6b7280;
}

.info-block {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agent-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.agent-desc {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.btn-dm {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary, #94a3b8);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.btn-dm:hover {
  background: rgba(99, 102, 241, 0.2);
  color: #818cf8;
}
</style>
