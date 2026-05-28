/**
 * Built-in tools for AI agents.
 * Each tool has: definition (OpenAI function schema) + execute function.
 */

const fs = require('fs');
const { execSync } = require('child_process');

// Tool definitions (OpenAI function calling format)
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: '在服务器上执行 shell 命令。超时 30 秒，输出限制 4000 字符。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的 shell 命令'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取服务器上的文件内容（限制 4000 字符）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径' },
          offset: { type: 'integer', description: '起始行号（从 1 开始），默认 1' },
          limit: { type: 'integer', description: '读取行数，默认 100' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '写入或覆盖文件内容。自动创建父目录。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径' },
          content: { type: 'string', description: '要写入的完整内容' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'http_request',
      description: '发送 HTTP 请求（GET/POST/PUT/DELETE），获取 API 数据或网页内容。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '请求 URL' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: '请求方法，默认 GET' },
          headers: { type: 'object', description: '请求头（键值对）' },
          body: { type: 'string', description: '请求体（POST/PUT 时使用）' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: '在目录中搜索文件内容或文件名',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '搜索模式（正则表达式）' },
          path: { type: 'string', description: '搜索目录，默认当前目录' },
          target: { type: 'string', enum: ['content', 'files'], description: 'content=搜索文件内容, files=搜索文件名' }
        },
        required: ['pattern']
      }
    }
  }
];

// Command blocklist for safety
const BLOCKED_PATTERNS = [
  /rm\s+(-[a-z]*[rf]|--recursive)\s+[\/~]/i,
  /rm\s+[\/~]/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\(\)\s*\{/,       // fork bomb
  /fork\s*bomb/i,
  />\s*\/dev\/sd/i,   // overwrite disk
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\binit\s+0/i,
  /\bchmod\s+777\s+\//i,
  /\bchown\b.*\//i,
  /\bkill\s+-9\s+1\b/i,  // kill init
  /\bwget\b.*\|\s*sh/i,  // pipe to shell
  /\bcurl\b.*\|\s*(sh|bash)/i,
  /\bnc\s+-l/i,          // netcat listener
  /\bpython[23]?\s+-c.*import\s+os.*system/i,
];

const SENSITIVE_PATHS = ['/etc/shadow', '/root/.ssh/id_rsa', '/proc/self'];

// Tool executors
const executors = {
  run_command(args, opts = {}) {
    const cmd = args.command || '';
    // In 'auto' mode with no safety restrictions, skip blocklist
    if (opts.executionMode !== 'auto') {
      if (BLOCKED_PATTERNS.some(p => p.test(cmd))) {
        return { ok: false, output: '⚠️ 该命令被安全策略阻止。如需执行，请将智能体设为「全自动」模式。' };
      }
    }
    try {
      const output = execSync(cmd, { timeout: 30000, maxBuffer: 100 * 1024, encoding: 'utf8' });
      return { ok: true, output: (output || '(命令执行成功，无输出)').slice(0, 4000) };
    } catch (e) {
      if (e.stdout || e.stderr) {
        return { ok: false, output: ((e.stdout || '') + (e.stderr || '')).slice(0, 4000) };
      }
      return { ok: false, output: `执行错误: ${e.message}`.slice(0, 1000) };
    }
  },

  read_file(args) {
    const filePath = args.path || '';
    if (SENSITIVE_PATHS.some(p => filePath.startsWith(p))) {
      return { ok: false, output: '⚠️ 该文件路径被安全策略阻止' };
    }
    if (!fs.existsSync(filePath)) {
      return { ok: false, output: `文件不存在: ${filePath}` };
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const offset = Math.max(1, args.offset || 1);
      const limit = Math.min(200, args.limit || 100);
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      const numbered = slice.map((l, i) => `${offset + i}|${l}`).join('\n');
      return { ok: true, output: numbered.slice(0, 4000), total_lines: lines.length };
    } catch (e) {
      return { ok: false, output: `读取错误: ${e.message}` };
    }
  },

  write_file(args) {
    const filePath = args.path || '';
    const content = args.content || '';
    if (SENSITIVE_PATHS.some(p => filePath.startsWith(p))) {
      return { ok: false, output: '⚠️ 该文件路径被安全策略阻止' };
    }
    // Prevent AI from overwriting project source files
    const projectDir = require('path').resolve(__dirname, '..', '..');
    const resolved = require('path').resolve(filePath);
    if (resolved.startsWith(projectDir + '/src/') || resolved.startsWith(projectDir + '/frontend/')) {
      return { ok: false, output: '⚠️ 不允许写入项目源代码目录。请写入 /tmp/ 或 data/uploads/ 目录。' };
    }
    try {
      const dir = require('path').dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
      return { ok: true, output: `已写入 ${filePath} (${content.length} 字符)` };
    } catch (e) {
      return { ok: false, output: `写入错误: ${e.message}` };
    }
  },

  async http_request(args) {
    const url = args.url || '';
    const method = (args.method || 'GET').toUpperCase();
    const headers = args.headers || {};
    const body = args.body || undefined;

    try {
      const opts = {
        method,
        headers: { ...headers },
        signal: AbortSignal.timeout(15000)
      };
      if (body && (method === 'POST' || method === 'PUT')) {
        opts.body = body;
        if (!opts.headers['Content-Type'] && !opts.headers['content-type']) {
          opts.headers['Content-Type'] = 'application/json';
        }
      }
      const resp = await fetch(url, opts);
      const text = await resp.text();
      return {
        ok: resp.ok,
        output: `HTTP ${resp.status}\n${text.slice(0, 4000)}`,
        status: resp.status
      };
    } catch (e) {
      return { ok: false, output: `请求错误: ${e.message}` };
    }
  },

  search_files(args) {
    const pattern = args.pattern || '';
    const searchPath = args.path || '.';
    const target = args.target || 'content';

    try {
      let cmd;
      if (target === 'files') {
        cmd = `find ${searchPath} -name "${pattern}" -type f 2>/dev/null | head -30`;
      } else {
        cmd = `grep -rn "${pattern}" ${searchPath} --include="*" 2>/dev/null | head -30`;
      }
      const output = execSync(cmd, { timeout: 10000, maxBuffer: 50 * 1024, encoding: 'utf8' });
      return { ok: true, output: (output || '(无匹配结果)').slice(0, 4000) };
    } catch (e) {
      if (e.stdout) return { ok: true, output: (e.stdout || '(无匹配结果)').slice(0, 4000) };
      return { ok: false, output: `搜索错误: ${e.message}` };
    }
  }
};

/**
 * Execute a tool by name.
 * @returns {Promise<{ok: boolean, output: string}>}
 */
async function executeTool(name, args, opts = {}) {
  const executor = executors[name];
  if (!executor) return { ok: false, output: `未知工具: ${name}` };
  try {
    const result = await executor(args, opts);
    return result;
  } catch (e) {
    return { ok: false, output: `工具执行异常: ${e.message}`.slice(0, 1000) };
  }
}

/**
 * Get a short summary of tool call for UI display
 */
function toolCallSummary(name, args) {
  switch (name) {
    case 'run_command':
      return args.command ? args.command.slice(0, 80) : '';
    case 'read_file':
      return args.path || '';
    case 'write_file':
      return args.path || '';
    case 'http_request':
      return `${args.method || 'GET'} ${args.url || ''}`.slice(0, 80);
    case 'search_files':
      return `${args.target || 'content'}: ${args.pattern || ''}`;
    default:
      return JSON.stringify(args).slice(0, 60);
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool, toolCallSummary };
