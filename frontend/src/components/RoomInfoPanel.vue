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

    <!-- Members (right below header, like WeChat/QQ) -->
    <div class="info-section members-section">
      <div class="member-grid">
        <div v-for="m in members" :key="m.id" class="member-cell">
          <div class="member-avatar" :style="{ background: getAgentColor(agentColorIdx(m.id)) }">
            <span v-html="getAgentIcon(agentColorIdx(m.id))"></span>
          </div>
          <div class="member-cell-name">{{ m.name }}</div>
          <button v-if="m.id !== 'user'" class="member-remove-btn" @click="removeMember(m)" title="移出群聊">×</button>
        </div>
        <div v-if="available.length" class="member-cell add-cell" @click="showMemberPicker = true">
          <div class="member-avatar add-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </div>
          <div class="member-cell-name">添加</div>
        </div>
      </div>

      <!-- Member picker modal -->
      <div v-if="showMemberPicker" class="skill-picker-overlay" @click.self="showMemberPicker = false">
        <div class="skill-picker-modal">
          <div class="skill-picker-header">
            <h4>添加智能体到群聊</h4>
            <button class="close-btn" @click="showMemberPicker = false">×</button>
          </div>
          <div v-if="available.length === 0" class="skill-picker-empty">没有可添加的智能体了</div>
          <div v-else class="skill-picker-list">
            <div v-for="a in available" :key="a.id" class="skill-picker-item" @click="addMember(a)">
              <div class="member-avatar small" :style="{ background: getAgentColor(agentColorIdx(a.id)) }">
                <span v-html="getAgentIcon(agentColorIdx(a.id))"></span>
              </div>
              <div class="skill-picker-info">
                <span class="skill-picker-name">{{ a.name }}</span>
                <span class="skill-picker-desc">{{ a.description || '通用智能体' }}</span>
              </div>
              <button class="icon-btn add">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
              </button>
            </div>
          </div>
          <div class="skill-picker-footer">
            <span></span>
            <button class="btn-sm primary" @click="showMemberPicker = false">完成</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Room guide -->
    <div class="info-section">
      <h4>群聊目标与协作规则</h4>
      <textarea
        v-model="form.description"
        @blur="saveField()"
        placeholder="描述这个群聊要完成什么、各智能体如何分工、完成后应该 @谁 接手。"
        rows="6"
      ></textarea>
        <div class="setting-hint">这段内容会直接进入所有智能体的系统提示；下方交接规则也会一并注入。</div>
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

      <div class="workspace-card">
        <div class="workspace-title-row">
          <div>
            <div class="workspace-title">共享工作空间</div>
            <div class="workspace-subtitle">本群所有智能体默认在同一个项目目录读写、运行命令和保存产物</div>
          </div>
          <span class="workspace-mode">{{ roomWorkspaceModeLabel }}</span>
        </div>
        <div class="workspace-path-row">
          <code>{{ roomWorkspacePath || '加载中...' }}</code>
          <button class="btn-sm" @click="copyWorkspacePath">复制</button>
        </div>
        <label class="setting-label workspace-label">绑定本机目录（可选）</label>
        <div class="workspace-bind-row">
          <input
            class="setting-input workspace-input"
            v-model.trim="roomSettings.workspace_path"
            @change="saveSettings"
            placeholder="留空使用默认 /app/data/workspaces/room-xxx"
          >
          <button v-if="roomSettings.workspace_path" class="btn-sm" @click="clearWorkspaceBinding">使用默认</button>
        </div>
        <div class="setting-hint">绑定目录必须是服务器上的绝对路径，例如 /root/hermes-hub。智能体 profile 仍独立保存记忆/技能。</div>
      </div>
    </div>

    <!-- Collaboration Guide -->
    <div class="info-section">
      <div class="section-head">
        <h4>交接规则</h4>
        <button v-if="!showGuideEditor" class="btn-sm" @click="showGuideEditor = true">编辑</button>
      </div>
      <div v-if="!showGuideEditor && !roomSettings.collaboration_guide" class="hint-box">
        <p>未配置额外交接规则。建议优先写在上方“群聊目标与协作规则”。</p>
        <p class="hint-sub">这里保留给硬性流程，例如开发完成后必须 @程序测试员。</p>
      </div>
      <div v-if="!showGuideEditor && roomSettings.collaboration_guide" class="guide-preview-text" @click="showGuideEditor = true">
        <pre class="guide-text-display">{{ roomSettings.collaboration_guide }}</pre>
      </div>
      <div v-if="showGuideEditor" class="guide-editor">
        <div class="guide-editor-hint">可写硬性交接流程。保存后也会同步注入智能体提示。</div>
        <textarea
          class="guide-textarea"
          v-model="guideText"
          placeholder="例如：&#10;开发完成后必须 @程序测试员 复测。&#10;测试发现问题后必须 @程序开发 修复。&#10;所有阻塞问题直接 @用户 确认。"
          rows="10"
        ></textarea>
        <div class="guide-editor-actions">
          <button class="btn-sm" @click="showGuideEditor = false; guideText = roomSettings.collaboration_guide">取消</button>
          <button class="btn-sm primary" @click="saveGuide">保存</button>
        </div>
      </div>
    </div>

    <div class="info-section">
      <div class="section-head">
        <h4>自动交接</h4>
        <button class="btn-sm" @click="addHandoffRule">新增</button>
      </div>
      <div v-if="!roomSettings.handoff_rules.length" class="hint-box">
        <p>未配置自动交接。配置后系统会在回复完成后自动触发下一个智能体。</p>
      </div>
      <div v-for="(rule, idx) in roomSettings.handoff_rules" :key="idx" class="handoff-rule-row">
        <input class="setting-input" v-model.trim="rule.source" @change="saveSettings" placeholder="来源智能体，如 程序开发">
        <input class="setting-input" v-model.trim="rule.target" @change="saveSettings" placeholder="目标智能体，如 程序测试员">
        <input class="setting-input" v-model.trim="rule.keywordsText" @change="syncHandoffKeywords(rule); saveSettings()" placeholder="触发关键词，逗号分隔，如 完成,已修复">
        <button class="btn-sm danger" @click="removeHandoffRule(idx)">删除</button>
      </div>
      <div class="setting-hint">如果不填关键词，则该来源智能体每次完成回复都会交接给目标智能体。</div>
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
const showMemberPicker = ref(false)
const showGuideEditor = ref(false)
const guideText = ref('')
const form = reactive({
  name: props.room.name || '',
  description: props.room.description || '',
})
const roomSettings = reactive({
  max_chain_depth: 5,
  context_messages_limit: 0,
  collaboration_guide: '',
  handoff_rules: [],
  workspace_path: '',
})
const roomWorkspacePath = ref('')
const roomWorkspaceMode = ref('default')
const roomWorkspaceModeLabel = computed(() => roomWorkspaceMode.value === 'custom' ? '绑定目录' : '默认目录')

async function load() {
  const data = await api('GET', '/admin/rooms')
  const room = (data.result || []).find(r => r.id === props.room.id)
  if (room) {
    members.value = room.members || []
    roomWorkspacePath.value = room.workspace_path || ''
    roomWorkspaceMode.value = room.workspace_mode || 'default'
    if (!form.name) form.name = room.name || ''
    if (!form.description) form.description = room.description || ''
    // Load settings from room's settings_json
    if (room.settings_json) {
      try {
        const s = typeof room.settings_json === 'string' ? JSON.parse(room.settings_json) : room.settings_json
        if (s.max_chain_depth !== undefined) roomSettings.max_chain_depth = s.max_chain_depth
        if (s.context_messages_limit !== undefined) roomSettings.context_messages_limit = s.context_messages_limit
        roomSettings.workspace_path = s.workspace_path || ''
        if (s.collaboration_guide !== undefined) {
          roomSettings.collaboration_guide = s.collaboration_guide
          guideText.value = s.collaboration_guide || ''
        }
        if (s.handoff_rules !== undefined) {
          roomSettings.handoff_rules = normalizeHandoffRules(s.handoff_rules)
        }
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
async function saveField(immediate = false) {
  immediate = immediate === true
  if (saveTimer) clearTimeout(saveTimer)
  const run = async () => {
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
  }
  if (immediate) await run()
  else saveTimer = setTimeout(run, 280)
}

async function saveSettings() {
  const chainVal = Math.max(0, Math.min(50, parseInt(roomSettings.max_chain_depth) || 0))
  roomSettings.max_chain_depth = chainVal
  const ctxVal = Math.max(0, Math.min(200, parseInt(roomSettings.context_messages_limit) || 0))
  roomSettings.context_messages_limit = ctxVal
  roomSettings.handoff_rules.forEach(syncHandoffKeywords)
  await api('PUT', `/admin/rooms/${props.room.id}`, {
    settings_json: {
      max_chain_depth: chainVal,
      context_messages_limit: ctxVal,
      collaboration_guide: roomSettings.collaboration_guide,
      handoff_rules: (roomSettings.handoff_rules || []).map(({ keywordsText, ...rule }) => rule),
      workspace_path: roomSettings.workspace_path || '',
    }
  })
  await load()
}

function normalizeHandoffRules(rules) {
  if (!Array.isArray(rules)) return []
  return rules.map(r => {
    const keywords = Array.isArray(r.keywords) ? r.keywords : []
    return { ...r, keywords, keywordsText: r.keywordsText || keywords.join(', ') }
  })
}

function syncHandoffKeywords(rule) {
  rule.keywords = String(rule.keywordsText || '').split(/[,，]/).map(s => s.trim()).filter(Boolean)
}

function addHandoffRule() {
  roomSettings.handoff_rules.push({ source: '', target: '', keywords: [], keywordsText: '', trigger: '完成当前职责后' })
  saveSettings()
}

function removeHandoffRule(idx) {
  roomSettings.handoff_rules.splice(idx, 1)
  saveSettings()
}

async function copyWorkspacePath() {
  if (!roomWorkspacePath.value) return
  try {
    await navigator.clipboard.writeText(roomWorkspacePath.value)
    lastSavedTag.value = '路径已复制'
    setTimeout(() => { lastSavedTag.value = '' }, 1600)
  } catch {
    window.prompt('复制工作空间路径', roomWorkspacePath.value)
  }
}

async function clearWorkspaceBinding() {
  roomSettings.workspace_path = ''
  await saveSettings()
}

async function addMember(a) {
  const res = await api('POST', `/admin/rooms/${props.room.id}/members`, { agent_id: a.id })
  if (res.ok || res.ok === undefined) {
    await load()
    await loadConversations()
    emit('changed')
  }
}

// === Collaboration Guide ===
async function saveGuide() {
  roomSettings.collaboration_guide = guideText.value.trim()
  await saveSettings()
  showGuideEditor.value = false
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

/* WeChat-style member grid */
.members-section {
  margin-bottom: 12px;
}
.member-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 60px);
  gap: 12px;
  justify-content: start;
}
.member-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  position: relative;
}
.member-cell-name {
  font-size: 11px;
  color: var(--text-dim);
  text-align: center;
  max-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.member-remove-btn {
  position: absolute;
  top: -4px;
  right: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--danger, #e53e3e);
  color: white;
  border: none;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
}
.member-cell:hover .member-remove-btn {
  display: flex;
}
.add-cell {
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s;
}
.add-cell:hover { opacity: 1; }
.add-avatar {
  border: 2px dashed var(--border-strong);
  background: transparent !important;
}
.add-avatar svg { width: 18px; height: 18px; color: var(--text-dim); }

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

.workspace-card {
  margin-top: 14px;
  padding: 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.workspace-title-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 10px;
}
.workspace-title { font-size: 14px; font-weight: 700; color: var(--text); }
.workspace-subtitle { font-size: 12px; color: var(--text-dim); line-height: 1.5; margin-top: 2px; }
.workspace-mode {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--amber);
  background: var(--amber-soft);
  border: 1px solid rgba(217, 119, 6, 0.24);
  border-radius: 999px;
  padding: 3px 9px;
  font-weight: 700;
}
.workspace-path-row,
.workspace-bind-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.workspace-path-row code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--surface2);
  color: var(--text-2);
  border: 1px solid var(--border);
  font-size: 12px;
}
.workspace-label { display: block; margin: 12px 0 6px; }
.workspace-input {
  flex: 1;
  width: auto;
  text-align: left;
}

.handoff-rule-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1.4fr auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
@media (max-width: 720px) {
  .handoff-rule-row { grid-template-columns: 1fr; }
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

/* Collaboration Guide */
.guide-preview {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px; background: var(--bg-2); border-radius: 8px; border: 1px solid var(--border);
}
.guide-preview-text {
  cursor: pointer;
  padding: 10px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: border-color 0.15s;
}
.guide-preview-text:hover { border-color: var(--accent); }
.guide-text-display {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: inherit;
}

.guide-editor { display: flex; flex-direction: column; gap: 8px; }
.guide-editor-hint { font-size: 12px; color: var(--text-dim); margin-bottom: 4px; }
.guide-textarea {
  width: 100%;
  min-height: 180px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px;
  font-family: inherit;
  background: var(--surface);
  color: var(--text);
  resize: vertical;
  line-height: 1.6;
}
.guide-textarea:focus { outline: none; border-color: var(--accent); box-shadow: var(--shadow-glow); }
.guide-textarea::placeholder { color: var(--text-dim); opacity: 0.7; }
.guide-editor-actions {
  display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;
}

/* Member avatar small variant for picker */
.member-avatar.small {
  width: 28px; height: 28px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}
.member-avatar.small span { width: 16px; height: 16px; }
.member-avatar.small :deep(svg) { width: 16px; height: 16px; }
</style>
