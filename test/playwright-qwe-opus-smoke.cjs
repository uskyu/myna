const { chromium } = require('playwright');

const BASE = process.env.MYNA_BASE || 'http://localhost:3457';
const TOKEN = process.env.MYNA_TOKEN || '';
const QWE_BASE = process.env.QWE_BASE || 'https://qweapi.com/v1';
const QWE_KEY = process.env.QWE_KEY || '';
const MODEL_ID = process.env.QWE_MODEL || 'claude-opus-4-6';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

async function waitForAgentMessage(roomId, agentId, afterId = 0, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await api(`/admin/rooms/${roomId}/messages?limit=100`);
    const found = (data.result || []).find(m => m.id > afterId && m.sender_id === agentId);
    if (found) return { message: found, all: data.result || [] };
    await sleep(2500);
  }
  const data = await api(`/admin/rooms/${roomId}/messages?limit=100`);
  return { message: null, all: data.result || [] };
}

async function waitForMessages(roomId, agentIds, afterId = 0, timeoutMs = 180000) {
  const remaining = new Set(agentIds);
  const deadline = Date.now() + timeoutMs;
  let all = [];
  while (Date.now() < deadline && remaining.size) {
    const data = await api(`/admin/rooms/${roomId}/messages?limit=100`);
    all = data.result || [];
    for (const m of all) {
      if (m.id > afterId && remaining.has(m.sender_id)) remaining.delete(m.sender_id);
    }
    if (!remaining.size) break;
    await sleep(3000);
  }
  return { seen: agentIds.filter(id => !remaining.has(id)), missing: [...remaining], all };
}

async function main() {
  if (!TOKEN) throw new Error('MYNA_TOKEN is required');
  if (!QWE_KEY) throw new Error('QWE_KEY is required');

  const stamp = Date.now().toString(36);
  const result = {
    modelUi: {},
    setup: {},
    mention: {},
    chain: {},
    interrupt: {},
    screenshots: {},
  };

  const browser = await chromium.launch({ headless: false, slowMo: 45 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const requests = [];
  const consoleLogs = [];
  page.on('request', req => {
    if (req.url().includes('/admin/')) requests.push({ method: req.method(), url: req.url(), postData: req.postData() });
  });
  page.on('console', msg => consoleLogs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => consoleLogs.push(`pageerror: ${err.message}`));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(token => localStorage.setItem('hub_auth_token', token), TOKEN);
  await page.reload({ waitUntil: 'networkidle' });

  // UI path: fetch models, select OPUS4.6, save config.
  await page.locator('[title="设置"]').click();
  await page.getByText('供应商管理').click();
  await page.getByText('新增供应商').click();
  await page.locator('input[placeholder*="OpenAI"]').fill(`QWE OPUS ${stamp}`);
  await page.locator('input[placeholder="https://api.openai.com/v1"]').fill(QWE_BASE);
  await page.locator('input[placeholder="sk-..."]').fill(QWE_KEY);
  await page.getByText('获取模型列表').click();
  await page.waitForSelector('.model-option', { timeout: 30000 });
  await page.locator('.search-mini').fill(MODEL_ID);
  await page.locator('.model-option', { hasText: MODEL_ID }).first().click();
  await page.waitForSelector('.selected-model', { timeout: 10000 });
  result.modelUi.optionCountAfterSelect = await page.locator('.model-option').count();
  result.modelUi.selectedText = await page.locator('.selected-model').innerText();
  const modelShot = `D:/VSAI/myna/test/qwe-model-${stamp}.png`;
  await page.screenshot({ path: modelShot, fullPage: true });
  result.screenshots.model = modelShot;
  await page.getByText('创建').click();
  await page.waitForTimeout(1000);
  const models = (await api('/admin/models')).result || [];
  const config = models.find(m => m.name === `QWE OPUS ${stamp}`);
  if (!config) throw new Error('model config was not created');
  result.modelUi.createdConfig = {
    id: config.id,
    name: config.name,
    base_url: config.base_url,
    model: config.model,
    max_tokens: config.max_tokens,
  };

  // Fast setup through API: two agents, one room, handoff rule.
  const dev = (await api('/admin/agents', {
    method: 'POST',
    body: JSON.stringify({
      name: `OPUS开发${stamp}`,
      description: '你是开发智能体。回复必须简短。完成后必须包含“完成”，并说明交给测试复核。不要使用工具。',
    }),
  })).result;
  const test = (await api('/admin/agents', {
    method: 'POST',
    body: JSON.stringify({
      name: `OPUS测试${stamp}`,
      description: '你是测试智能体。收到交接后只回复一句：测试收到，开始复核。不要使用工具。',
    }),
  })).result;
  await api(`/admin/agents/${dev.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: dev.name, description: '你是开发智能体。回复必须简短。完成后必须包含“完成”，并说明交给测试复核。不要使用工具。', model_config_id: config.id }),
  });
  await api(`/admin/agents/${test.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: test.name, description: '你是测试智能体。收到交接后只回复一句：测试收到，开始复核。不要使用工具。', model_config_id: config.id }),
  });
  const room = (await api('/admin/rooms', {
    method: 'POST',
    body: JSON.stringify({ name: `OPUS群聊${stamp}`, description: '开发完成后交给测试复核。', type: 'group' }),
  })).result;
  await api(`/admin/rooms/${room.id}/members`, { method: 'POST', body: JSON.stringify({ agent_ids: [dev.id, test.id] }) });
  await api(`/admin/rooms/${room.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      description: '开发完成后交给测试复核。',
      settings_json: {
        max_chain_depth: 4,
        context_messages_limit: 20,
        collaboration_guide: `开发完成后必须交给 @${test.name} 复核。`,
        handoff_rules: [{ source: dev.name, target: test.name, keywords: ['完成'], trigger: '开发回复包含完成后' }],
        workspace_path: '',
      },
    }),
  });
  result.setup = { dev, test, room, configId: config.id };

  // Browser path: open room and send @ mention.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(room.name).click();
  await page.locator('.input-bar textarea').fill(`@${dev.name}，请回复“完成”，然后交给测试。`);
  await page.keyboard.press('Enter');
  const mentionReqDeadline = Date.now() + 10000;
  let sendPayload = null;
  while (Date.now() < mentionReqDeadline && !sendPayload) {
    const req = [...requests].reverse().find(r => r.url.endsWith(`/admin/rooms/${room.id}/send`));
    if (req?.postData) sendPayload = JSON.parse(req.postData);
    await sleep(200);
  }
  const mentionRes = await waitForAgentMessage(room.id, dev.id, 0, 120000);
  result.mention = {
    sendPayload,
    parsedOk: Array.isArray(sendPayload?.mentions) && sendPayload.mentions.includes(dev.id),
    replied: !!mentionRes.message,
    reply: mentionRes.message?.text || null,
  };

  // Chain/handoff: expect test agent after dev reply because dev reply contains 完成.
  const chainRes = await waitForMessages(room.id, [dev.id, test.id], 0, 180000);
  result.chain = {
    seenDev: chainRes.seen.includes(dev.id),
    seenTest: chainRes.seen.includes(test.id),
    messages: chainRes.all.map(m => ({ id: m.id, sender_id: m.sender_id, sender_name: m.sender_name, text: String(m.text || '').slice(0, 220), mentions: m.mentions })),
  };
  const chainShot = `D:/VSAI/myna/test/qwe-chain-${stamp}.png`;
  await page.screenshot({ path: chainShot, fullPage: true });
  result.screenshots.chain = chainShot;

  // Interrupt: ask dev for long response, then interrupt with another message.
  const beforeInterrupt = chainRes.all.length ? Math.max(...chainRes.all.map(m => m.id)) : 0;
  await page.locator('.input-bar textarea').fill(`@${dev.name}，请写一个尽量长的三段分析，慢慢展开。`);
  await page.keyboard.press('Enter');
  await sleep(1800);
  await page.locator('.input-bar textarea').fill(`@${dev.name}，打断上一条，改为只回复：新的请求收到。`);
  await page.keyboard.press('Enter');
  await sleep(2500);
  const bodyAfterInterrupt = await page.locator('body').innerText();
  const interruptRes = await waitForAgentMessage(room.id, dev.id, beforeInterrupt, 150000);
  const finalBody = await page.locator('body').innerText();
  const interruptShot = `D:/VSAI/myna/test/qwe-interrupt-${stamp}.png`;
  await page.screenshot({ path: interruptShot, fullPage: true });
  result.screenshots.interrupt = interruptShot;
  result.interrupt = {
    sawInterruptedLabel: bodyAfterInterrupt.includes('已中断') || finalBody.includes('已中断'),
    newReplySeen: !!interruptRes.message,
    reply: interruptRes.message?.text || null,
    bodyTail: finalBody.slice(-1200),
  };

  result.passed = {
    modelUi: result.modelUi.optionCountAfterSelect === 0 && result.modelUi.createdConfig?.model === MODEL_ID,
    mention: result.mention.parsedOk && result.mention.replied,
    chain: result.chain.seenDev && result.chain.seenTest,
    interrupt: result.interrupt.sawInterruptedLabel && result.interrupt.newReplySeen,
  };
  result.consoleLogs = consoleLogs.slice(-30);

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
