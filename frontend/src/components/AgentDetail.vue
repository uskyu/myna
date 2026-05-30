<template>
  <div class="agent-detail active">
    <div class="chat-header">
      <button class="back-btn" @click="$emit('close')" aria-label="返回">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <span class="title">{{ form.name || agent.name }}</span>
      <button class="back-btn" style="margin-left:auto" @click="startDM" title="发消息">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </button>
    </div>
    <div class="agent-detail-content">
      <!-- Header card -->
      <div class="profile-head">
        <div class="avatar-large" :style="{ background: getAgentColor(idx) }">
          <span v-html="getAgentIcon(idx)"></span>
        </div>
        <div class="head-meta">
          <input class="head-name-input" v-model="form.name" @blur="saveField('name')" placeholder="智能体名称">
          <div class="status-row">
            <button type="button" class="toggle small" :class="{ on: form.status === 'online' }" @click="toggleStatus" aria-label="状态切换"></button>
            <span class="status-text">{{ form.status === 'online' ? '在线' : '离线' }}</span>
            <span v-if="saving" class="saving-tag">保存中...</span>
            <span v-else-if="lastSavedTag" class="saved-tag">{{ lastSavedTag }}</span>
          </div>
        </div>
      </div>

      <!-- Description / system prompt -->
      <div class="field-block">
        <label>描述 / 系统提示词</label>
        <textarea
          v-model="form.description"
          @blur="saveField('description')"
          placeholder="定义智能体的角色和行为..."
          rows="4"
        ></textarea>
      </div>

      <!-- Model picker -->
      <div class="field-block">
        <div class="field-head">
          <label>关联模型</label>
          <button class="link-btn" @click="showModels = true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            管理供应商
          </button>
        </div>
        <select v-model="form.model_config_id" @change="saveField('model_config_id')" class="model-select">
          <option value="">使用默认配置</option>
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }} — {{ m.model }}</option>
        </select>
        <div v-if="selectedModel" class="model-preview">
          <span class="model-preview-tag">{{ selectedModel.model }}</span>
          <span v-if="selectedModel.max_tokens" class="model-preview-meta">{{ formatCtx(selectedModel.max_tokens) }} ctx</span>
          <span class="model-preview-base">{{ selectedModel.base_url }}</span>
        </div>
      </div>

      <!-- Skills section -->
      <div class="profile-section">
        <div class="section-head">
          <h4>🛠 技能</h4>
          <button class="link-btn" @click="showSkillPicker = true">+ 装载技能</button>
        </div>
        <div v-if="skills.length === 0" class="hint">暂无技能，从技能库中选择装载</div>
        <div v-else class="skills-list">
          <div v-for="skill in skills" :key="skill.id" class="skill-item">
            <div class="skill-info">
              <span class="skill-name">{{ skill.name }}</span>
              <span class="skill-desc">{{ skill.description || '无描述' }}</span>
            </div>
            <div class="skill-actions">
              <button class="skill-action-btn" @click="editSkill(skill)" title="查看">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <button class="skill-action-btn danger" @click="removeSkill(skill)" title="卸载">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Knowledge base -->
      <div class="profile-section">
        <h4>📚 知识库</h4>
        <div class="hint">暂无知识库文件</div>
      </div>

      <!-- Execution & Self-improvement settings -->
      <div class="profile-section">
        <h4>🔐 权限与自我迭代</h4>
        <div class="field-block">
          <label>执行模式</label>
          <select v-model="form.execution_mode" @change="saveField('execution_mode')" class="model-select">
            <option value="auto">全自动 — 无安全限制，可接收密码直接操作</option>
            <option value="confirm">需确认 — 危险命令被阻止</option>
            <option value="readonly">只读 — 不能执行命令/写文件</option>
          </select>
          <div class="hint" style="margin-top:4px">
            {{ form.execution_mode === 'auto' ? '⚡ 完全信任，可执行任何操作' : form.execution_mode === 'confirm' ? '🛡️ 危险命令（rm -rf、reboot等）被拦截' : '👁️ 只能读取信息，不能修改' }}
          </div>
        </div>
        <div class="field-block" style="margin-top:12px">
          <div class="toggle-row">
            <label>自我迭代学习</label>
            <button type="button" class="toggle" :class="{ on: form.self_improve }" @click="form.self_improve = !form.self_improve; saveField('self_improve')" aria-label="自我迭代开关"></button>
          </div>
          <div class="hint">开启后，智能体在工具调用后自动复盘并提取经验保存为技能</div>
        </div>
        <div class="field-block" style="margin-top:12px">
          <label>工具策略</label>
          <div class="tool-policy-grid">
            <label v-for="tool in toolOptions" :key="tool.id" class="tool-policy-item">
              <input type="checkbox" :checked="isToolEnabled(tool.id)" @change="toggleTool(tool.id)">
              <span>{{ tool.label }}</span>
            </label>
          </div>
          <textarea
            v-model="form.tool_preference"
            @blur="saveField('tool_preference')"
            placeholder="工具偏好，例如：账号池管理优先使用 terminal + Selenium；不要使用 browser 工具。"
            rows="3"
          ></textarea>
          <div class="hint">禁用的工具不会暴露给 Hermes；偏好会注入系统提示。</div>
        </div>
        <div v-if="form.self_improve" class="field-block" style="margin-top:8px">
          <label>触发阈值（工具调用次数 ≥）</label>
          <input type="number" v-model.number="form.self_improve_threshold" @blur="saveField('self_improve_threshold')" min="1" max="20" class="threshold-input">
          <div class="hint">工具调用达到此次数后触发自动复盘（默认 2）</div>
        </div>
      </div>

      <!-- Hermes Engine Capabilities -->
      <div class="profile-section">
        <h4>🚀 Hermes 引擎能力</h4>
        <div class="hermes-caps-list">
          <div class="hermes-cap-row active">
            <span class="cap-icon">🔧</span>
            <span class="cap-name">工具调用</span>
            <span class="cap-desc">函数调用、结构化输出</span>
          </div>
          <div class="hermes-cap-row active">
            <span class="cap-icon">💾</span>
            <span class="cap-name">持久记忆</span>
            <span class="cap-desc">跨会话记忆存储</span>
          </div>
          <div class="hermes-cap-row active">
            <span class="cap-icon">📚</span>
            <span class="cap-name">技能学习</span>
            <span class="cap-desc">自动提取可复用流程</span>
          </div>
          <div class="hermes-cap-row active">
            <span class="cap-icon">🌐</span>
            <span class="cap-name">网页浏览</span>
            <span class="cap-desc">搜索、抓取、交互</span>
          </div>
          <div class="hermes-cap-row active">
            <span class="cap-icon">💻</span>
            <span class="cap-name">终端命令</span>
            <span class="cap-desc">Shell 执行、脚本运行</span>
          </div>
          <div class="hermes-cap-row active">
            <span class="cap-icon">📡</span>
            <span class="cap-name">HTTP 请求</span>
            <span class="cap-desc">API 调用、Webhook</span>
          </div>
          <div class="hermes-cap-row active">
            <span class="cap-icon">🤝</span>
            <span class="cap-name">多智能体协作</span>
            <span class="cap-desc">任务委派、并行执行</span>
          </div>
          <div class="hermes-cap-row active">
            <span class="cap-icon">⏰</span>
            <span class="cap-name">工作流调度</span>
            <span class="cap-desc">定时任务、事件触发</span>
          </div>
        </div>
        <div class="hint" style="margin-top:8px">由 Hermes Agent 引擎驱动，每个智能体拥有独立的记忆和技能空间</div>
      </div>

      <div v-if="agent.id !== '__system__'" style="margin-top:32px;padding-top:16px;border-top:1px solid var(--border)">
        <button class="btn btn-danger" @click="$emit('delete', agent.id)" style="width:100%">删除智能体</button>
      </div>
    </div>

    <ModelsModal v-if="showModels" @close="onModelsClose" @changed="onModelsChanged" />

    <!-- Skill Picker Modal (select from global library) -->
    <Teleport to="body">
      <div v-if="showSkillPicker" class="skill-modal-overlay" @click.self="showSkillPicker = false">
        <div class="skill-modal">
          <div class="skill-modal-header">
            <h4>从技能库装载</h4>
            <button class="wf-close" @click="showSkillPicker = false">×</button>
          </div>
          <div class="skill-modal-body">
            <div v-if="globalSkills.length === 0" class="hint" style="padding:20px;text-align:center">
              技能库为空，请先在管理中心创建技能
            </div>
            <div v-else class="picker-list">
              <div v-for="skill in globalSkills" :key="skill.id" class="picker-item" :class="{ loaded: isSkillLoaded(skill.id) }">
                <div class="skill-info">
                  <span class="skill-name">{{ skill.name }}</span>
                  <span class="skill-desc">{{ skill.description || '无描述' }}</span>
                  <span v-if="skill.agent_name" class="skill-origin">来自: {{ skill.agent_name }}</span>
                </div>
                <button v-if="!isSkillLoaded(skill.id)" class="link-btn" @click="loadSkillFromLibrary(skill)">装载</button>
                <span v-else class="loaded-tag">已装载</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- View Skill Content Modal -->
    <Teleport to="body">
      <div v-if="editingSkill" class="skill-modal-overlay" @click.self="editingSkill = null">
        <div class="skill-modal">
          <div class="skill-modal-header">
            <h4>{{ editingSkill.name }}</h4>
            <button class="wf-close" @click="editingSkill = null">×</button>
          </div>
          <div class="skill-modal-body">
            <pre class="skill-content-view">{{ editingSkill.content || '(空)' }}</pre>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { api, getAgentColor, getAgentIcon, store, loadConversations } from '../store.js'
import ModelsModal from './ModelsModal.vue'

const props = defineProps({ agent: Object })
const emit = defineEmits(['close', 'delete'])

const models = ref([])
const showModels = ref(false)
const saving = ref(false)
const lastSavedTag = ref('')

// Skills state
const skills = ref([])
const showSkillPicker = ref(false)
const editingSkill = ref(null)
const globalSkills = ref([])

const form = reactive({
  name: props.agent.name,
  description: props.agent.description || '',
  model_config_id: props.agent.model_config_id || '',
  status: props.agent.status || 'online',
  execution_mode: props.agent.execution_mode || 'auto',
  self_improve: props.agent.self_improve !== undefined ? !!props.agent.self_improve : false,
  self_improve_threshold: props.agent.self_improve_threshold || 2,
  disabled_toolsets: parseToolsConfig(props.agent.tools_config).disabled_toolsets || [],
  tool_preference: parseToolsConfig(props.agent.tools_config).preferred_tools || '',
})

const toolOptions = [
  { id: 'terminal', label: '终端' },
  { id: 'file', label: '文件' },
  { id: 'http', label: 'HTTP' },
  { id: 'browser', label: '浏览器' },
  { id: 'memory', label: '记忆' },
  { id: 'skills', label: '技能' },
]

function parseToolsConfig(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) || {} } catch { return {} }
}

function isToolEnabled(id) {
  return !form.disabled_toolsets.includes(id)
}

function toggleTool(id) {
  if (form.disabled_toolsets.includes(id)) {
    form.disabled_toolsets = form.disabled_toolsets.filter(t => t !== id)
  } else {
    form.disabled_toolsets = [...form.disabled_toolsets, id]
  }
  saveField('tools_config')
}

const idx = computed(() => store.agents.findIndex(a => a.id === props.agent.id))

const selectedModel = computed(() => models.value.find(m => m.id === form.model_config_id))

function formatCtx(n) {
  if (!n) return ''
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k'
  return String(n)
}

async function persist() {
  saving.value = true
  lastSavedTag.value = ''
  try {
    await api('PUT', `/admin/agents/${props.agent.id}`, {
      name: form.name,
      description: form.description,
      model_config_id: form.model_config_id || null,
      status: form.status,
      execution_mode: form.execution_mode,
      self_improve: form.self_improve,
      self_improve_threshold: form.self_improve_threshold,
      tools_config: {
        disabled_toolsets: form.disabled_toolsets,
        preferred_tools: form.tool_preference,
      },
    })
    Object.assign(props.agent, {
      name: form.name,
      description: form.description,
      model_config_id: form.model_config_id || null,
      status: form.status,
      execution_mode: form.execution_mode,
      self_improve: form.self_improve,
      self_improve_threshold: form.self_improve_threshold,
      tools_config: JSON.stringify({ disabled_toolsets: form.disabled_toolsets, preferred_tools: form.tool_preference }),
    })
    // refresh agents store entry
    const idxStore = store.agents.findIndex(a => a.id === props.agent.id)
    if (idxStore >= 0) Object.assign(store.agents[idxStore], props.agent)
    lastSavedTag.value = '已保存'
    setTimeout(() => { lastSavedTag.value = '' }, 1600)
  } catch(e) {
    lastSavedTag.value = '保存失败'
  } finally {
    saving.value = false
  }
}

let saveTimer = null
function debouncedPersist() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persist, 250)
}

async function saveField(field) {
  // Normalize empties
  if (field === 'name' && !form.name.trim()) {
    form.name = props.agent.name
    return
  }
  debouncedPersist()
}

async function toggleStatus() {
  form.status = form.status === 'online' ? 'offline' : 'online'
  debouncedPersist()
}

async function startDM() {
  const data = await api('POST', `/admin/dm/${props.agent.id}`)
  if (data.ok) {
    await loadConversations()
    emit('close')
    window.dispatchEvent(new CustomEvent('open-dm', { detail: { agentId: props.agent.id, roomId: data.result?.room_id } }))
  }
}

// === Skills ===
async function loadSkills() {
  const data = await api('GET', `/admin/agents/${props.agent.id}/skills`)
  skills.value = data.result || []
}

async function loadGlobalSkills() {
  const data = await api('GET', '/admin/skills')
  globalSkills.value = data.result || []
}

function isSkillLoaded(skillId) {
  return skills.value.some(s => s.id === skillId || s.name === globalSkills.value.find(g => g.id === skillId)?.name)
}

function editSkill(skill) {
  editingSkill.value = skill
}

async function loadSkillFromLibrary(skill) {
  // Copy skill to this agent
  await api('POST', `/admin/skills/${skill.id}/copy`, { target_agent_id: props.agent.id })
  loadSkills()
  loadGlobalSkills()
}

async function removeSkill(skill) {
  if (!confirm(`确定卸载技能「${skill.name}」？`)) return
  await api('DELETE', `/admin/skills/${skill.id}`)
  loadSkills()
}

async function loadModels() {
  const data = await api('GET', '/admin/models')
  models.value = data.result || []
}

function onModelsClose() {
  showModels.value = false
  loadModels()
}

async function onModelsChanged() {
  await loadModels()
  showModels.value = false
}

onMounted(() => {
  loadModels()
  loadSkills()
  loadGlobalSkills()
})
</script>

<style scoped>
.profile-head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 4px 22px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 18px;
}
.head-meta { flex: 1; min-width: 0; }
.head-name-input {
  width: 100%;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  margin: 0 0 6px -8px;
  transition: all 0.15s ease;
}
.head-name-input:hover { border-color: var(--border); background: var(--surface2); }
.head-name-input:focus { outline: none; border-color: var(--accent); background: var(--surface); }

.status-row { display: flex; align-items: center; gap: 8px; padding-left: 0; }
.status-text { font-size: 13px; color: var(--text-dim); }
.saving-tag, .saved-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
  margin-left: 6px;
}
.saving-tag { color: var(--text-dim); background: var(--surface2); }

.toggle.small { width: 36px; height: 20px; }

.field-block { margin-bottom: 18px; }
.field-block label {
  display: block;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dim);
  font-weight: 700;
  margin-bottom: 8px;
}
.field-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
}
.field-head label { margin: 0; }
.link-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-2);
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
  text-transform: none; letter-spacing: 0;
  transition: all 0.15s ease;
}
.link-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }

.field-block textarea {
  width: 100%;
  min-height: 96px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  font-family: inherit;
  background: var(--surface);
  color: var(--text);
  resize: vertical;
  line-height: 1.55;
}
.field-block textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--shadow-glow);
}

.model-select {
  width: 100%;
  padding: 11px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  background: var(--surface);
  color: var(--text);
}
.model-select:focus { outline: none; border-color: var(--accent); box-shadow: var(--shadow-glow); }

.model-preview {
  margin-top: 8px;
  padding: 10px 12px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.model-preview-tag {
  font-family: var(--font-mono);
  color: var(--accent);
  font-weight: 600;
}
.model-preview-meta {
  font-family: var(--font-mono);
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 1px 8px;
  border-radius: 999px;
  color: var(--text-dim);
}
.model-preview-base {
  font-family: var(--font-mono);
  color: var(--text-dim);
  margin-left: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

/* Section head with action */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.section-head h4 { margin: 0; }

/* Skills list */
.skills-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}
.skill-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  transition: border-color 0.15s ease;
}
.skill-item:hover { border-color: var(--accent); }
.skill-info { flex: 1; min-width: 0; }
.skill-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  display: block;
}
.skill-desc {
  font-size: 11px;
  color: var(--text-dim);
  display: block;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.skill-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 8px;
}
.skill-action-btn {
  width: 28px; height: 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface2);
  color: var(--text-dim);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s ease;
}
.skill-action-btn:hover { border-color: var(--accent); color: var(--accent); }
.skill-action-btn.danger:hover { border-color: var(--danger); color: var(--danger); }

/* Skill picker list */
.picker-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.picker-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  transition: border-color 0.15s ease;
}
.picker-item:hover { border-color: var(--accent); }
.picker-item.loaded { opacity: 0.6; }
.skill-origin {
  font-size: 10px;
  color: var(--text-dim);
  display: block;
  margin-top: 2px;
}
.loaded-tag {
  font-size: 11px;
  color: var(--text-dim);
  background: var(--surface2);
  padding: 3px 8px;
  border-radius: 999px;
}

/* Skill content view */
.skill-content-view {
  font-size: 13px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  color: var(--text);
}

.tool-policy-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}
.tool-policy-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: 13px;
  color: var(--text-2);
}

/* Skill modal */
.skill-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 20px;
}
.skill-modal {
  background: var(--bg);
  border-radius: var(--radius-lg, 16px);
  width: 100%;
  max-width: 560px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg, 0 20px 60px rgba(0,0,0,0.3));
}
.skill-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
}
.skill-modal-header h4 { margin: 0; font-size: 15px; font-weight: 700; }
.skill-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
.skill-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
}
.skill-content-textarea {
  width: 100%;
  min-height: 200px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  background: var(--surface);
  color: var(--text);
  resize: vertical;
  line-height: 1.5;
}
.skill-content-textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--shadow-glow);
}

.wf-field { margin-bottom: 14px; }
.wf-field label {
  display: block;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.wf-field input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  font-family: inherit;
  background: var(--surface);
  color: var(--text);
}
.wf-field input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--shadow-glow);
}
.wf-close {
  background: none; border: none; font-size: 22px; color: var(--text-dim); cursor: pointer;
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
}
.wf-close:hover { background: var(--surface2); color: var(--text); }
.btn-cancel {
  padding: 8px 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-2);
  font-size: 14px;
  cursor: pointer;
}
.btn-cancel:hover { background: var(--surface2); }
.btn-save {
  padding: 8px 18px;
  border: none;
  border-radius: var(--radius);
  background: var(--accent);
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-save:not(:disabled):hover { opacity: 0.9; }

/* Toggle row for settings */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.toggle-row label {
  margin-bottom: 0;
}
.threshold-input {
  width: 80px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  background: var(--surface);
  color: var(--text);
  text-align: center;
}
.threshold-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--shadow-glow);
}

/* Hermes capabilities list */
.hermes-caps-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.hermes-cap-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  font-size: 13px;
  opacity: 0.4;
  border-bottom: 1px solid var(--border);
}
.hermes-cap-row:last-child {
  border-bottom: none;
}
.hermes-cap-row.active {
  opacity: 1;
  background: rgba(45, 106, 79, 0.03);
}
.hermes-cap-row .cap-icon {
  font-size: 15px;
  flex-shrink: 0;
  width: 22px;
  text-align: center;
}
.hermes-cap-row .cap-name {
  font-weight: 600;
  color: var(--text);
  min-width: 90px;
}
.hermes-cap-row .cap-desc {
  color: var(--text-dim);
  font-size: 12px;
  margin-left: auto;
}
</style>
