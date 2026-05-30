<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal models-modal">
      <div class="models-header">
        <h3>{{ editingModel ? (form.id ? '编辑供应商' : '新增供应商') : '供应商管理' }}</h3>
        <button class="close-x" @click="$emit('close')" aria-label="关闭">×</button>
      </div>

      <!-- List view -->
      <div v-if="!editingModel" class="models-list">
        <div v-if="!models.length" class="empty-mini">
          <p>还没有模型配置</p>
          <p style="font-size:12px;color:var(--text-dim)">点击下方添加你的第一个 OpenAI 兼容供应商</p>
        </div>
        <div v-for="m in models" :key="m.id" class="model-row">
          <div class="model-info">
            <div class="model-name">{{ m.name }}</div>
            <div class="model-meta">
              <span class="model-tag">{{ m.model }}</span>
              <span v-if="m.is_default" class="default-tag">默认</span>
              <span v-if="m.max_tokens" class="ctx-tag">{{ formatCtx(m.max_tokens) }} ctx</span>
            </div>
            <div class="model-base" :title="m.base_url">{{ m.base_url }}</div>
          </div>
          <div class="model-actions">
            <button class="icon-btn" @click="startEdit(m)" title="编辑">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="icon-btn danger" @click="remove(m)" title="删除">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>

        <button class="btn btn-primary add-btn" @click="startNew" style="width:100%;margin-top:14px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><path d="M12 5v14M5 12h14"/></svg>
          新增供应商
        </button>
      </div>

      <!-- Edit form -->
      <div v-else class="models-edit">
        <div class="field">
          <label>名称</label>
          <input v-model="form.name" placeholder="例如：OpenAI 官方 / DeepSeek">
        </div>
        <div class="field">
          <label>Base URL</label>
          <input v-model="form.base_url" placeholder="https://api.openai.com/v1" @blur="resetFetched">
        </div>
        <div class="field">
          <label>API Key</label>
          <div class="api-key-row">
            <input v-model="form.api_key" :type="showKey ? 'text' : 'password'" :placeholder="form.id ? '留空则保留原密钥' : 'sk-...'" @blur="resetFetched">
            <button type="button" class="icon-btn" @click="showKey = !showKey" :title="showKey ? '隐藏' : '显示'">
              <svg v-if="!showKey" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"/></svg>
            </button>
          </div>
        </div>

        <!-- Mode tabs -->
        <div class="mode-tabs">
          <button type="button" class="mode-tab" :class="{ active: mode === 'fetch' }" @click="mode = 'fetch'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            快捷获取
          </button>
          <button type="button" class="mode-tab" :class="{ active: mode === 'manual' }" @click="mode = 'manual'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            手动填写
          </button>
        </div>

        <!-- Fetch mode -->
        <div v-if="mode === 'fetch'">
          <button type="button" class="btn btn-secondary fetch-btn" @click="fetchModels" :disabled="fetching || !form.base_url || (!form.api_key && !form.id)">
            <svg v-if="!fetching" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            <svg v-else class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            {{ fetching ? '正在获取...' : '获取模型列表' }}
          </button>
          <div v-if="fetchError" class="fetch-error">{{ fetchError }}</div>

          <div v-if="fetchedModels.length" class="field" style="margin-top:12px">
            <label>选择模型 <span class="muted">({{ fetchedModels.length }} 个可用)</span></label>
            <div class="model-search">
              <input v-model="modelFilter" placeholder="搜索模型 ID..." class="search-mini">
            </div>
            <div v-if="!form.model" class="model-options">
              <div
                v-for="m in filteredModels"
                :key="m.id"
                class="model-option"
                :class="{ active: form.model === m.id }"
                @click="selectModel(m.id)"
              >
                <div class="opt-id">{{ m.id }}</div>
                <div v-if="m.meta" class="opt-meta">
                  <span v-if="m.meta.max_input_tokens">{{ formatCtx(m.meta.max_input_tokens) }} ctx</span>
                  <span v-if="m.meta.supports_vision" class="cap-tag">👁 vision</span>
                  <span v-if="m.meta.supports_function_calling" class="cap-tag">🔧 tools</span>
                </div>
              </div>
              <div v-if="!filteredModels.length" class="empty-mini" style="padding:14px">
                <p style="color:var(--text-dim);font-size:13px">没有匹配的模型</p>
              </div>
            </div>
            <div v-if="form.model" class="selected-model">
              <span class="muted">已选：</span>
              <code>{{ form.model }}</code>
              <span v-if="form.max_tokens" class="ctx-tag">{{ formatCtx(form.max_tokens) }} ctx</span>
              <button type="button" class="link-mini" @click="clearSelectedModel">重新选择</button>
            </div>
          </div>
        </div>

        <!-- Manual mode -->
        <div v-else>
          <div class="field">
            <label>模型 ID</label>
            <input v-model="form.model" placeholder="gpt-4o-mini">
          </div>
          <div class="field-row">
            <div class="field" style="flex:1">
              <label>Max Tokens (上下文)</label>
              <input v-model.number="form.max_tokens" type="number" min="1" placeholder="4096">
            </div>
          </div>
        </div>

        <!-- Advanced (collapsed by default) -->
        <div class="advanced-section">
          <button type="button" class="advanced-toggle" @click="showAdvanced = !showAdvanced">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" :style="{ transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0)' }"><path d="M9 18l6-6-6-6"/></svg>
            高级选项
            <span v-if="!showAdvanced" class="muted">(接口格式、温度、默认配置)</span>
          </button>
          <div v-if="showAdvanced" class="advanced-body">
            <div class="field">
              <label>接口格式 (API Mode)</label>
              <div class="api-mode-options">
                <label class="radio-option" :class="{ active: form.api_mode === 'chat_completions' }">
                  <input type="radio" name="api-mode" value="chat_completions" v-model="form.api_mode">
                  <span>Chat Completions</span>
                  <span class="mode-hint">OpenAI 兼容 (默认)</span>
                </label>
                <label class="radio-option" :class="{ active: form.api_mode === 'responses' }">
                  <input type="radio" name="api-mode" value="responses" v-model="form.api_mode">
                  <span>Responses API</span>
                  <span class="mode-hint">GPT-5 / Codex</span>
                </label>
                <label class="radio-option" :class="{ active: form.api_mode === 'anthropic_messages' }">
                  <input type="radio" name="api-mode" value="anthropic_messages" v-model="form.api_mode">
                  <span>Anthropic Messages</span>
                  <span class="mode-hint">Claude 系列</span>
                </label>
              </div>
            </div>
            <div class="field-row">
              <div class="field" style="flex:1">
                <label>Temperature</label>
                <input v-model.number="form.temperature" type="number" step="0.1" min="0" max="2" placeholder="0.7">
              </div>
              <div v-if="mode === 'fetch'" class="field" style="flex:1">
                <label>Max Tokens</label>
                <input v-model.number="form.max_tokens" type="number" min="1" placeholder="4096">
              </div>
            </div>
            <div class="field" style="display:flex;align-items:center;gap:10px">
              <button type="button" class="toggle" :class="{ on: form.is_default }" @click="form.is_default = !form.is_default"></button>
              <label style="margin:0;cursor:pointer" @click="form.is_default = !form.is_default">设为默认配置</label>
            </div>
          </div>
        </div>

        <!-- Test Connection -->
        <div class="test-section">
          <button type="button" class="btn btn-secondary test-btn" @click="testConnection" :disabled="testing || !form.base_url || (!form.api_key && !form.id)">
            <svg v-if="!testing" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <svg v-else class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            {{ testing ? '测试中...' : '测试连接' }}
          </button>
          <div v-if="testResult" class="test-result" :class="testResult.ok ? 'test-ok' : 'test-fail'">
            {{ testResult.message }}
          </div>
        </div>

        <div class="btn-row">
          <button class="btn btn-cancel" @click="cancelEdit">取消</button>
          <button class="btn btn-primary" @click="saveModel" :disabled="!canSave">{{ form.id ? '保存' : '创建' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { api } from '../store.js'

const emit = defineEmits(['close', 'changed'])

const models = ref([])
const editingModel = ref(false)
const mode = ref('fetch')
const showAdvanced = ref(false)
const showKey = ref(false)
const fetching = ref(false)
const fetchError = ref('')
const fetchedModels = ref([])
const modelFilter = ref('')

const form = reactive({
  id: null,
  name: '',
  base_url: '',
  api_key: '',
  model: '',
  temperature: 0.7,
  max_tokens: 4096,
  is_default: false,
  api_mode: 'chat_completions',
})
const testing = ref(false)
const testResult = ref(null)

async function load() {
  const data = await api('GET', '/admin/models')
  models.value = data.result || []
}

function resetFetched() {
  // If user changes URL/key after fetch, invalidate model list
  fetchedModels.value = []
  fetchError.value = ''
}

function startNew() {
  Object.assign(form, {
    id: null, name: '', base_url: '', api_key: '', model: '',
    temperature: 0.7, max_tokens: 4096, is_default: models.value.length === 0,
    api_mode: 'chat_completions',
  })
  fetchedModels.value = []
  fetchError.value = ''
  modelFilter.value = ''
  mode.value = 'fetch'
  showAdvanced.value = false
  testResult.value = null
  editingModel.value = true
}

function startEdit(m) {
  // Parse api_mode from params_json if stored
  let apiMode = 'chat_completions'
  if (m.params_json) {
    try {
      const p = typeof m.params_json === 'string' ? JSON.parse(m.params_json) : m.params_json
      if (p.api_mode) apiMode = p.api_mode
    } catch(e) {}
  }
  Object.assign(form, {
    id: m.id,
    name: m.name || '',
    base_url: m.base_url || '',
    api_key: '', // never prefill secret
    model: m.model || '',
    temperature: m.temperature ?? 0.7,
    max_tokens: m.max_tokens ?? 4096,
    is_default: !!m.is_default,
    api_mode: apiMode,
  })
  fetchedModels.value = []
  fetchError.value = ''
  modelFilter.value = ''
  mode.value = 'fetch'
  showAdvanced.value = false
  testResult.value = null
  editingModel.value = true
}

function cancelEdit() {
  editingModel.value = false
}

async function fetchModels() {
  if (!form.base_url) { fetchError.value = '请先填写 Base URL'; return }
  if (!form.api_key && !form.id) { fetchError.value = '请先填写 API Key'; return }
  fetching.value = true
  fetchError.value = ''
  try {
    // Fetch model list from provider
    const payload = { base_url: form.base_url }
    if (form.api_key) payload.api_key = form.api_key
    // For existing configs, pass model_config_id so backend can use stored key
    if (form.id) payload.model_config_id = form.id
    const data = await api('POST', '/admin/config/models', payload)
    if (!data.ok) {
      fetchError.value = data.error || '获取失败'
      fetchedModels.value = []
      return
    }
    const list = data.result || []
    // Enrich with metadata
    const meta = await api('GET', '/admin/models/metadata').catch(() => ({ ok: false }))
    // metadata endpoint returns total only when no query — fetch all by querying empty? Use search per-batch
    // Simpler: fetch metadata for each model id via /admin/models/metadata?id=
    const enriched = []
    for (const m of list) {
      enriched.push({ id: m.id, meta: null })
    }
    // Batch fetch metadata for visible models
    try {
      const ids = list.map(m => m.id).slice(0, 200)
      // Use ?id= one-by-one is heavy. Instead, query by batches with no filter then map locally:
      // Endpoint without q/id returns count only, so we fetch with ?q= for each unique stem
      // Pragmatic: skip enrichment if too many; do per-id only when user picks one
    } catch(e) {}
    fetchedModels.value = enriched
  } catch(e) {
    fetchError.value = '获取失败：' + e.message
  } finally {
    fetching.value = false
  }
}

const filteredModels = computed(() => {
  const q = modelFilter.value.toLowerCase().trim()
  if (!q) return fetchedModels.value
  return fetchedModels.value.filter(m => m.id.toLowerCase().includes(q))
})

async function selectModel(id) {
  form.model = id
  modelFilter.value = ''
  // Try to enrich ctx from metadata
  try {
    const data = await api('GET', `/admin/models/metadata?id=${encodeURIComponent(id)}`)
    if (data.ok && data.result) {
      const exact = data.result[id]
      const matchEntry = exact || Object.values(data.result)[0]
      if (matchEntry) {
        if (matchEntry.max_output_tokens) form.max_tokens = Math.min(matchEntry.max_output_tokens, 8192)
        // Update fetchedModels meta too
        const fm = fetchedModels.value.find(m => m.id === id)
        if (fm) fm.meta = matchEntry
      }
    }
  } catch(e) {}
}

function clearSelectedModel() {
  form.model = ''
}

const canSave = computed(() => {
  if (!form.name.trim() || !form.base_url.trim() || !form.model.trim()) return false
  if (!form.id && !form.api_key) return false
  return true
})

function formatCtx(n) {
  if (!n) return ''
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k'
  return String(n)
}

async function saveModel() {
  if (!canSave.value) return
  const params = { api_mode: form.api_mode }
  const payload = {
    name: form.name.trim(),
    provider: 'openai',
    base_url: form.base_url.trim(),
    model: form.model.trim(),
    temperature: form.temperature,
    max_tokens: form.max_tokens,
    is_default: form.is_default ? 1 : 0,
    params_json: JSON.stringify(params),
  }
  if (form.api_key) payload.api_key = form.api_key

  let res
  if (form.id) {
    res = await api('PUT', `/admin/models/${form.id}`, payload)
  } else {
    res = await api('POST', '/admin/models', payload)
  }
  if (res.ok) {
    editingModel.value = false
    await load()
    emit('changed')
  } else {
    alert('保存失败：' + (res.error || '未知错误'))
  }
}

async function remove(m) {
  if (!confirm(`确定删除「${m.name}」？`)) return
  const res = await api('DELETE', `/admin/models/${m.id}`)
  if (res.ok) {
    await load()
    emit('changed')
  } else {
    alert('删除失败：' + (res.error || '未知错误'))
  }
}

async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    const payload = {
      base_url: form.base_url.trim(),
      model: form.model.trim() || 'gpt-4o-mini',
      api_mode: form.api_mode,
    }
    if (form.api_key) payload.api_key = form.api_key
    if (form.id) payload.model_config_id = form.id
    const res = await api('POST', '/admin/models/test', payload)
    if (res.ok) {
      testResult.value = { ok: true, message: `✅ 连接成功 — ${res.result?.reply?.slice(0, 60) || '模型响应正常'}` }
    } else {
      testResult.value = { ok: false, message: `❌ ${res.error || '连接失败'}` }
    }
  } catch(e) {
    testResult.value = { ok: false, message: `❌ ${e.message}` }
  } finally {
    testing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.models-modal { max-width: 560px; max-height: 88vh; display: flex; flex-direction: column; }
.models-header { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.models-header h3 { flex: 1; text-align: left; margin: 0; }
.close-x {
  background: transparent;
  border: 1px solid var(--border);
  width: 30px; height: 30px;
  border-radius: var(--radius-sm);
  font-size: 18px;
  line-height: 1;
  color: var(--text-dim);
  cursor: pointer;
}
.close-x:hover { background: var(--surface2); color: var(--text); }

.models-list { overflow-y: auto; flex: 1; }
.empty-mini { text-align: center; padding: 32px 0; color: var(--text-2); }
.empty-mini p:first-child { font-weight: 600; margin-bottom: 4px; }

.model-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 8px;
  background: var(--surface);
  transition: border-color 0.15s ease;
}
.model-row:hover { border-color: var(--border-strong); }
.model-info { flex: 1; min-width: 0; }
.model-name { font-size: 14px; font-weight: 600; color: var(--text); }
.model-meta { margin-top: 4px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.model-tag {
  font-size: 11px; font-family: var(--font-mono);
  background: var(--surface2); border: 1px solid var(--border);
  padding: 2px 8px; border-radius: 999px; color: var(--text-2);
}
.default-tag {
  font-size: 11px;
  background: var(--accent-soft); color: var(--accent);
  padding: 2px 8px; border-radius: 999px; font-weight: 600;
}
.ctx-tag {
  font-size: 11px; font-family: var(--font-mono);
  background: var(--surface2); border: 1px solid var(--border);
  padding: 2px 8px; border-radius: 999px; color: var(--text-dim);
}
.model-base {
  margin-top: 4px;
  font-size: 11px; color: var(--text-dim);
  font-family: var(--font-mono);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.model-actions { display: flex; gap: 4px; flex-shrink: 0; }
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
.icon-btn:hover { color: var(--accent); border-color: var(--accent); }
.icon-btn.danger:hover { color: var(--danger); border-color: var(--danger); background: var(--danger-soft); }
.icon-btn svg { width: 14px; height: 14px; }

.add-btn { gap: 6px; }

.models-edit { overflow-y: auto; flex: 1; padding-right: 4px; }
.models-edit .field { margin-bottom: 12px; }
.models-edit .field label {
  font-size: 12px; color: var(--text-dim);
  font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; display: block; margin-bottom: 6px;
}
.muted { color: var(--text-dim); font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 11px; }
.models-edit .field input {
  width: 100%; padding: 9px 12px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  font-size: 14px; background: var(--surface); color: var(--text);
  margin: 0;
}
.models-edit .field input:focus { outline: none; border-color: var(--accent); box-shadow: var(--shadow-glow); }
.field-row { display: flex; gap: 10px; }

.api-key-row { display: flex; gap: 6px; align-items: stretch; }
.api-key-row input { flex: 1; }
.api-key-row .icon-btn { width: 38px; height: auto; }

.mode-tabs {
  display: flex; gap: 6px;
  margin: 14px 0 12px;
  padding: 4px;
  background: var(--surface2);
  border-radius: var(--radius);
  border: 1px solid var(--border);
}
.mode-tab {
  flex: 1; padding: 8px 12px;
  background: transparent; border: none;
  border-radius: var(--radius-sm);
  font-size: 13px; font-weight: 600;
  color: var(--text-dim);
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  transition: all 0.15s ease;
}
.mode-tab.active {
  background: var(--surface);
  color: var(--accent);
  box-shadow: var(--shadow-sm);
}

.fetch-btn {
  width: 100%;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
}
.fetch-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
.fetch-error {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--danger-soft);
  color: var(--danger);
  border-radius: var(--radius-sm);
  font-size: 13px;
}

.search-mini {
  width: 100%; padding: 7px 10px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  font-size: 13px; background: var(--surface); color: var(--text);
  margin-bottom: 8px;
}
.model-options {
  max-height: 200px; overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.model-option {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.12s ease;
}
.model-option:last-child { border-bottom: none; }
.model-option:hover { background: var(--surface2); }
.model-option.active { background: var(--accent-soft); }
.model-option.active .opt-id { color: var(--accent); }
.opt-id { font-family: var(--font-mono); font-size: 13px; color: var(--text); font-weight: 500; }
.opt-meta { margin-top: 4px; display: flex; gap: 6px; flex-wrap: wrap; font-size: 11px; color: var(--text-dim); }
.cap-tag {
  background: var(--surface2); border: 1px solid var(--border);
  padding: 1px 6px; border-radius: 999px;
}
.selected-model {
  margin-top: 10px;
  padding: 8px 10px;
  background: var(--accent-soft);
  border-radius: var(--radius-sm);
  font-size: 12px;
  display: flex; align-items: center; gap: 8px;
  flex-wrap: wrap;
}
.selected-model code {
  font-family: var(--font-mono);
  color: var(--accent);
  font-weight: 600;
}
.link-mini {
  border: none;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
}
.link-mini:hover { text-decoration: underline; }

.advanced-section {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.advanced-toggle {
  background: transparent; border: none;
  padding: 6px 0;
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600;
  color: var(--text-2);
  cursor: pointer;
}
.advanced-toggle svg { transition: transform 0.15s ease; }
.advanced-toggle:hover { color: var(--accent); }
.advanced-body { margin-top: 10px; padding-left: 4px; }

.btn-row {
  display: flex; gap: 10px; margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.btn-row .btn { flex: 1; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* API Mode options */
.api-mode-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.api-mode-options .radio-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
}
.api-mode-options .radio-option.active {
  border-color: var(--accent);
  background: rgba(45, 106, 79, 0.06);
}
.api-mode-options .radio-option input { margin: 0; }
.api-mode-options .radio-option span:nth-child(2) { font-size: 13px; font-weight: 600; }
.mode-hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-dim);
  font-weight: 400;
}

/* Test section */
.test-section {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.test-btn {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.test-result {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
}
.test-ok {
  background: rgba(45, 106, 79, 0.1);
  color: #2d6a4f;
}
.test-fail {
  background: var(--danger-soft);
  color: var(--danger);
}
</style>
