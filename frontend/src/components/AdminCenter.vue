<template>
  <div class="page admin-center">
    <div class="page-header">
      <h2>管理中心</h2>
    </div>

    <!-- Tab bar -->
    <div class="tab-bar">
      <div class="tab-item" :class="{ active: activeTab === 'config' }" @click="activeTab = 'config'">配置</div>
      <div class="tab-item" :class="{ active: activeTab === 'skills' }" @click="activeTab = 'skills'">技能库</div>
      <div class="tab-indicator" :style="{ transform: activeTab === 'skills' ? 'translateX(100%)' : 'translateX(0)' }"></div>
    </div>

    <!-- Tab content (scrollable) -->
    <div class="tab-content">

      <!-- Config tab -->
      <div v-show="activeTab === 'config'" class="tab-panel">
        <div class="admin-section config-panel">
          <div class="section-title-row">
            <h3>⚙ 智能体执行</h3>
          </div>
          <div class="config-items">
            <div class="config-item">
              <span class="config-label">工具调用显示</span>
              <div class="config-options">
                <label v-for="opt in toolDisplayOptions" :key="opt.value" class="radio-option" :class="{ active: chatSettings.toolCallDisplay === opt.value }">
                  <input type="radio" name="tool-display" :value="opt.value" :checked="chatSettings.toolCallDisplay === opt.value" @change="onToolDisplayChange(opt.value)">
                  <span>{{ opt.label }}</span>
                </label>
              </div>
            </div>
            <div class="config-item">
              <span class="config-label">最大执行轮数</span>
              <span class="config-desc">单次响应的最大 API 调用轮数，到达后自动停止</span>
              <div class="config-options">
                <label v-for="opt in roundOptions" :key="opt.value" class="radio-option" :class="{ active: hubSettings.agent_max_rounds === opt.value }">
                  <input type="radio" name="rounds" :value="opt.value" :checked="hubSettings.agent_max_rounds === opt.value" @change="onRoundsChange(opt.value)">
                  <span>{{ opt.label }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div class="admin-section config-panel">
          <div class="section-title-row">
            <h3>🧠 自主进化</h3>
            <div class="toggle" :class="{ on: hubSettings.self_improve_enabled === '1' }" @click="toggleSelfImprove"></div>
          </div>
          <div class="config-items" v-if="hubSettings.self_improve_enabled === '1'">
            <div class="config-item">
              <span class="config-label">触发阈值</span>
              <span class="config-desc">工具调用次数达到此值后触发学习分析</span>
              <div class="config-options">
                <label v-for="opt in thresholdOptions" :key="opt.value" class="radio-option" :class="{ active: hubSettings.self_improve_threshold === opt.value }">
                  <input type="radio" name="threshold" :value="opt.value" :checked="hubSettings.self_improve_threshold === opt.value" @change="onThresholdChange(opt.value)">
                  <span>{{ opt.label }}</span>
                </label>
              </div>
            </div>
            <div class="config-item">
              <span class="config-label">学习路径</span>
              <span class="config-desc">智能体学到的技能保存位置（未单独设置时使用此全局配置）</span>
              <div class="config-options">
                <label v-for="opt in learnPathOptions" :key="opt.value" class="radio-option" :class="{ active: hubSettings.self_improve_path === opt.value }">
                  <input type="radio" name="learn-path" :value="opt.value" :checked="hubSettings.self_improve_path === opt.value" @change="onLearnPathChange(opt.value)">
                  <span>{{ opt.label }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Skills tab -->
      <div v-show="activeTab === 'skills'" class="tab-panel">
        <div class="admin-section">
          <div class="section-title-row">
            <h3>🛠 全局技能库</h3>
            <span class="badge">{{ allSkills.length }}</span>
            <div class="section-actions">
              <button class="link-btn" @click="showCreateSkill = true">+ 创建</button>
              <button class="link-btn" @click="triggerUpload">📁 上传</button>
              <input ref="skillFileInput" type="file" accept=".md,.txt,.json,.yaml,.yml" style="display:none" @change="onSkillFileUpload" multiple />
            </div>
          </div>

          <div v-if="allSkills.length === 0" class="empty-state">
            <p>暂无技能，点击上方按钮创建或上传</p>
          </div>

          <div v-for="group in skillGroups" :key="group.agentId" class="skill-group">
            <div class="skill-group-header">
              <span class="skill-group-name">{{ group.agentName }}</span>
              <span class="skill-group-count">{{ group.skills.length }} 个技能</span>
            </div>
            <div class="skill-grid">
              <div v-for="skill in group.skills" :key="skill.id" class="skill-card">
                <div class="skill-card-head">
                  <span class="skill-card-name">{{ skill.name }}</span>
                  <span class="skill-card-type">{{ skill.file_type || 'text' }}</span>
                </div>
                <p class="skill-card-desc">{{ skill.description || '无描述' }}</p>
                <div class="skill-card-actions">
                  <button class="skill-card-btn" @click="viewSkill(skill)" title="查看">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  </button>
                  <button class="skill-card-btn" @click="copySkill(skill)" title="复制到其他智能体">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                  <button class="skill-card-btn" @click="downloadSkill(skill)" title="下载">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  </button>
                  <button class="skill-card-btn danger" @click="deleteSkill(skill)" title="删除">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Modals (unchanged) -->
    <Teleport to="body">
      <div v-if="viewingSkill" class="skill-view-overlay" @click.self="viewingSkill = null">
        <div class="skill-view-modal">
          <div class="skill-view-header">
            <h4>{{ viewingSkill.name }}</h4>
            <button class="close-btn" @click="viewingSkill = null">×</button>
          </div>
          <div class="skill-view-meta">
            <span>所属: {{ viewingSkill.agent_name || '未知' }}</span>
            <span>类型: {{ viewingSkill.file_type || 'text' }}</span>
          </div>
          <pre class="skill-view-content">{{ viewingSkill.content || '(空)' }}</pre>
        </div>
      </div>
    </Teleport>

    <!-- Copy skill modal -->
    <Teleport to="body">
      <div v-if="copyingSkill" class="skill-view-overlay" @click.self="copyingSkill = null">
        <div class="skill-copy-modal">
          <div class="skill-view-header">
            <h4>复制技能「{{ copyingSkill.name }}」到</h4>
            <button class="close-btn" @click="copyingSkill = null">×</button>
          </div>
          <div class="copy-agent-list">
            <div v-for="agent in agents" :key="agent.id"
                 class="copy-agent-item"
                 :class="{ disabled: agent.id === copyingSkill.agent_id }"
                 @click="doCopy(agent)">
              <span class="copy-agent-name">{{ agent.name }}</span>
              <span v-if="agent.id === copyingSkill.agent_id" class="copy-agent-tag">已拥有</span>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
    <!-- Create Skill Modal -->
    <Teleport to="body">
      <div v-if="showCreateSkill" class="skill-view-overlay" @click.self="showCreateSkill = false">
        <div class="skill-view-modal">
          <div class="skill-view-header">
            <h4>创建技能</h4>
            <button class="close-btn" @click="showCreateSkill = false">×</button>
          </div>
          <div class="create-skill-body">
            <div class="create-field">
              <label>名称</label>
              <input v-model="createForm.name" placeholder="例如：数据分析" />
            </div>
            <div class="create-field">
              <label>描述</label>
              <input v-model="createForm.description" placeholder="这个技能做什么？" />
            </div>
            <div class="create-field">
              <label>归属智能体</label>
              <select v-model="createForm.agent_id">
                <option value="">选择智能体</option>
                <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </div>
            <div class="create-field">
              <label>内容</label>
              <textarea v-model="createForm.content" placeholder="技能指令内容..." rows="10"></textarea>
            </div>
          </div>
          <div class="create-skill-footer">
            <button class="btn-cancel" @click="showCreateSkill = false">取消</button>
            <button class="btn-save" :disabled="!createForm.name.trim() || !createForm.agent_id" @click="doCreateSkill">保存</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { api, store, chatSettings, saveChatSettings } from '../store.js'

const allSkills = ref([])
const viewingSkill = ref(null)
const copyingSkill = ref(null)
const showCreateSkill = ref(false)
const skillFileInput = ref(null)
const activeTab = ref('config')
const createForm = reactive({ name: '', description: '', content: '', agent_id: '' })
const hubSettings = reactive({
  agent_max_rounds: '50',
  self_improve_enabled: '1',
  self_improve_threshold: '2',
  self_improve_path: 'per_agent',
})

const toolDisplayOptions = [
  { label: '展开', value: 'expanded' },
  { label: '折叠', value: 'collapsed' },
  { label: '完成后折叠', value: 'collapsed-after-complete' },
]

const roundOptions = [
  { label: '15 轮', value: '15' },
  { label: '30 轮', value: '30' },
  { label: '50 轮（推荐）', value: '50' },
  { label: '90 轮', value: '90' },
  { label: '无限制', value: '0' },
]

const thresholdOptions = [
  { label: '2 次', value: '2' },
  { label: '3 次', value: '3' },
  { label: '5 次', value: '5' },
  { label: '8 次', value: '8' },
]

const learnPathOptions = [
  { label: '各自独立', value: 'per_agent' },
  { label: '共享技能库', value: 'shared' },
  { label: '独立 + 共享', value: 'both' },
]

const agents = computed(() => store.agents.filter(a => a.id !== 'user' && a.id !== 'system'))

const skillGroups = computed(() => {
  const map = {}
  for (const skill of allSkills.value) {
    const key = skill.agent_id
    if (!map[key]) {
      map[key] = { agentId: key, agentName: skill.agent_name || '未知', skills: [] }
    }
    map[key].skills.push(skill)
  }
  return Object.values(map)
})

function onToolDisplayChange(val) {
  chatSettings.toolCallDisplay = val
  saveChatSettings()
}

async function onRoundsChange(val) {
  hubSettings.agent_max_rounds = val
  await api('PUT', '/admin/settings', { agent_max_rounds: val })
}

async function toggleSelfImprove() {
  const newVal = hubSettings.self_improve_enabled === '1' ? '0' : '1'
  hubSettings.self_improve_enabled = newVal
  await api('PUT', '/admin/settings', { self_improve_enabled: newVal })
}

async function onThresholdChange(val) {
  hubSettings.self_improve_threshold = val
  await api('PUT', '/admin/settings', { self_improve_threshold: val })
}

async function onLearnPathChange(val) {
  hubSettings.self_improve_path = val
  await api('PUT', '/admin/settings', { self_improve_path: val })
}

async function loadAllSkills() {
  const data = await api('GET', '/admin/skills')
  allSkills.value = data.result || []
}

async function loadHubSettings() {
  try {
    const data = await api('GET', '/admin/settings')
    if (data.result) Object.assign(hubSettings, data.result)
  } catch {}
}

function viewSkill(skill) {
  viewingSkill.value = skill
}

function copySkill(skill) {
  copyingSkill.value = skill
}

async function doCopy(agent) {
  if (agent.id === copyingSkill.value.agent_id) return
  await api('POST', `/admin/skills/${copyingSkill.value.id}/copy`, { target_agent_id: agent.id })
  copyingSkill.value = null
  loadAllSkills()
}

function downloadSkill(skill) {
  const blob = new Blob([skill.content || ''], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${skill.name}.md`
  a.click()
  URL.revokeObjectURL(url)
}

async function deleteSkill(skill) {
  if (!confirm(`确定删除技能「${skill.name}」？`)) return
  await api('DELETE', `/admin/skills/${skill.id}`)
  loadAllSkills()
}

async function doCreateSkill() {
  if (!createForm.name.trim() || !createForm.agent_id) return
  await api('POST', `/admin/agents/${createForm.agent_id}/skills`, {
    name: createForm.name.trim(),
    description: createForm.description.trim(),
    content: createForm.content,
  })
  showCreateSkill.value = false
  createForm.name = ''
  createForm.description = ''
  createForm.content = ''
  createForm.agent_id = ''
  loadAllSkills()
}

function triggerUpload() {
  skillFileInput.value?.click()
}

async function onSkillFileUpload(e) {
  const files = Array.from(e.target.files || [])
  if (!files.length) return
  const defaultAgent = agents.value[0]
  if (!defaultAgent) { alert('请先创建一个智能体'); return }
  for (const file of files) {
    const text = await file.text()
    const name = file.name.replace(/\.(md|txt|json|yaml|yml)$/, '')
    await api('POST', `/admin/agents/${defaultAgent.id}/skills`, {
      name,
      description: `从文件 ${file.name} 导入`,
      content: text,
      file_type: file.name.split('.').pop() || 'text',
    })
  }
  loadAllSkills()
  e.target.value = ''
}

onMounted(() => {
  loadAllSkills()
  loadHubSettings()
})
</script>

<style scoped>
.admin-center {
  padding: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.page-header {
  padding: 16px 20px 0;
}
.page-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}

/* Tab bar */
.tab-bar {
  display: flex;
  position: relative;
  margin: 12px 20px 0;
  border-bottom: 1px solid var(--border);
}
.tab-item {
  flex: 1;
  text-align: center;
  padding: 10px 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-dim);
  cursor: pointer;
  transition: color 0.2s;
  user-select: none;
}
.tab-item.active {
  color: var(--accent, #2d6a4f);
  font-weight: 600;
}
.tab-indicator {
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 50%;
  height: 2px;
  background: var(--accent, #2d6a4f);
  border-radius: 1px;
  transition: transform 0.25s ease;
}

/* Tab content */
.tab-content {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.tab-panel {
  padding: 16px 20px;
}

.admin-section {
  margin-bottom: 32px;
}

/* Engine Panel -> Config Panel */
.config-panel {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 16px 20px;
  border: 1px solid var(--border);
}
.config-items {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.config-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.config-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.config-desc {
  font-size: 12px;
  color: var(--text-dim);
}
.config-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.config-options .radio-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--border);
  transition: all 0.15s;
}
.config-options .radio-option input { display: none; }
.config-options .radio-option.active {
  background: var(--accent-soft, rgba(45,106,79,0.1));
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.toggle {
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: #ccc;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
}
.toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s;
}
.toggle.on {
  background: var(--accent, #2d6a4f);
}
.toggle.on::after {
  transform: translateX(18px);
}
.badge-green {
  background: rgba(45, 106, 79, 0.15) !important;
  color: #2d6a4f !important;
}
.badge-amber {
  background: rgba(217, 119, 6, 0.15) !important;
  color: #d97706 !important;
}
.section-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.section-title-row h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
.badge {
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
}

.empty-state {
  text-align: center;
  padding: 32px;
  color: var(--text-dim);
  font-size: 14px;
}

.skill-group {
  margin-bottom: 20px;
}
.skill-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 10px;
}
.skill-group-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.skill-group-count {
  font-size: 12px;
  color: var(--text-dim);
}

.skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.skill-card {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  transition: border-color 0.15s ease;
}
.skill-card:hover { border-color: var(--accent); }
.skill-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.skill-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.skill-card-type {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--surface2);
  color: var(--text-dim);
  font-family: var(--font-mono);
}
.skill-card-desc {
  font-size: 12px;
  color: var(--text-dim);
  margin: 0 0 8px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.skill-card-actions {
  display: flex;
  gap: 4px;
}
.skill-card-btn {
  width: 26px; height: 26px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface2);
  color: var(--text-dim);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s ease;
}
.skill-card-btn:hover { border-color: var(--accent); color: var(--accent); }

/* View modal */
.skill-view-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 24px;
}
.skill-view-modal {
  background: var(--bg);
  border-radius: var(--radius-lg, 16px);
  width: 100%;
  max-width: 640px;
  max-height: 75vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg, 0 20px 60px rgba(0,0,0,0.3));
}
.skill-view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
}
.skill-view-header h4 { margin: 0; font-size: 15px; font-weight: 700; }
.close-btn {
  background: none; border: none; font-size: 22px; color: var(--text-dim); cursor: pointer;
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
}
.close-btn:hover { background: var(--surface2); color: var(--text); }
.skill-view-meta {
  padding: 10px 20px;
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
}
.skill-view-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  font-size: 13px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  color: var(--text);
}

/* Copy modal */
.skill-copy-modal {
  background: var(--bg);
  border-radius: var(--radius-lg, 16px);
  width: 100%;
  max-width: 360px;
  box-shadow: var(--shadow-lg, 0 20px 60px rgba(0,0,0,0.3));
}
.copy-agent-list {
  padding: 8px;
  max-height: 300px;
  overflow-y: auto;
}
.copy-agent-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.1s ease;
}
.copy-agent-item:hover:not(.disabled) { background: var(--accent-soft); }
.copy-agent-item.disabled { opacity: 0.5; cursor: not-allowed; }
.copy-agent-name { font-size: 14px; font-weight: 500; }
.copy-agent-tag {
  font-size: 11px;
  color: var(--text-dim);
  background: var(--surface2);
  padding: 2px 8px;
  border-radius: 999px;
}

/* Section actions */
.section-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

/* Create skill form */
.create-skill-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}
.create-field {
  margin-bottom: 14px;
}
.create-field label {
  display: block;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.create-field input,
.create-field select,
.create-field textarea {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius, 8px);
  font-size: 14px;
  font-family: inherit;
  background: var(--surface);
  color: var(--text);
}
.create-field textarea {
  min-height: 180px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  resize: vertical;
  line-height: 1.5;
}
.create-field input:focus,
.create-field select:focus,
.create-field textarea:focus {
  outline: none;
  border-color: var(--accent);
}
.create-skill-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
}
.btn-cancel {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius, 8px);
  background: var(--surface);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
}
.btn-cancel:hover { background: var(--surface2); }
.btn-save {
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius, 8px);
  background: var(--accent);
  color: white;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-save:not(:disabled):hover { opacity: 0.9; }
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
  transition: all 0.15s ease;
}
.link-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.skill-card-btn.danger:hover { border-color: var(--danger, #e53e3e); color: var(--danger, #e53e3e); }
</style>
