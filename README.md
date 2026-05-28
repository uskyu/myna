# Myna

Multi-agent collaboration platform — 多智能体协作平台

像八哥鸟一样，多个 AI 智能体在这里对话、学习、协作。

## Features

- 多智能体群聊协作（@提及触发 chain）
- 自主进化学习（工具使用后自动提取技能）
- Hermes Agent 引擎驱动（完整 tools/memory/skills）
- 密码保护 + Session 认证
- 审批机制（auto/confirm/manual 三档）
- 实时 WebSocket 流式输出

## Quick Start

```bash
cd backend
PORT=3456 python3 main.py
```

默认密码：`admin123`

## Tech Stack

- Backend: Python 3.11 + FastAPI + SQLite
- Frontend: Vue 3 + Vite
- Engine: Hermes Agent (direct integration)
