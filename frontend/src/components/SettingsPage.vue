<template>
  <div class="page active">
    <div class="header"><h1>设置</h1></div>
    <div class="settings-page">
      <div class="settings-section">
        <div class="section-title">外观</div>
        <div class="setting-item" @click="toggleTheme">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          <span class="setting-label">深色模式</span>
          <div class="toggle" :class="{ on: isDark }"></div>
        </div>
      </div>
      <div class="settings-section">
        <div class="section-title">模型配置</div>
        <div class="setting-item" @click="showModels = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          <span class="setting-label">供应商管理</span>
          <span class="setting-value">{{ models.length }} 个配置</span>
          <span class="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></span>
        </div>
      </div>
      <div class="settings-section">
        <div class="section-title">系统性能</div>
        <div class="setting-item" style="cursor:default">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          <span class="setting-label">Agent 并发数</span>
          <div class="inline-input">
            <input type="number" v-model.number="perfSettings.agent_concurrency" min="1" max="100" @change="savePerfSettings" class="mini-input">
          </div>
        </div>
        <div class="setting-item" style="cursor:default">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
          <span class="setting-label">单次最大轮数</span>
          <div class="inline-input">
            <input type="number" v-model.number="perfSettings.agent_max_rounds" min="1" max="500" @change="savePerfSettings" class="mini-input">
          </div>
        </div>
        <div class="setting-item" style="cursor:default">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span class="setting-label">上下文消息数</span>
          <div class="inline-input">
            <input type="number" v-model.number="perfSettings.context_messages_limit" min="1" max="200" @change="savePerfSettings" class="mini-input">
          </div>
        </div>
        <p class="setting-hint">并发数 = 同时能跑多少个 Agent（重启后生效）；轮数 = 单次对话最多调用几轮 API；上下文消息数 = 智能体能看到的最近消息条数（房间可单独覆盖）</p>
      </div>
      <div class="settings-section">
        <div class="section-title">安全</div>
        <div class="setting-item" @click="showChangePwd = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span class="setting-label">修改密码</span>
          <span class="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></span>
        </div>
        <div class="setting-item" @click="doLogout">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span class="setting-label">退出登录</span>
        </div>
      </div>
      <div class="settings-section">
        <div class="section-title">关于</div>
        <div class="setting-item" style="cursor:default">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          <span class="setting-label">Myna</span>
          <span class="setting-value">{{ (updateInfo.currentVersion || 'v0.3.7').replace(/^(?!v)/, 'v') }}</span>
          <span v-if="updateInfo.available" class="update-dot"></span>
        </div>
        <div v-if="updateInfo.available && updateInfo.isDocker" class="setting-item update-item" @click="handleUpdate" style="cursor:pointer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          <span class="setting-label">{{ updateInfo.updating ? '更新中...' : '一键更新' }}</span>
          <span class="setting-value" style="color:#d97706">{{ updateInfo.latestVersion }}</span>
        </div>
        <!-- Update progress bar -->
        <div v-if="updateInfo.updating" class="update-progress">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: updateInfo.percent + '%' }"></div>
          </div>
          <div class="progress-text">{{ updateInfo.message || '准备中...' }}</div>
        </div>
        <a v-else-if="updateInfo.available" class="setting-item update-item" :href="'https://github.com/uskyu/myna/releases'" target="_blank" style="text-decoration:none;color:inherit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          <span class="setting-label">发现新版本</span>
          <span class="setting-value" style="color:#d97706">{{ updateInfo.latestVersion }}</span>
          <span class="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></span>
        </a>
        <div v-else class="setting-item" @click="doCheckUpdate" style="cursor:pointer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          <span class="setting-label">检查更新</span>
          <span v-if="updateInfo.checking" class="setting-value">检查中...</span>
          <span v-else-if="updateInfo.error" class="setting-value" style="color:var(--danger,#e53e3e)">{{ updateInfo.error }}</span>
          <span v-else-if="updateInfo.checked" class="setting-value" style="color:var(--accent,#2d6a4f)">已是最新</span>
        </div>
        <a class="setting-item" href="https://github.com/uskyu/myna" target="_blank" style="text-decoration:none;color:inherit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
          <span class="setting-label">GitHub 仓库</span>
          <span class="setting-value">uskyu/myna</span>
          <span class="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></span>
        </a>
        <a class="setting-item" href="https://github.com/uskyu/myna/releases" target="_blank" style="text-decoration:none;color:inherit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          <span class="setting-label">更新日志</span>
          <span class="chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></span>
        </a>
      </div>
    </div>

    <ModelsModal v-if="showModels" @close="showModels = false" @changed="onModelsChanged" />

    <!-- Change password modal -->
    <div v-if="showChangePwd" class="modal-overlay" @click.self="showChangePwd = false">
      <div class="modal-card">
        <h3>修改密码</h3>
        <form @submit.prevent="doChangePassword" class="pwd-form">
          <input type="password" v-model="currentPwd" placeholder="当前密码" />
          <input type="password" v-model="newPwd" placeholder="新密码（至少4位）" />
          <input type="password" v-model="confirmPwd" placeholder="确认新密码" />
          <p v-if="pwdError" class="error-text">{{ pwdError }}</p>
          <p v-if="pwdSuccess" class="success-text">{{ pwdSuccess }}</p>
          <div class="modal-actions">
            <button type="button" class="btn-cancel" @click="showChangePwd = false">取消</button>
            <button type="submit" class="btn-confirm">确认修改</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Update confirmation modal -->
    <div v-if="showUpdateConfirm" class="modal-overlay" @click.self="showUpdateConfirm = false">
      <div class="modal-card">
        <h3>发现新版本</h3>
        <div class="update-confirm-content">
          <p>检测到新版本 <strong style="color:var(--accent,#2d6a4f)">{{ updateInfo.latestVersion }}</strong></p>
          <p style="color:var(--text-secondary,#666);font-size:0.9em;margin-top:0.5em">更新过程中容器将重启，正在进行的对话会中断。建议在空闲时更新。</p>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-cancel" @click="showUpdateConfirm = false">稍后</button>
          <button type="button" class="btn-confirm" @click="confirmUpdate">立即更新</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { api, clearAuth, setAuthToken, updateInfo, checkForUpdate, doUpdate } from '../store.js'
import ModelsModal from './ModelsModal.vue'

const isDark = ref(false)
const showModels = ref(false)
const showChangePwd = ref(false)
const showUpdateConfirm = ref(false)
const models = ref([])
const perfSettings = reactive({ agent_concurrency: 10, agent_max_rounds: 50, context_messages_limit: 20 })

const currentPwd = ref('')
const newPwd = ref('')
const confirmPwd = ref('')
const pwdError = ref('')
const pwdSuccess = ref('')

function toggleTheme() {
  isDark.value = !isDark.value
  if (isDark.value) {
    document.documentElement.setAttribute('data-theme', 'dark')
    localStorage.setItem('hub-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
    localStorage.setItem('hub-theme', 'light')
  }
}

async function doChangePassword() {
  pwdError.value = ''
  pwdSuccess.value = ''
  if (!currentPwd.value || !newPwd.value) {
    pwdError.value = '请填写所有字段'
    return
  }
  if (newPwd.value.length < 4) {
    pwdError.value = '新密码至少4位'
    return
  }
  if (newPwd.value !== confirmPwd.value) {
    pwdError.value = '两次密码不一致'
    return
  }
  const res = await api('POST', '/auth/change-password', {
    current_password: currentPwd.value,
    new_password: newPwd.value,
  })
  if (res.ok) {
    pwdSuccess.value = '密码已修改'
    if (res.token) setAuthToken(res.token)
    setTimeout(() => { showChangePwd.value = false }, 1500)
  } else {
    pwdError.value = res.error || '修改失败'
  }
}

function doLogout() {
  clearAuth()
  location.reload()
}

async function doCheckUpdate() {
  await checkForUpdate()
}

async function handleUpdate() {
  if (updateInfo.updating) return
  showUpdateConfirm.value = true
}

async function confirmUpdate() {
  showUpdateConfirm.value = false
  await doUpdate()
}

async function loadModels() {
  const data = await api('GET', '/admin/models')
  models.value = data.result || []
}

async function onModelsChanged() {
  await loadModels()
  showModels.value = false
}

async function loadPerfSettings() {
  const data = await api('GET', '/admin/settings')
  if (data.ok && data.result) {
    perfSettings.agent_concurrency = parseInt(data.result.agent_concurrency) || 10
    perfSettings.agent_max_rounds = parseInt(data.result.agent_max_rounds) || 50
    perfSettings.context_messages_limit = parseInt(data.result.context_messages_limit) || 20
  }
}

async function savePerfSettings() {
  await api('PUT', '/admin/settings', {
    agent_concurrency: String(perfSettings.agent_concurrency || 10),
    agent_max_rounds: String(perfSettings.agent_max_rounds || 50),
    context_messages_limit: String(perfSettings.context_messages_limit || 20),
  })
}

onMounted(async () => {
  isDark.value = localStorage.getItem('hub-theme') === 'dark'
  await loadModels()
  await loadPerfSettings()
  
  // Listen for update_available events from backend
  const { ws } = await import('../store.js')
  const updateHandler = (msg) => {
    if (msg.type === 'update_available' && updateInfo.isDocker) {
      showUpdateConfirm.value = true
    }
  }
  ws.onMessage(updateHandler)
  
  // Cleanup on unmount
  return () => ws.offMessage(updateHandler)
})
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-card {
  background: white;
  border-radius: 14px;
  padding: 24px;
  width: 90%;
  max-width: 360px;
}
[data-theme="dark"] .modal-card {
  background: #2a2a2a;
  color: #e5e5e5;
}
.modal-card h3 {
  margin: 0 0 16px;
  font-size: 17px;
}
.pwd-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pwd-form input {
  padding: 10px 14px;
  border: 1.5px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}
[data-theme="dark"] .pwd-form input {
  background: #1a1a1a;
  border-color: #444;
  color: #e5e5e5;
}
.pwd-form input:focus {
  border-color: var(--accent, #2d6a4f);
}
.error-text { color: #e53e3e; font-size: 13px; margin: 0; }
.success-text { color: var(--accent, #2d6a4f); font-size: 13px; margin: 0; }
.modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.btn-cancel {
  flex: 1;
  padding: 10px;
  border: 1.5px solid #e0e0e0;
  border-radius: 8px;
  background: none;
  cursor: pointer;
  font-size: 14px;
}
[data-theme="dark"] .btn-cancel {
  border-color: #444;
  color: #e5e5e5;
}
.btn-confirm {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 8px;
  background: var(--accent, #2d6a4f);
  color: white;
  cursor: pointer;
  font-size: 14px;
}
.update-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e53e3e;
  flex-shrink: 0;
  margin-left: 6px;
}
.update-item {
  background: rgba(217, 119, 6, 0.06);
  border-radius: 8px;
}
.inline-input {
  margin-left: auto;
  flex-shrink: 0;
}
.mini-input {
  width: 72px;
  padding: 6px 10px;
  border: 1.5px solid var(--border, #e0e0e0);
  border-radius: 6px;
  font-size: 14px;
  text-align: center;
  background: var(--surface, #fff);
  color: var(--text, #1a1a1a);
}
.mini-input:focus {
  outline: none;
  border-color: var(--accent, #2d6a4f);
}
[data-theme="dark"] .mini-input {
  background: #2a2a2a;
  border-color: #444;
  color: #e5e5e5;
}
.setting-hint {
  font-size: 12px;
  color: var(--text-dim, #999);
  margin: 4px 0 0 0;
  padding: 0 4px;
  line-height: 1.5;
}

/* Update progress */
.update-progress {
  padding: 8px 16px 12px;
  margin: -4px 0 8px;
}
.progress-bar {
  height: 6px;
  background: var(--border, #e0e0e0);
  border-radius: 3px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent, #2d6a4f), #40916c);
  border-radius: 3px;
  transition: width 0.3s ease;
}
.progress-text {
  font-size: 11px;
  color: var(--text-dim, #999);
  margin-top: 4px;
  text-align: center;
}
</style>
