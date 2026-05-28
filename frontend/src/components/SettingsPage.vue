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
        <div class="section-title">聊天</div>
        <div class="setting-item" style="cursor:default;flex-wrap:wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          <span class="setting-label">工具调用显示</span>
          <div class="tool-display-options">
            <label class="radio-option" :class="{ active: chatSettings.toolCallDisplay === 'expanded' }">
              <input type="radio" name="tool-display" value="expanded" :checked="chatSettings.toolCallDisplay === 'expanded'" @change="onToolDisplayChange('expanded')">
              <span>展开</span>
            </label>
            <label class="radio-option" :class="{ active: chatSettings.toolCallDisplay === 'collapsed' }">
              <input type="radio" name="tool-display" value="collapsed" :checked="chatSettings.toolCallDisplay === 'collapsed'" @change="onToolDisplayChange('collapsed')">
              <span>折叠</span>
            </label>
            <label class="radio-option" :class="{ active: chatSettings.toolCallDisplay === 'collapsed-after-complete' }">
              <input type="radio" name="tool-display" value="collapsed-after-complete" :checked="chatSettings.toolCallDisplay === 'collapsed-after-complete'" @change="onToolDisplayChange('collapsed-after-complete')">
              <span>完成后折叠</span>
            </label>
          </div>
        </div>
      </div>
      <div class="settings-section">
        <div class="section-title">智能体执行</div>
        <div class="setting-item" style="cursor:default;flex-wrap:wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span class="setting-label">最大执行轮数</span>
          <span class="setting-desc">智能体单次响应的最大 API 调用轮数（每轮可执行多个工具），到达后自动停止</span>
          <div class="timeout-options">
            <label v-for="opt in roundOptions" :key="opt.value" class="radio-option" :class="{ active: hubSettings.agent_max_rounds === opt.value }">
              <input type="radio" name="rounds" :value="opt.value" :checked="hubSettings.agent_max_rounds === opt.value" @change="onRoundsChange(opt.value)">
              <span>{{ opt.label }}</span>
            </label>
          </div>
        </div>
      </div>
      <div class="settings-section">
        <div class="section-title">自主进化</div>
        <div class="setting-item" style="cursor:default;flex-wrap:wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>
          <span class="setting-label">自我迭代学习</span>
          <div class="toggle" :class="{ on: hubSettings.self_improve_enabled === '1' }" @click="toggleSelfImprove"></div>
        </div>
        <div class="setting-item" style="cursor:default;flex-wrap:wrap" v-if="hubSettings.self_improve_enabled === '1'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          <span class="setting-label">触发阈值</span>
          <span class="setting-desc">工具调用次数达到此值后触发学习分析</span>
          <div class="timeout-options">
            <label v-for="opt in thresholdOptions" :key="opt.value" class="radio-option" :class="{ active: hubSettings.self_improve_threshold === opt.value }">
              <input type="radio" name="threshold" :value="opt.value" :checked="hubSettings.self_improve_threshold === opt.value" @change="onThresholdChange(opt.value)">
              <span>{{ opt.label }}</span>
            </label>
          </div>
        </div>
        <div class="setting-item" style="cursor:default;flex-wrap:wrap" v-if="hubSettings.self_improve_enabled === '1'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          <span class="setting-label">学习路径</span>
          <span class="setting-desc">智能体学到的技能保存位置（智能体未单独设置时使用此全局配置）</span>
          <div class="timeout-options">
            <label v-for="opt in learnPathOptions" :key="opt.value" class="radio-option" :class="{ active: hubSettings.self_improve_path === opt.value }">
              <input type="radio" name="learn-path" :value="opt.value" :checked="hubSettings.self_improve_path === opt.value" @change="onLearnPathChange(opt.value)">
              <span>{{ opt.label }}</span>
            </label>
          </div>
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
          <span class="setting-value">v0.3.0</span>
        </div>
      </div>
    </div>

    <ModelsModal v-if="showModels" @close="showModels = false" @changed="loadModels" />

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
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { api, chatSettings, saveChatSettings, clearAuth, setAuthToken } from '../store.js'
import ModelsModal from './ModelsModal.vue'

const isDark = ref(false)
const showModels = ref(false)
const showChangePwd = ref(false)
const models = ref([])
const hubSettings = reactive({
  agent_max_rounds: '50',
  self_improve_enabled: '1',
  self_improve_threshold: '2',
  self_improve_path: 'per_agent',
})

const currentPwd = ref('')
const newPwd = ref('')
const confirmPwd = ref('')
const pwdError = ref('')
const pwdSuccess = ref('')

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
    if (res.token) {
      setAuthToken(res.token)
    }
    setTimeout(() => { showChangePwd.value = false }, 1500)
  } else {
    pwdError.value = res.error || '修改失败'
  }
}

function doLogout() {
  clearAuth()
  location.reload()
}

async function loadModels() {
  const data = await api('GET', '/admin/models')
  models.value = data.result || []
}

async function loadHubSettings() {
  try {
    const data = await api('GET', '/admin/settings')
    if (data.result) {
      Object.assign(hubSettings, data.result)
    }
  } catch {}
}

onMounted(async () => {
  isDark.value = localStorage.getItem('hub-theme') === 'dark'
  await loadModels()
  await loadHubSettings()
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
</style>
