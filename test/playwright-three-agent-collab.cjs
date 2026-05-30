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
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${text.slice(0, 500)}`);
  return json;
}

async function waitForRoomMessages(roomId, predicate, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  let all = [];
  while (Date.now() < deadline) {
    const data = await api(`/admin/rooms/${roomId}/messages?limit=100`);
    all = data.result || [];
    if (predicate(all)) return all;
    await sleep(3000);
  }
  return all;
}

async function ensureModelConfig(page, stamp) {
  const existing = ((await api('/admin/models')).result || []).find(m => (
    m.base_url === QWE_BASE && m.model === MODEL_ID && Number(m.max_tokens || 0) <= 8192
  ));
  if (existing) return existing;

  await page.locator('[title="设置"]').click();
  await page.getByText('供应商管理').click();
  await page.getByText('新增供应商').click();
  await page.locator('input[placeholder*="OpenAI"]').fill(`QWE OPUS 三人协作 ${stamp}`);
  await page.locator('input[placeholder="https://api.openai.com/v1"]').fill(QWE_BASE);
  await page.locator('input[placeholder="sk-..."]').fill(QWE_KEY);
  await page.getByText('获取模型列表').click();
  await page.waitForSelector('.model-option', { timeout: 45000 });
  await page.locator('.search-mini').fill(MODEL_ID);
  await page.locator('.model-option', { hasText: MODEL_ID }).first().click();
  await page.waitForSelector('.selected-model', { timeout: 10000 });
  const optionCountAfterSelect = await page.locator('.model-option').count();
  await page.getByText('创建').click();
  await sleep(1000);

  const created = ((await api('/admin/models')).result || []).find(m => m.name === `QWE OPUS 三人协作 ${stamp}`);
  if (!created) throw new Error('model config was not created through UI');
  created._optionCountAfterSelect = optionCountAfterSelect;
  return created;
}

async function main() {
  if (!TOKEN) throw new Error('MYNA_TOKEN is required');
  if (!QWE_KEY) throw new Error('QWE_KEY is required');

  const stamp = Date.now().toString(36);
  const result = {
    base: BASE,
    model: {},
    setup: {},
    request: {},
    collaboration: {},
    screenshots: {},
    passed: {},
  };

  const browser = await chromium.launch({ headless: false, slowMo: 35 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const requests = [];
  const consoleLogs = [];
  page.on('request', req => {
    if (req.url().includes('/admin/')) requests.push({ method: req.method(), url: req.url(), postData: req.postData() });
  });
  page.on('console', msg => consoleLogs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => consoleLogs.push(`pageerror: ${err.message}`));

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(token => localStorage.setItem('hub_auth_token', token), TOKEN);
    await page.reload({ waitUntil: 'networkidle' });

    const config = await ensureModelConfig(page, stamp);
    result.model = {
      id: config.id,
      name: config.name,
      base_url: config.base_url,
      model: config.model,
      max_tokens: config.max_tokens,
      optionCountAfterSelect: config._optionCountAfterSelect,
    };

    const pmName = `产品经理${stamp}`;
    const devName = `程序开发${stamp}`;
    const qaName = `程序测试${stamp}`;

    const pmDesc = [
      '你是产品经理。回复必须简短。',
      `当用户给你需求时，先拆成验收标准，然后必须主动 @${devName} 请求开发实现。`,
      `开发和测试都完成后，主动总结状态给用户。`,
      '每次转交都要在正文里清楚写出 @目标名字，方便群聊里看见协作痕迹。不要使用工具。',
    ].join('\n');
    const devDesc = [
      '你是程序开发。回复必须简短。',
      `收到产品经理交付后，说明实现方案，并且必须包含“开发完成”。`,
      `完成后必须主动 @${qaName} 请求测试复核。`,
      '每次转交都要在正文里清楚写出 @目标名字。不要使用工具。',
    ].join('\n');
    const qaDesc = [
      '你是程序测试。回复必须简短。',
      `收到开发交付后，输出测试结论，并且必须包含“测试通过”。`,
      `完成后必须主动 @${pmName} 回报测试结果。`,
      '每次转交都要在正文里清楚写出 @目标名字。不要使用工具。',
    ].join('\n');

    const pm = (await api('/admin/agents', {
      method: 'POST',
      body: JSON.stringify({ name: pmName, description: pmDesc }),
    })).result;
    const dev = (await api('/admin/agents', {
      method: 'POST',
      body: JSON.stringify({ name: devName, description: devDesc }),
    })).result;
    const qa = (await api('/admin/agents', {
      method: 'POST',
      body: JSON.stringify({ name: qaName, description: qaDesc }),
    })).result;

    for (const [agent, desc] of [[pm, pmDesc], [dev, devDesc], [qa, qaDesc]]) {
      await api(`/admin/agents/${agent.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: agent.name,
          description: desc,
          model_config_id: config.id,
          tools_config: {
            disabled_toolsets: ['terminal', 'file', 'http', 'browser', 'memory', 'skills'],
            preferred_tools: '本轮测试不要使用工具，只通过群聊文字协作。',
          },
        }),
      });
    }

    const roomGuide = [
      '目标：模拟一个小功能从需求澄清到开发实现再到测试验收的群聊协作。',
      `流程：用户只 @${pmName}。${pmName} 必须主动 @${devName}；${devName} 完成后必须主动 @${qaName}；${qaName} 测试通过后必须主动 @${pmName}。`,
      '所有智能体在交接时都要把 @目标名字 写在正文里，不要只在后台触发。',
      '回复控制在 80 字以内，避免长篇输出。',
    ].join('\n');

    const room = (await api('/admin/rooms', {
      method: 'POST',
      body: JSON.stringify({
        name: `三人协作群${stamp}`,
        description: '三智能体链式协作真实浏览器测试',
        type: 'group',
      }),
    })).result;
    await api(`/admin/rooms/${room.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ agent_ids: [pm.id, dev.id, qa.id] }),
    });
    await api(`/admin/rooms/${room.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        description: '三智能体链式协作真实浏览器测试',
        settings_json: {
          max_chain_depth: 6,
          context_messages_limit: 30,
          collaboration_guide: roomGuide,
          handoff_rules: [
            {
              source: pm.name,
              target: dev.name,
              keywords: ['验收标准', '开发', `@${dev.name}`],
              trigger: '产品经理完成需求拆解后',
              instruction: '开始实现，并在完成后交给测试。',
            },
            {
              source: dev.name,
              target: qa.name,
              keywords: ['开发完成', '完成', `@${qa.name}`],
              trigger: '开发完成后',
              instruction: '执行测试复核。',
            },
            {
              source: qa.name,
              target: pm.name,
              keywords: ['测试通过', '通过', `@${pm.name}`],
              trigger: '测试通过后',
              instruction: '汇总验收状态给用户。',
            },
          ],
          workspace_path: '',
        },
      }),
    });

    result.setup = {
      room: { id: room.id, name: room.name },
      agents: [
        { id: pm.id, name: pm.name },
        { id: dev.id, name: dev.name },
        { id: qa.id, name: qa.name },
      ],
      guide: roomGuide,
    };

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText(room.name).click();
    const prompt = `@${pm.name}，请组织一个“登录页记住我开关”的小功能协作：先给验收标准，再交给开发，再交给测试。`;
    await page.locator('.input-bar textarea').fill(prompt);
    await page.keyboard.press('Enter');

    const sendReqDeadline = Date.now() + 10000;
    let sendPayload = null;
    while (Date.now() < sendReqDeadline && !sendPayload) {
      const req = [...requests].reverse().find(r => r.url.endsWith(`/admin/rooms/${room.id}/send`));
      if (req?.postData) sendPayload = JSON.parse(req.postData);
      await sleep(200);
    }
    result.request = {
      prompt,
      sendPayload,
      frontendParsedMentionOk: Array.isArray(sendPayload?.mentions) && sendPayload.mentions.includes(pm.id),
    };

    const finalMessages = await waitForRoomMessages(room.id, messages => {
      const senders = new Set(messages.map(m => m.sender_id));
      return senders.has(pm.id) && senders.has(dev.id) && senders.has(qa.id)
        && messages.filter(m => m.sender_id === pm.id).length >= 2;
    });

    const relevant = finalMessages
      .filter(m => [pm.id, dev.id, qa.id, 'user'].includes(m.sender_id))
      .map(m => ({
        id: m.id,
        sender_id: m.sender_id,
        sender_name: m.sender_name,
        text: String(m.text || ''),
        mentions: m.mentions || [],
      }));

    const pmFirst = relevant.find(m => m.sender_id === pm.id);
    const devMsg = relevant.find(m => m.sender_id === dev.id);
    const qaMsg = relevant.find(m => m.sender_id === qa.id);
    const pmFinal = [...relevant].reverse().find(m => m.sender_id === pm.id && m.id !== pmFirst?.id);

    result.collaboration = {
      messages: relevant,
      pmFirstVisibleAtDev: !!pmFirst?.text.includes(`@${dev.name}`),
      pmFirstMentionMetadataDev: !!pmFirst?.mentions?.includes(dev.id),
      devVisibleAtQa: !!devMsg?.text.includes(`@${qa.name}`),
      devMentionMetadataQa: !!devMsg?.mentions?.includes(qa.id),
      qaVisibleAtPm: !!qaMsg?.text.includes(`@${pm.name}`),
      qaMentionMetadataPm: !!qaMsg?.mentions?.includes(pm.id),
      pmFinalSeen: !!pmFinal,
      bodyTail: (await page.locator('body').innerText()).slice(-1800),
    };

    const shot = `D:/VSAI/myna/test/three-agent-collab-${stamp}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    result.screenshots.collaboration = shot;

    result.passed = {
      modelUiCollapse: result.model.optionCountAfterSelect === undefined || result.model.optionCountAfterSelect === 0,
      firstMentionParsed: result.request.frontendParsedMentionOk,
      allThreeAgentsReplied: !!pmFirst && !!devMsg && !!qaMsg,
      chainReturnedToPm: !!pmFinal,
      visibleHandOffs: result.collaboration.pmFirstVisibleAtDev && result.collaboration.devVisibleAtQa && result.collaboration.qaVisibleAtPm,
      metadataHandOffs: result.collaboration.pmFirstMentionMetadataDev && result.collaboration.devMentionMetadataQa && result.collaboration.qaMentionMetadataPm,
    };
    result.consoleLogs = consoleLogs.slice(-30);

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
