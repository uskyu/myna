# hermes-hub UI/UX 全面改造计划

**分支**: `fix/ui-ux-overhaul`
**状态**: 诊断完成，待实施

---

## 项目架构概览

- **前端**: 纯 vanilla JS SPA，无框架
  - `src/web/public/index.html` (42KB, 582行) — HTML + CSS
  - `src/web/public/app.js` (49KB, 1136行) — 全局状态 + DOM 操作
- **后端**: Node.js + Express + WebSocket
  - SQLite (开发) / MySQL (生产) 双驱动
  - 数据流: REST CRUD + WebSocket 推送流式 AI 响应
- **总代码量**: ~2200 行后端 + ~1700 行前端

---

## 🔴 P0 严重问题

### 1. CSS 变量 `--primary` 未定义
**位置**: app.js:111, 113, 114
**影响**: AI 打字光标 `▊` 和打字动画点颜色回退到浏览器默认（可能不可见）
**修复**: 改为 `var(--accent)` 或在 CSS 中定义 `--primary`

### 2. 回到主界面不显示活跃群聊/智能体状态
**位置**: `closeChat()` (app.js:214)
**问题**: 关闭聊天后只是隐藏 overlay，不刷新会话列表。用户无法看到哪个群聊正在进行 AI 对话。
**修复**: `closeChat()` 中调用 `loadConversations()` + `loadAgents()`，并在会话列表中高亮显示有活跃 AI 生成的房间

### 3. 无 admin 路由认证
**位置**: 全部 `/admin/*` 路由
**问题**: `SECRET_KEY` 默认值 `'change-me-to-a-random-string'` 时跳过认证，所有管理接口裸奔
**修复**: 启动时强制要求设置 SECRET_KEY，或默认启用认证

### 4. 群聊自动回复逻辑过于激进
**位置**: ai/index.js:326
**问题**: 群聊中每条用户消息会触发**所有在线 AI 智能体**回复（chainDepth=0 时）
**修复**: 改为只在 @mention 时触发，或配置 auto-reply 白名单

---

## 🟠 P1 UI 问题

### 5. 智能体列表设计粗糙
- 卡片触摸目标 < 44px（Apple/Google 推荐最小值）
- 无搜索/过滤功能
- 排序功能已编码 (`sortAgents()`) 但 UI 上无入口触发
- 无智能体状态实时指示

### 6. AI 加载气泡不美观
- 打字动画三点弹跳 (`typing-dots`) 颜色依赖未定义的 `--primary`
- 流式输出无消息渐入动画，直接 innerHTML 替换
- 无消息分组（按时间/发送者）
- 流式结束后的最终消息需要 500ms 延迟才刷新，有闪烁

### 7. 手机适配差
- **仅 1 条媒体查询**（只针对 modal 居中），主布局、聊天、智能体网格无响应式断点
- 无平板/桌面适配
- 无横屏处理
- 代码块暗色主题 (`#1e1e2e`) 不随主题切换

### 8. 格式问题严重
- 用户消息不支持 markdown（只有图片/链接才走 markdown）
- 代码块无语法高亮
- 无自动链接检测
- marked.js 渲染后图片处理有 XSS 风险
- `escapeHtml()` 不转义引号，可被属性注入

---

## 🟡 P2 功能缺陷

### 9. `/clear` 命令仅前端
**位置**: app.js:388 — 显示 "仅前端" toast，不清理后端消息

### 10. 工具列表硬编码
**位置**: HTML:404-408 — agent 详情页 "工具" 固定显示 `run_command` 和 `read_file`，不反映实际配置

### 11. Polling 和 WebSocket 冲突
- 2秒轮询 + WebSocket 推送同时运行
- `new_message` WS 事件触发 500ms 延迟刷新，可能导致消息重复/闪烁

### 12. `setWebhook` 未实现
**位置**: gateway/index.js:140-144 — 返回 "coming soon"

### 13. MySQL 适配器大量方法缺失
- 缺少 `updateAgent()`, `getDMRoom()`, `listDMRooms()`, 所有 `model_configs` 方法
- `createRoom` 缺少 `type` 参数，DM 房间默认为 'group'

### 14. `run_command` 安全性弱
- 命令黑名单可被变体绕过（如 `rm -r -f /` 替代 `rm -rf /`）

---

## 🟢 P3 代码质量

### 15. 全局状态，无模块化
- 所有变量全局可变，无封装

### 16. 全量 innerHTML 重渲染
- 无 DOM diffing，每次更新完全替换，滚动位置丢失，选择被取消

### 17. 魔法延时
- `setTimeout(..., 100)` (line 557), `setTimeout(..., 200)` (line 631), `setTimeout(..., 500)` (line 1130)

### 18. 无错误处理
- 大多数 API 调用不检查 `data.ok`，失败时无提示

### 19. SVG 图标重复
- `AGENT_ICONS` 在 JS 中定义一次，HTML 中又内联重复

### 20. 硬编码中文字符串
- 无 i18n，所有文本直接写在代码中

---

## 建议的改造方案

### 方案 A: 原地修补 (推荐先做)
在现有 vanilla JS 基础上修 bug + 改 UI，不换框架。
- 优点: 快速见效，改动可控
- 缺点: 代码质量天花板低

### 方案 B: 前端重构
引入轻量框架（Vue 3 / Preact）重构前端。
- 优点: 可维护性大幅提升
- 缺点: 工作量大

### 建议路径
1. **Phase 1**: 修 P0 + P1 bug（原地修补，1-2 天）
2. **Phase 2**: 手机适配 + 美化气泡和列表（CSS 重写）
3. **Phase 3**: 功能补全（clear、sort UI、webhook）
4. **Phase 4**: 后端修复（MySQL 适配器、安全加固）
5. **Phase 5** (可选): 前端框架迁移

---

## 开发效率工具建议

1. **code2prompt** — 一键将整个项目打包成 LLM 可读格式，方便 AI 代码审查
2. **ast-grep** — AST 级别的代码搜索/替换，比 grep 精准得多
3. **knip** — 找出未使用的代码和依赖
4. **Lighthouse** — 手机端性能和可访问性审计
