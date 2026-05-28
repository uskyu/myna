<template>
  <div class="page admin-center">
    <div class="page-header">
      <h2>管理中心</h2>
      <span class="page-subtitle">引擎状态 · 技能库 · 智能体管理</span>
    </div>

    <!-- Engine Status Panel -->
    <div class="admin-section engine-panel">
      <div class="section-title-row">
        <h3>⚡ 引擎状态</h3>
        <span class="badge" :class="engineStatus.hermes_available ? 'badge-green' : 'badge-amber'">
          {{ engineStatus.hermes_available ? 'Hermes Agent' : 'Direct API' }}
        </span>
      </div>
      <div class="engine-info" v-if="engineStatus.engine">
        <div class="engine-row">
          <span class="engine-label">引擎</span>
          <span class="engine-value">{{ engineStatus.engine }}</span>
        </div>
        <div class="engine-row">
          <span class="engine-label">能力</span>
          <div class="engine-caps">
            <span v-for="cap in engineStatus.capabilities" :key="cap" class="cap-tag">{{ capLabels[cap] || cap }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Skills overview -->
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

      <!-- Group by agent -->
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

    <!-- View skill modal -->
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
import { api, store } from '../store.js'

const allSkills = ref([])
const viewingSkill = ref(null)
const copyingSkill = ref(null)
const showCreateSkill = ref(false)
const skillFileInput = ref(null)
const createForm = reactive({ name: '', description: '', content: '', agent_id: '' })
const engineStatus = ref({})
const capLabels = {
  tool_use: '工具调用',
  memory: '持久记忆',
  skills: '技能学习',
  delegation: '子代理',
  cron: '定时任务',
  web_browse: '网页浏览',
  file_ops: '文件操作',
  terminal: '终端命令',
  http_requests: 'HTTP请求',
}

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

async function loadAllSkills() {
  const data = await api('GET', '/admin/skills')
  allSkills.value = data.result || []
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
  // Use first agent as default owner, or prompt
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
  api('GET', '/admin/engine/status').then(d => { if (d.ok) engineStatus.value = d.result })
})
</script>

<style scoped>
.admin-center {
  padding: 20px;
}
.page-header {
  margin-bottom: 24px;
}
.page-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
.page-subtitle {
  font-size: 13px;
  color: var(--text-dim);
}

.admin-section {
  margin-bottom: 32px;
}

/* Engine Panel */
.engine-panel {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 16px 20px;
  border: 1px solid var(--border);
}
.engine-info {
  margin-top: 12px;
}
.engine-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.engine-label {
  font-size: 12px;
  color: var(--text-dim);
  min-width: 40px;
}
.engine-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}
.engine-caps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cap-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--accent-bg, rgba(45, 106, 79, 0.1));
  color: var(--accent);
  font-weight: 500;
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
