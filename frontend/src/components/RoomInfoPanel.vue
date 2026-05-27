<template>
  <div class="info-panel">
    <!-- Header card -->
    <div class="info-head">
      <div class="info-head-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </div>
      <div class="info-head-meta">
        <input class="head-name-input" v-model="form.name" @blur="saveField" placeholder="群聊名称">
        <div class="head-meta-row">
          <span class="meta-pill">{{ members.length }} 个成员</span>
          <span v-if="saving" class="saving-tag">保存中...</span>
          <span v-else-if="lastSavedTag" class="saved-tag">{{ lastSavedTag }}</span>
        </div>
      </div>
    </div>

    <!-- Description -->
    <div class="info-section">
      <h4>简介</h4>
      <textarea
        v-model="form.description"
        @blur="saveField"
        placeholder="这个群聊用来做什么？"
        rows="2"
      ></textarea>
    </div>

    <!-- Collaboration Settings -->
    <div class="info-section">
      <h4>⚙️ 协作设置</h4>
      <div class="setting-row">
        <label class="setting-label">最大协作轮数</label>
        <input
          type="number"
          class="setting-input"
          v-model.number="roomSettings.max_chain_depth"
          @change="saveSettings"
          min="1"
          max="20"
          placeholder="5"
        >
      </div>
    </div>

    <!-- Members -->
    <div class="info-section">
      <div class="section-head">
        <h4>成员 <span class="muted">({{ members.length }})</span></h4>
      </div>
      <div class="member-list">
        <div v-for="m in members" :key="m.id" class="member-row">
          <div class="member-avatar" :style="{ background: getAgentColor(agentColorIdx(m.id)) }">
            <span v-html="getAgentIcon(agentColorIdx(m.id))"></span>
          </div>
          <div class="member-info">
            <div class="member-name">{{ m.name }}</div>
            <div class="member-status">
              <span class="dot" :class="m.status === 'online' ? 'online' : 'offline'"></span>
              {{ m.status === 'online' ? '在线' : '离线' }}
            </div>
          </div>
          <button v-if="m.id !== 'user'" class="icon-btn danger" @click="removeMember(m)" title="移出群聊">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <div v-if="available.length" class="add-member-block">
        <div class="section-mini">添加智能体</div>
        <div class="member-list">
          <div v-for="a in available" :key="a.id" class="member-row clickable" @click="addMember(a)">
            <div class="member-avatar" :style="{ background: getAgentColor(agentColorIdx(a.id)) }">
              <span v-html="getAgentIcon(agentColorIdx(a.id))"></span>
            </div>
            <div class="member-info">
              <div class="member-name">{{ a.name }}</div>
              <div class="member-status">
                <span class="dot" :class="a.status === 'online' ? 'online' : 'offline'"></span>
                {{ a.description || '通用智能体' }}
              </div>
            </div>
            <button class="icon-btn add">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Group skills / knowledge (placeholder) -->
    <div class="info-section">
      <div class="section-head">
        <h4>🛠 群聊技能</h4>
        <span class="muted soon-tag">开发中</span>
      </div>
      <div class="hint-box">
        <p>群聊级别的工作流和共享技能，例如：</p>
        <ul>
          <li>固定流程触发器（每周复盘、每日早报）</li>
          <li>系统机器人（专责执行工作流的智能体）</li>
          <li>群聊知识库（成员共享的资料）</li>
        </ul>
      </div>
    </div>

    <div class="info-section">
      <div class="section-head">
        <h4>📒 群聊总结</h4>
        <span class="muted soon-tag">开发中</span>
      </div>
      <div class="hint-box">
        <p>自动生成群聊关键决策、待办、议题摘要。</p>
      </div>
    </div>

    <div class="info-section danger-zone">
      <h4>危险操作</h4>
      <button class="btn btn-danger" @click="clearMessages" style="width:100%;margin-bottom:8px">清空对话记录</button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { api, store, getAgentColor, getAgentIcon, loadConversations } from '../store.js'

const props = defineProps({ room: Object })
const emit = defineEmits(['close', 'changed'])

const members = ref([])
const saving = ref(false)
const lastSavedTag = ref('')
const form = reactive({
  name: props.room.name || '',
  description: props.room.description || '',
})
const roomSettings = reactive({
  max_chain_depth: 5,
})

async function load() {
  const data = await api('GET', '/admin/rooms')
  const room = (data.result || []).find(r => r.id === props.room.id)
  if (room) {
    members.value = room.members || []
    if (!form.name) form.name = room.name || ''
    if (!form.description) form.description = room.description || ''
    // Load settings from room's settings_json
    if (room.settings_json) {
      try {
        const s = typeof room.settings_json === 'string' ? JSON.parse(room.settings_json) : room.settings_json
        if (s.max_chain_depth) roomSettings.max_chain_depth = s.max_chain_depth
      } catch {}
    }
  }
}

const available = computed(() => {
  const ids = new Set(members.value.map(m => m.id))
  return store.agents.filter(a => !ids.has(a.id))
})

const agentColorIdx = (id) => store.agents.findIndex(a => a.id === id)

let saveTimer = null
async function saveField() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    saving.value = true
    lastSavedTag.value = ''
    try {
      const res = await api('PUT', `/admin/rooms/${props.room.id}`, {
        name: form.name,
        description: form.description,
      })
      if (res && (res.ok || res.ok === undefined)) {
        Object.assign(props.room, { name: form.name, description: form.description })
        await loadConversations()
        emit('changed')
        lastSavedTag.value = '已保存'
        setTimeout(() => { lastSavedTag.value = '' }, 1600)
      } else {
        lastSavedTag.value = '保存失败'
      }
    } catch(e) {
      lastSavedTag.value = '保存失败'
    } finally {
      saving.value = false
    }
  }, 280)
}

async function saveSettings() {
  const val = Math.max(1, Math.min(20, roomSettings.max_chain_depth || 5))
  roomSettings.max_chain_depth = val
  await api('PUT', `/admin/rooms/${props.room.id}`, {
    settings_json: { max_chain_depth: val }
  })
}

async function addMember(a) {
  const res = await api('POST', `/admin/rooms/${props.room.id}/members`, { agent_id: a.id })
  if (res.ok || res.ok === undefined) {
    await load()
    await loadConversations()
    emit('changed')
  }
}

async function removeMember(m) {
  if (!confirm(`将「${m.name}」移出群聊？`)) return
  const res = await api('DELETE', `/admin/rooms/${props.room.id}/members/${m.id}`)
  if (res.ok || res.ok === undefined) {
    await load()
    await loadConversations()
    emit('changed')
  }
}

async function clearMessages() {
  if (!confirm('确定清空本群所有对话记录？此操作无法撤销。')) return
  const res = await api('DELETE', `/admin/rooms/${props.room.id}/messages`)
  if (res && (res.ok || res.ok === undefined)) {
    emit('changed')
    emit('close')
  }
}

onMounted(load)
</script>

<style scoped>
.info-panel {
  flex: 1;
  overflow-y: auto;
  padding: 18px 18px 24px;
  background: var(--bg);
}

.info-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  margin-bottom: 18px;
}
.info-head-icon {
  width: 56px; height: 56px;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--accent), var(--accent-soft-deep, var(--amber)));
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 6px 14px rgba(45, 106, 79, 0.22);
}
.info-head-icon svg { width: 26px; height: 26px; color: white; }
.info-head-meta { flex: 1; min-width: 0; }
.head-name-input {
  width: 100%;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.01em;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  margin: 0 0 4px -8px;
}
.head-name-input:hover { border-color: var(--border); background: var(--surface2); }
.head-name-input:focus { outline: none; border-color: var(--accent); background: var(--surface); }

.head-meta-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.meta-pill {
  font-size: 12px;
  background: var(--surface2);
  border: 1px solid var(--border);
  padding: 3px 10px;
  border-radius: 999px;
  color: var(--text-2);
}
.saving-tag, .saved-tag {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  background: var(--accent-soft); color: var(--accent); font-weight: 600;
}
.saving-tag { color: var(--text-dim); background: var(--surface2); }

.info-section {
  margin-bottom: 22px;
  padding-bottom: 4px;
}
.info-section h4 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dim);
  font-weight: 700;
  margin: 0 0 10px;
  display: flex; align-items: center; gap: 6px;
}
.section-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
}
.section-head h4 { margin: 0; }
.section-mini {
  font-size: 11px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  margin: 14px 0 8px;
}
.muted { color: var(--text-dim); font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 12px; }
.soon-tag {
  font-size: 10px;
  background: var(--surface2);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 999px;
}

.info-section textarea {
  width: 100%;
  padding: 11px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  font-family: inherit;
  background: var(--surface);
  color: var(--text);
  resize: vertical;
  line-height: 1.55;
}
.info-section textarea:focus { outline: none; border-color: var(--accent); box-shadow: var(--shadow-glow); }

.member-list { }
.member-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 6px;
  background: var(--surface);
  transition: border-color 0.15s ease, background 0.15s ease;
}
.member-row:hover { background: var(--surface2); }
.member-row.clickable { cursor: pointer; }
.member-row.clickable:hover { border-color: var(--accent); }

.member-avatar {
  width: 38px; height: 38px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.member-avatar svg, .member-avatar span svg { width: 18px; height: 18px; color: white; }

.member-info { flex: 1; min-width: 0; }
.member-name { font-size: 14px; font-weight: 600; color: var(--text); }
.member-status { font-size: 12px; color: var(--text-dim); margin-top: 2px; display: flex; align-items: center; gap: 6px; }
.dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.dot.online { background: var(--success); }
.dot.offline { background: var(--text-faint); }

.icon-btn {
  background: transparent; border: 1px solid var(--border);
  width: 32px; height: 32px;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.icon-btn svg { width: 14px; height: 14px; }
.icon-btn.add:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.icon-btn.danger:hover { color: var(--danger); border-color: var(--danger); background: var(--danger-soft); }

.add-member-block { margin-top: 12px; }

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.setting-label {
  font-size: 14px;
  color: var(--text);
  font-weight: 500;
}
.setting-input {
  width: 64px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-family: inherit;
  background: var(--surface2);
  color: var(--text);
  text-align: center;
}
.setting-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--shadow-glow);
}

.hint-box {
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.6;
}
.hint-box p { margin: 0 0 8px; }
.hint-box ul { margin: 0; padding-left: 20px; color: var(--text-dim); }
.hint-box li { margin-bottom: 4px; }

.danger-zone {
  margin-top: 32px;
  padding: 16px;
  border: 1px solid var(--danger-soft);
  border-radius: var(--radius);
  background: var(--surface);
}
.danger-zone h4 { color: var(--danger); margin-bottom: 12px; }
</style>
