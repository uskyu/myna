<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
        <h1>Myna</h1>
      </div>

      <!-- Login form -->
      <form v-if="!showChangePwd" @submit.prevent="doLogin" class="login-form">
        <div class="input-group">
          <input
            ref="pwdInput"
            type="password"
            v-model="password"
            placeholder="输入访问密码"
            :class="{ error: errorMsg }"
            @input="errorMsg = ''"
          />
        </div>
        <p v-if="errorMsg" class="error-text">{{ errorMsg }}</p>
        <button type="submit" class="login-btn" :disabled="loading">
          {{ loading ? '验证中...' : '进入' }}
        </button>
      </form>

      <!-- Change password form -->
      <form v-else @submit.prevent="doChangePassword" class="login-form">
        <div class="input-group">
          <input type="password" v-model="currentPwd" placeholder="当前密码" />
        </div>
        <div class="input-group">
          <input type="password" v-model="newPwd" placeholder="新密码（至少4位）" />
        </div>
        <div class="input-group">
          <input type="password" v-model="confirmPwd" placeholder="确认新密码" />
        </div>
        <p v-if="errorMsg" class="error-text">{{ errorMsg }}</p>
        <p v-if="successMsg" class="success-text">{{ successMsg }}</p>
        <button type="submit" class="login-btn" :disabled="loading">
          {{ loading ? '修改中...' : '修改密码' }}
        </button>
        <button type="button" class="link-btn" @click="showChangePwd = false; errorMsg = ''">返回登录</button>
      </form>

      <button v-if="!showChangePwd" type="button" class="link-btn" @click="showChangePwd = true; errorMsg = ''">修改密码</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { api, setAuthToken } from '../store.js'

const emit = defineEmits(['authenticated'])

const password = ref('')
const currentPwd = ref('')
const newPwd = ref('')
const confirmPwd = ref('')
const errorMsg = ref('')
const successMsg = ref('')
const loading = ref(false)
const showChangePwd = ref(false)
const pwdInput = ref(null)

async function doLogin() {
  if (!password.value) {
    errorMsg.value = '请输入密码'
    return
  }
  loading.value = true
  errorMsg.value = ''
  const res = await api('POST', '/auth/login', { password: password.value })
  loading.value = false
  if (res.ok && res.token) {
    setAuthToken(res.token)
    emit('authenticated')
  } else {
    errorMsg.value = res.error || '登录失败'
  }
}

async function doChangePassword() {
  if (!currentPwd.value || !newPwd.value) {
    errorMsg.value = '请填写所有字段'
    return
  }
  if (newPwd.value.length < 4) {
    errorMsg.value = '新密码至少4位'
    return
  }
  if (newPwd.value !== confirmPwd.value) {
    errorMsg.value = '两次密码不一致'
    return
  }
  loading.value = true
  errorMsg.value = ''
  successMsg.value = ''
  const res = await api('POST', '/auth/change-password', {
    current_password: currentPwd.value,
    new_password: newPwd.value,
  })
  loading.value = false
  if (res.ok && res.token) {
    successMsg.value = '密码已修改，即将进入...'
    setAuthToken(res.token)
    setTimeout(() => emit('authenticated'), 1000)
  } else {
    errorMsg.value = res.error || '修改失败'
  }
}

onMounted(() => {
  nextTick(() => pwdInput.value?.focus())
})
</script>

<style scoped>
.login-page {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg, #faf9f7);
  z-index: 9999;
}

[data-theme="dark"] .login-page {
  background: #1a1a1a;
}

.login-card {
  width: 100%;
  max-width: 360px;
  padding: 48px 32px;
  text-align: center;
}

.login-logo {
  margin-bottom: 40px;
}

.login-logo svg {
  color: var(--accent, #2d6a4f);
  margin-bottom: 12px;
}

.login-logo h1 {
  font-size: 24px;
  font-weight: 600;
  color: var(--text, #1a1a1a);
  margin: 0;
}

[data-theme="dark"] .login-logo h1 {
  color: #e5e5e5;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.input-group input {
  width: 100%;
  padding: 12px 16px;
  border: 1.5px solid #e0e0e0;
  border-radius: 10px;
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s;
  background: white;
  box-sizing: border-box;
}

[data-theme="dark"] .input-group input {
  background: #2a2a2a;
  border-color: #444;
  color: #e5e5e5;
}

.input-group input:focus {
  border-color: var(--accent, #2d6a4f);
}

.input-group input.error {
  border-color: #e53e3e;
}

.error-text {
  color: #e53e3e;
  font-size: 13px;
  margin: 0;
}

.success-text {
  color: var(--accent, #2d6a4f);
  font-size: 13px;
  margin: 0;
}

.login-btn {
  padding: 12px;
  background: var(--accent, #2d6a4f);
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.login-btn:hover {
  opacity: 0.9;
}

.login-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.link-btn {
  background: none;
  border: none;
  color: var(--accent, #2d6a4f);
  font-size: 13px;
  cursor: pointer;
  margin-top: 8px;
  padding: 4px;
}

.link-btn:hover {
  text-decoration: underline;
}
</style>
