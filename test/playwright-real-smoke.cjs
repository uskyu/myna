const { chromium } = require('playwright');

const BASE = process.env.MYNA_BASE || 'http://localhost:3457';
const TOKEN = process.env.MYNA_TOKEN || '';
const API_BASE = process.env.MIMO_BASE || 'https://token-plan-cn.xiaomimimo.com/v1';
const API_KEY = process.env.MIMO_KEY || '';

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
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { ok: false, raw: text };
  }
  if (!res.ok) {
    throw new Error(`${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

async function prepareMentionTarget() {
  const stamp = Date.now().toString(36);
  const agentName = `PW真实Agent${stamp}`;
  const roomName = `PW真实提及测试${stamp}`;
  const agentRes = await api('/admin/agents', {
    method: 'POST',
    body: JSON.stringify({
      name: agentName,
      description: '你是一个极简测试智能体。收到消息后只回复一句“收到提及测试”。不要使用工具。',
    }),
  });
  const agent = agentRes.result;
  const roomRes = await api('/admin/rooms', {
    method: 'POST',
    body: JSON.stringify({ name: roomName, description: '真实浏览器提及测试', type: 'group' }),
  });
  const room = roomRes.result;
  await api(`/admin/rooms/${room.id}/members`, {
    method: 'POST',
    body: JSON.stringify({ agent_id: agent.id }),
  });
  return { agent, room };
}

async function main() {
  if (!TOKEN) throw new Error('MYNA_TOKEN is required');
  if (!API_KEY) throw new Error('MIMO_KEY is required');

  const browser = await chromium.launch({ headless: false, slowMo: 60 });
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

  await page.locator('[title="设置"]').click();
  await page.getByText('供应商管理').click();
  await page.getByText('新增供应商').click();
  await page.locator('input[placeholder*="OpenAI"]').fill('PW Mimo smoke');
  await page.locator('input[placeholder="https://api.openai.com/v1"]').fill(API_BASE);
  await page.locator('input[placeholder="sk-..."]').fill(API_KEY);
  await page.getByText('获取模型列表').click();
  await page.waitForSelector('.model-option', { timeout: 30000 });
  const optionCountBefore = await page.locator('.model-option').count();
  const firstOption = await page.locator('.model-option .opt-id').first().innerText();
  await page.locator('.model-option').first().click();
  await page.waitForSelector('.selected-model', { timeout: 10000 });
  await sleep(800);
  const optionCountAfter = await page.locator('.model-option').count();
  const selectedText = await page.locator('.selected-model').innerText();
  const modelModalShot = `D:/VSAI/myna/test/model-modal-${Date.now()}.png`;
  await page.screenshot({ path: modelModalShot, fullPage: true });
  await page.locator('.close-x').click();

  const { agent, room } = await prepareMentionTarget();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(room.name).click();
  await page.locator('.input-bar textarea').fill(`@${agent.name}，你好，请回复“收到提及测试”。`);
  await page.keyboard.press('Enter');
  await sleep(1200);

  const sendReq = [...requests].reverse().find(r => r.url.endsWith(`/admin/rooms/${room.id}/send`));
  let sendPayload = null;
  if (sendReq?.postData) {
    try {
      sendPayload = JSON.parse(sendReq.postData);
    } catch {}
  }

  let streamStarted = false;
  let aiReplySeen = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const messages = await api(`/admin/rooms/${room.id}/messages?limit=20`);
    const rows = messages.result || [];
    streamStarted = streamStarted || rows.some(m => m.sender_id === agent.id);
    aiReplySeen = rows.some(m => m.sender_id === agent.id && String(m.text || '').length > 0);
    if (aiReplySeen) break;
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (bodyText.includes('生成中') || bodyText.includes('思考中') || bodyText.includes(agent.name)) {
      streamStarted = true;
    }
    await sleep(2500);
  }
  const mentionShot = `D:/VSAI/myna/test/mention-${Date.now()}.png`;
  await page.screenshot({ path: mentionShot, fullPage: true });

  const messages = await api(`/admin/rooms/${room.id}/messages?limit=20`);
  const result = {
    modelList: {
      optionCountBefore,
      firstOption,
      optionCountAfter,
      selectedText,
      passed: optionCountBefore > 0 && optionCountAfter === 0 && selectedText.includes(firstOption),
      screenshot: modelModalShot,
    },
    mention: {
      agentName: agent.name,
      roomName: room.name,
      sendPayload,
      parsedMentionIds: sendPayload?.mentions || [],
      expectedAgentId: agent.id,
      streamStarted,
      aiReplySeen,
      lastMessages: (messages.result || []).map(m => ({
        id: m.id,
        sender_id: m.sender_id,
        sender_name: m.sender_name,
        text: String(m.text || '').slice(0, 160),
        mentions: m.mentions,
      })),
      passed: Array.isArray(sendPayload?.mentions) && sendPayload.mentions.includes(agent.id) && aiReplySeen,
      screenshot: mentionShot,
    },
    consoleLogs: consoleLogs.slice(-20),
  };
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
