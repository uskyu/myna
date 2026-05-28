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
          min="0"
          max="50"
          placeholder="5"
        >
      </div>
      <div class="setting-hint">设为 0 表示不限制，智能体可自主规划协作深度</div>
      <div class="setting-row" style="margin-top:10px">
        <label class="setting-label">上下文消息数</label>
        <input
          type="number"
          class="setting-input"
          v-model.number="roomSettings.context_messages_limit"
          @change="saveSettings"
          min="0"
          max="200"
          placeholder="全局默认"
        >
      </div>
      <div class="setting-hint">智能体能看到的最近消息条数。设为 0 表示使用全局设置</div>
    </div>

    <!-- Room Skills -->
    <div class="info-section">
      <div class="section-head">
        <h4>🧠 技能配置</h4>
        <button class="btn-sm" @click="showSkillPicker = true">管理</button>
      </div>
      <div v-if="roomSkills.length === 0" class="hint-box">
        <p>未配置技能隔离。当前使用各智能体的全部技能。</p>
        <p class="hint-sub">点击「管理」选择本群聊启用的技能，实现不同群聊间技能隔离。</p>
      </div>
      <div v-else class="skill-chips">
        <div v-for="s in roomSkills" :key="s.id" class="skill-chip">
          <span class="skill-chip-name">{{ s.name }}</span>
          <span v-if="s.agent_name" class="skill-chip-from">{{ s.agent_name }}</span>
          <button class="skill-chip-remove" @click="removeRoomSkill(s.id)" title="移除">×</button>
        </div>
      </div>

      <!-- Skill picker modal -->
      <div v-if="showSkillPicker" class="skill-picker-overlay" @click.self="showSkillPicker = false">
        <div class="skill-picker-modal">
          <div class="skill-picker-header">
            <h4>选择本群聊启用的技能</h4>
            <button class="close-btn" @click="showSkillPicker = false">×</button>
          </div>
          <div class="skill-picker-hint">勾选的技能将在本群聊中生效。未勾选的技能不会注入到智能体上下文中。</div>
          <div v-if="allSkills.length === 0" class="skill-picker-empty">暂无技能。请先在智能体详情中创建技能。</div>
          <div v-else class="skill-picker-list">
            <div v-for="s in allSkills" :key="s.id" class="skill-picker-item" @click="toggleSkill(s)">
              <input type="checkbox" :checked="isSkillEnabled(s.id)" @click.stop="toggleSkill(s)">
              <div class="skill-picker-info">
                <span class="skill-picker-name">{{ s.name }}</span>
                <span class="skill-picker-desc">{{ s.description || '无描述' }}</span>
                <span v-if="s.agent_name" class="skill-picker-origin">来自: {{ s.agent_name }}</span>
              </div>
            </div>
          </div>
          <div class="skill-picker-footer">
            <button class="btn-sm" @click="clearRoomSkills">清除全部（使用默认）</button>
            <button class="btn-sm primary" @click="showSkillPicker = false">完成</button>
          </div>
        </div>
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

    <!-- Workflow Management -->
    <div class="info-section">
      <div class="section-head">
        <h4>🛠 工作流</h4>
        <button class="btn-sm" @click="openCreateWorkflow">创建工作流</button>
      </div>
      <div v-if="workflows.length === 0" class="hint-box">
        <p>暂无工作流。创建一个多步骤流程来自动化协作。</p>
      </div>
      <div v-else class="workflow-list">
        <div v-for="wf in workflows" :key="wf.id" class="workflow-row">
          <div class="workflow-info clickable" @click="openEditWorkflow(wf)">
            <div class="workflow-name">{{ wf.name }}</div>
            <div class="workflow-meta">
              {{ triggerLabel(wf.trigger_type) }}
              <span v-if="wf.trigger_type === 'schedule'" class="schedule-desc">· {{ scheduleDescription(wf) }}</span>
              · {{ stepCount(wf) }} 步
            </div>
          </div>
          <button class="icon-btn add" @click="runWorkflow(wf)" title="运行">▶</button>
          <button class="icon-btn edit" @click="openEditWorkflow(wf)" title="编辑">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn history" @click="toggleHistory(wf)" title="历史">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </button>
          <button class="icon-btn danger" @click="deleteWorkflow(wf)" title="删除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <!-- History dropdown -->
      <div v-if="historyWorkflowId" class="history-dropdown">
        <div class="history-header">
          <span>运行历史</span>
          <button class="history-close" @click="historyWorkflowId = null">×</button>
        </div>
        <div v-if="historyRuns.length === 0" class="history-empty">暂无运行记录</div>
        <div v-else class="history-list">
          <div v-for="run in historyRuns" :key="run.id" class="history-item">
            <span class="history-status">{{ runStatusIcon(run.status) }}</span>
            <span class="history-time">{{ formatTime(run.started_at) }}</span>
            <span class="history-duration">{{ runDuration(run) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Workflow Editor Modal -->
    <WorkflowEditor
      v-if="showWorkflowEditor"
      :room="room"
      :workflow="editingWorkflow"
      @close="showWorkflowEditor = false"
      @saved="onWorkflowSaved"
    />

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
      <button class="btn btn-danger" @click="deleteRoom" style="width:100%">删除群聊</button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { api, store, getAgentColor, getAgentIcon, loadConversations } from '../store.js'
import WorkflowEditor from './WorkflowEditor.vue'

const props = defineProps({ room: Object })
const emit = defineEmits(['close', 'changed', 'deleted'])

const members = ref([])
const saving = ref(false)
const lastSavedTag = ref('')
const workflows = ref([])
const showWorkflowEditor = ref(false)
const editingWorkflow = ref(null)
const historyWorkflowId = ref(null)
const historyRuns = ref([])
const roomSkills = ref([])
const allSkills = ref([])
const showSkillPicker = ref(false)
const form = reactive({
  name: props.room.name || '',
  description: props.room.description || '',
})
const roomSettings = reactive({
  max_chain_depth: 5,
  context_messages_limit: 0,
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
        if (s.max_chain_depth !== undefined) roomSettings.max_chain_depth = s.max_chain_depth
        if (s.context_messages_limit !== undefined) roomSettings.context_messages_limit = s.context_messages_limit
      } catch {}
    }
  }
}

async function loadRoomSkills() {
  const data = await api('GET', `/admin/rooms/${props.room.id}/skills`)
  roomSkills.value = data.result || []
}

async function loadAllSkills() {
  const data = await api('GET', '/admin/skills')
  allSkills.value = data.result || []
}

function isSkillEnabled(skillId) {
  return roomSkills.value.some(s => s.id === skillId)
}

async function toggleSkill(skill) {
  if (isSkillEnabled(skill.id)) {
    const data = await api('DELETE', `/admin/rooms/${props.room.id}/skills/${skill.id}`)
    roomSkills.value = data.result || []
  } else {
    const data = await api('POST', `/admin/rooms/${props.room.id}/skills/${skill.id}`)
    roomSkills.value = data.result || []
  }
}

async function removeRoomSkill(skillId) {
  const data = await api('DELETE', `/admin/rooms/${props.room.id}/skills/${skillId}`)
  roomSkills.value = data.result || []
}

async function clearRoomSkills() {
  const data = await api('PUT', `/admin/rooms/${props.room.id}/skills`, { skill_ids: [] })
  roomSkills.value = data.result || []
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
  const chainVal = Math.max(0, Math.min(50, parseInt(roomSettings.max_chain_depth) || 0))
  roomSettings.max_chain_depth = chainVal
  const ctxVal = Math.max(0, Math.min(200, parseInt(roomSettings.context_messages_limit) || 0))
  roomSettings.context_messages_limit = ctxVal
  await api('PUT', `/admin/rooms/${props.room.id}`, {
    settings_json: { max_chain_depth: chainVal, context_messages_limit: ctxVal }
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

async function deleteRoom() {
  if (!confirm(`确定删除群聊「${form.name}」？所有消息和成员关系将被永久删除。`)) return
  const res = await api('DELETE', `/admin/rooms/${props.room.id}`)
  if (res && (res.ok || res.ok === undefined)) {
    await loadConversations()
    emit('deleted')
  }
}

// === Workflow methods ===
async function loadWorkflows() {
  const data = await api('GET', `/admin/rooms/${props.room.id}/workflows`)
  workflows.value = data.result || []
}

function triggerLabel(type) {
  const labels = { manual: '手动', schedule: '定时', keyword: '关键词' }
  return labels[type] || type
}

function scheduleDescription(wf) {
  try {
    const config = typeof wf.trigger_config === 'string'
      ? JSON.parse(wf.trigger_config || '{}')
      : (wf.trigger_config || {})
    if (config.interval_hours) return `每${config.interval_hours}小时`
    if (config.daily_time) return `每天 ${config.daily_time}`
    if (config.weekly_day !== undefined) {
      const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
      return `每${days[config.weekly_day]} ${config.weekly_time || ''}`
    }
  } catch {}
  return ''
}

function stepCount(wf) {
  try {
    const steps = typeof wf.steps_json === 'string' ? JSON.parse(wf.steps_json) : wf.steps_json
    return Array.isArray(steps) ? steps.length : 0
  } catch { return 0 }
}

async function runWorkflow(wf) {
  const res = await api('POST', `/admin/workflows/${wf.id}/run`)
  if (res.ok) {
    emit('changed')
  }
}

function openCreateWorkflow() {
  editingWorkflow.value = null
  showWorkflowEditor.value = true
}

function openEditWorkflow(wf) {
  editingWorkflow.value = wf
  showWorkflowEditor.value = true
}

async function deleteWorkflow(wf) {
  if (!confirm(`确定删除工作流「${wf.name}」？`)) return
  await api('DELETE', `/admin/workflows/${wf.id}`)
  await loadWorkflows()
}

async function onWorkflowSaved() {
  showWorkflowEditor.value = false
  editingWorkflow.value = null
  await loadWorkflows()
}

// === History methods ===
async function toggleHistory(wf) {
  if (historyWorkflowId.value === wf.id) {
    historyWorkflowId.value = null
    return
  }
  historyWorkflowId.value = wf.id
  const data = await api('GET', `/admin/workflows/${wf.id}/runs`)
  historyRuns.value = (data.result || []).slice(0, 20)
}

function runStatusIcon(status) {
  if (status === 'completed') return '✅'
  if (status === 'failed' || status === 'cancelled') return '❌'
  return '🔄'
}

function formatTime(ts) {
  if (!ts) return ''
  return ts.replace('T', ' ').slice(0, 16)
}

function runDuration(run) {
  if (!run.started_at || !run.completed_at) return run.status === 'running' ? '进行中' : ''
  const start = new Date(run.started_at).getTime()
  const end = new Date(run.completed_at).getTime()
  const diff = Math.floor((end - start) / 1000)
  if (diff < 60) return `${diff}秒`
  if (diff < 3600) return `${Math.floor(diff / 60)}分${diff % 60}秒`
  return `${Math.floor(diff / 3600)}时${Math.floor((diff % 3600) / 60)}分`
}

onMounted(() => { load(); loadWorkflows(); loadRoomSkills(); loadAllSkills() })
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
.icon-btn.edit:hover { color: var(--amber); border-color: var(--amber); background: var(--amber-soft); }
.icon-btn.history:hover { color: var(--text-2); border-color: var(--text-2); background: var(--surface2); }
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
.setting-hint {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 6px;
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

.btn-sm {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-sm:hover { background: var(--accent); color: white; }

.btn { padding: 8px 16px; border-radius: var(--radius); font-size: 14px; font-weight: 500; cursor: pointer; border: none; }
.btn-danger { background: var(--danger-soft); color: var(--danger); border: 1px solid var(--danger); }
.btn-danger:hover { background: var(--danger); color: white; }

.workflow-list { }
.workflow-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 6px;
  background: var(--surface);
}
.workflow-row:hover { background: var(--surface2); }
.workflow-info { flex: 1; min-width: 0; cursor: pointer; }
.workflow-info:hover .workflow-name { color: var(--accent); }
.workflow-name { font-size: 14px; font-weight: 600; color: var(--text); transition: color 0.15s ease; }
.workflow-meta { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
.schedule-desc { color: var(--amber); }

/* History dropdown */
.history-dropdown {
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.history-close {
  background: none;
  border: none;
  font-size: 16px;
  color: var(--text-dim);
  cursor: pointer;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
}
.history-close:hover { background: var(--surface2); color: var(--text); }
.history-empty {
  padding: 12px;
  font-size: 13px;
  color: var(--text-dim);
  text-align: center;
}
.history-list {
  max-height: 200px;
  overflow-y: auto;
}
.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
}
.history-item:last-child { border-bottom: none; }
.history-status { font-size: 14px; }
.history-time { flex: 1; color: var(--text-2); }
.history-duration { color: var(--text-dim); font-size: 12px; }

/* Room Skills */
.skill-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.skill-chip {
  display: flex; align-items: center; gap: 4px;
  background: var(--bg-2); border: 1px solid var(--border); border-radius: 14px;
  padding: 4px 10px; font-size: 12px;
}
.skill-chip-name { font-weight: 500; color: var(--text); }
.skill-chip-from { color: var(--text-dim); font-size: 11px; }
.skill-chip-remove {
  background: none; border: none; color: var(--text-dim); cursor: pointer;
  font-size: 14px; line-height: 1; padding: 0 2px; margin-left: 2px;
}
.skill-chip-remove:hover { color: var(--danger); }
.hint-sub { font-size: 12px; color: var(--text-dim); margin-top: 4px; }

.skill-picker-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000;
  display: flex; align-items: center; justify-content: center;
}
.skill-picker-modal {
  background: var(--bg); border-radius: 12px; width: 90%; max-width: 480px;
  max-height: 70vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.skill-picker-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border);
}
.skill-picker-header h4 { margin: 0; font-size: 15px; }
.skill-picker-hint { padding: 10px 20px; font-size: 12px; color: var(--text-dim); border-bottom: 1px solid var(--border); }
.skill-picker-empty { padding: 30px 20px; text-align: center; color: var(--text-dim); }
.skill-picker-list { overflow-y: auto; flex: 1; padding: 8px 0; }
.skill-picker-item {
  display: flex; align-items: flex-start; gap: 10px; padding: 10px 20px; cursor: pointer;
}
.skill-picker-item:hover { background: var(--bg-2); }
.skill-picker-item input[type="checkbox"] { margin-top: 3px; accent-color: var(--accent); }
.skill-picker-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.skill-picker-name { font-weight: 500; font-size: 13px; color: var(--text); }
.skill-picker-desc { font-size: 12px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skill-picker-origin { font-size: 11px; color: var(--accent); }
.skill-picker-footer {
  display: flex; justify-content: space-between; padding: 12px 20px;
  border-top: 1px solid var(--border);
}
.close-btn { background: none; border: none; font-size: 20px; cursor: pointer; color: var(--text-dim); }
.close-btn:hover { color: var(--text); }
</style>
