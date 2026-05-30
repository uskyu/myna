"""
AI Engine - Integrates Hermes Agent (AIAgent) directly as the intelligence layer.
Each agent gets its own Hermes profile with independent memory, skills, and tools.
"""
import os
import sys
import json
import re
import asyncio
import traceback
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from workspaces import get_room_workspace_dir

# Hermes Agent imports
HERMES_PATH = Path("/root/hermes")
sys.path.insert(0, str(HERMES_PATH))

try:
    from run_agent import AIAgent
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    HERMES_AVAILABLE = True
except ImportError:
    HERMES_AVAILABLE = False
    print("[AI] WARNING: Hermes Agent not importable, falling back to direct API calls")

# Thread pool for running sync Hermes Agent calls
# Default 10, configurable via hub_settings 'agent_concurrency'
def _get_concurrency_limit():
    try:
        import sqlite3
        from pathlib import Path
        db_path = Path(__file__).parent.parent / "db" / "myna.sqlite"
        if not db_path.exists():
            db_path = Path(__file__).parent.parent / "db" / "hermes-hub.sqlite"
        if db_path.exists():
            conn = sqlite3.connect(str(db_path))
            row = conn.execute("SELECT value FROM hub_settings WHERE key = 'agent_concurrency'").fetchone()
            conn.close()
            if row and int(row[0]) > 0:
                return int(row[0])
    except:
        pass
    return 10

_executor = ThreadPoolExecutor(max_workers=_get_concurrency_limit())

# Pending approval requests: approval_id -> callback(decision)
_pending_approvals: dict = {}


def _estimate_tokens(text: str) -> int:
    """粗略估算 token 数（中文按字符数，英文按单词数 * 1.3）"""
    chinese_chars = len([c for c in text if '\u4e00' <= c <= '\u9fff'])
    other_chars = len(text) - chinese_chars
    return chinese_chars + int(other_chars / 4 * 1.3)


def _compress_history(history: list, keep_recent: int = 5, model_context_limit: int = 128000) -> list:
    """
    智能压缩对话历史，防止上下文爆炸。
    
    策略：
    1. 保留最近 keep_recent 轮完整对话
    2. 把更早的消息压缩成摘要
    3. 如果总 token 数仍超过 60% 上下文限制，进一步压缩
    
    Args:
        history: 原始对话历史 [{"role": "user/assistant", "content": "..."}]
        keep_recent: 保留最近几轮完整对话
        model_context_limit: 模型上下文限制（默认 128k）
    
    Returns:
        压缩后的 history
    """
    if not history or len(history) <= keep_recent:
        return history
    
    # 估算总 token 数
    total_tokens = sum(_estimate_tokens(m["content"]) for m in history)
    threshold = int(model_context_limit * 0.6)  # 60% 阈值
    
    if total_tokens < threshold:
        return history  # 不需要压缩
    
    print(f"[AI] Context压缩触发: {len(history)}条消息, 约{total_tokens}tokens (阈值{threshold}), 保留最近{keep_recent}轮")
    
    # 保留最近 N 轮
    recent = history[-keep_recent:]
    old = history[:-keep_recent]
    
    # 压缩旧消息：提取关键信息
    compressed_items = []
    for msg in old:
        content = msg["content"]
        # 提取文件路径
        files = re.findall(r'(?:^|\s)([/~][\w\-./]+\.\w+)', content)
        # 提取命令
        commands = re.findall(r'`([^`]{10,100})`', content)
        # 提取关键决策词
        decisions = re.findall(r'(已完成|已修改|已创建|已删除|已部署|成功|失败|错误)', content)
        
        summary_parts = []
        if files:
            summary_parts.append(f"文件: {', '.join(set(files[:3]))}")
        if commands:
            summary_parts.append(f"命令: {commands[0][:50]}")
        if decisions:
            summary_parts.append(f"状态: {', '.join(set(decisions[:3]))}")
        
        if summary_parts:
            compressed_items.append(" | ".join(summary_parts))
    
    # 构造压缩后的历史
    if compressed_items:
        summary_text = "\n".join([f"- {item}" for item in compressed_items[:10]])  # 最多保留 10 条摘要
        compressed_msg = {
            "role": "user",
            "content": f"[上下文摘要 — 早期对话已压缩]\n{summary_text}\n\n[以下是最近 {keep_recent} 轮完整对话]"
        }
        compressed_history = [compressed_msg] + recent
        compressed_tokens = sum(_estimate_tokens(m["content"]) for m in compressed_history)
        print(f"[AI] 压缩完成: {len(history)}条 → {len(compressed_history)}条, {total_tokens}tokens → {compressed_tokens}tokens")
        return compressed_history
    else:
        print(f"[AI] 压缩完成: 保留最近{keep_recent}轮")
        return recent



async def _noop_async(*args, **kwargs):
    pass


async def _wait_for_approval(event: asyncio.Event, timeout: float):
    """Wait for an approval event with timeout."""
    try:
        await asyncio.wait_for(event.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        pass


def resolve_approval(approval_id: str, decision: str):
    """Called by the API when user approves/denies a command."""
    cb = _pending_approvals.get(approval_id)
    if cb:
        cb(decision)

# Hub profiles root — each agent gets its own isolated profile
HUB_PROFILES_ROOT = Path("/root/.hermes/profiles")


def get_agent_profile_dir(agent_id: str) -> Path:
    """Get or create an isolated Hermes profile directory for a hub agent."""
    profile_dir = HUB_PROFILES_ROOT / f"hub-{agent_id[:12]}"
    profile_dir.mkdir(parents=True, exist_ok=True)
    # Ensure subdirectories exist
    (profile_dir / "memory").mkdir(exist_ok=True)
    (profile_dir / "skills").mkdir(exist_ok=True)
    (profile_dir / "sessions").mkdir(exist_ok=True)
    (profile_dir / "logs").mkdir(exist_ok=True)
    (profile_dir / "workspace").mkdir(exist_ok=True)
    return profile_dir


def _ensure_hub_agent_config(profile_dir: Path, base_url: str, api_key: str, model: str, exec_mode: str = "auto"):
    """Ensure the hub agent profile has a config.yaml with vision/auxiliary provider configured.
    
    exec_mode controls approvals:
      - 'auto': approvals.mode = off (YOLO, no prompts)
      - 'confirm': approvals.mode = manual (dangerous commands need approval via UI)
      - 'readonly': approvals.mode = off (tools are disabled at toolset level instead)
    """
    import yaml
    config_path = profile_dir / "config.yaml"
    env_path = profile_dir / ".env"

    # Map execution_mode to approvals.mode
    approval_mode = "off" if exec_mode in ("auto", "readonly") else "manual"

    # Only write if config doesn't exist or is outdated
    needs_update = False
    if not config_path.exists():
        needs_update = True
    else:
        try:
            existing = yaml.safe_load(config_path.read_text()) or {}
            prov = existing.get("providers", {}).get("hub", {})
            existing_approval = existing.get("approvals", {}).get("mode", "off")
            if prov.get("base_url") != base_url or existing_approval != approval_mode:
                needs_update = True
        except:
            needs_update = True

    if needs_update:
        config = {
            "model": {
                "provider": "custom:hub",
                "default": model,
            },
            "providers": {
                "hub": {
                    "base_url": base_url,
                    "key_env": "HUB_API_KEY",
                }
            },
            "approvals": {
                "mode": approval_mode,
            },
            "auxiliary": {
                "provider": "custom:hub",
            },
        }
        config_path.write_text(yaml.dump(config, default_flow_style=False, allow_unicode=True))

    # Write .env with API key
    env_content = f"HUB_API_KEY={api_key}\n"
    if not env_path.exists() or env_path.read_text().strip() != env_content.strip():
        env_path.write_text(env_content)


def get_hermes_config():
    """Read Hermes config for API credentials.
    Priority: env vars (AI_API_BASE/AI_API_KEY/AI_MODEL) > ~/.hermes/config.yaml
    """
    import yaml

    # Check environment variables first (Docker deployment)
    env_key = os.environ.get("AI_API_KEY", "")
    if env_key:
        return {
            "model": os.environ.get("AI_MODEL", "gpt-4o"),
            "base_url": os.environ.get("AI_API_BASE", "https://api.openai.com/v1"),
            "api_key": env_key,
        }

    config_path = Path.home() / ".hermes" / "config.yaml"
    env_path = Path.home() / ".hermes" / ".env"

    try:
        config = yaml.safe_load(config_path.read_text())
        provider = config.get("model", {}).get("provider", "")
        provider_name = provider.replace("custom:", "")
        provider_config = config.get("providers", {}).get(provider_name, {})
        key_env = provider_config.get("key_env", "")

        api_key = ""
        if key_env and env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith(f"{key_env}="):
                    api_key = line.split("=", 1)[1].strip().strip("\'" + '"')
                    break

        return {
            "model": config.get("model", {}).get("default", "gpt-4o"),
            "base_url": provider_config.get("base_url", "https://api.openai.com/v1"),
            "api_key": api_key,
        }
    except Exception as e:
        print(f"[AI] Config error: {e}")
        return None


def get_model_config_for_agent(db, agent: dict) -> dict | None:
    """Get the model config for an agent (agent-specific or default)."""
    config = None
    if agent.get("model_config_id"):
        config = db.get_model_config(agent["model_config_id"])
    if not config:
        config = db.get_default_model_config()
    return config


def build_system_prompt(agent: dict, room_type: str, other_agents: list = None, skills: list = None, room_settings: dict = None, room: dict = None) -> str:
    """Build system prompt for an agent."""
    tools_desc = """你拥有 Hermes Agent 引擎的完整能力：
- 执行系统命令（本地/SSH远程）
- 读写文件、搜索文件
- 发送HTTP请求、调用API
- 安装软件包（npm/pip/apt）
- 持久记忆（跨对话记住信息）
- 技能学习（从经验中提取可复用流程）
- 网页浏览（browser_navigate/browser_vision）和信息提取
- 截图并发送给用户（browser_vision 返回 screenshot_path，用 MEDIA: 前缀发送）

需要时主动使用工具。你可以接收服务器地址、密码、API密钥等信息并直接使用。

[terminal 工具硬性规则 — 违反会导致命令被拒绝]
1. 启动任何服务器/dev server/watch/preview 进程时，必须设置 background=true：
   terminal(command="npm run dev", background=true)
   terminal(command="python3 -m http.server 8080", background=true)
   terminal(command="vite preview", background=true)
   如果不设 background=true，命令会被系统拒绝并报错。
2. 绝对不要在命令末尾加 & 或使用 nohup/disown/setsid，这些也会被拒绝。
   用 background=true 参数代替。
3. 启动后台服务后，用 process(action="poll", session_id=xxx) 检查状态，
   或用单独的 terminal() 调用做 health check（如 curl localhost:port）。
4. rm/删除/写入等操作直接执行，不需要确认。
5. 长时间命令（npm install、build）设置 timeout=300。

[发送文件/图片给用户]
当你需要发送截图、生成的文件给用户时，在回复文本中包含 MEDIA:/绝对路径
例如：MEDIA:/root/.hermes/profiles/hub-xxx/workspace/output.zip
所有生成的文件（打包、导出、下载等）必须保存在当前工作目录下（即你的 workspace），
这样文件会被持久化保存，不会因为系统重启而丢失。
前端会自动渲染为内联图片或文件下载链接。"""

    base = agent.get("description", "")
    name = agent.get("name", "Assistant")

    if base:
        prompt = f"你是 {name}。{base}\n\n{tools_desc}"
    else:
        prompt = f"你是 {name}，一个全能智能助手。\n\n{tools_desc}"

    prompt += "\n\n回复使用 Markdown 格式，保持简洁专业。直接执行用户的指令。"

    room_settings = room_settings or {}
    room_description = (room or {}).get("description") or room_settings.get("room_description") or ""
    guide_text = room_settings.get("collaboration_guide", "")
    unified_guide = room_settings.get("room_guide") or ""
    if not unified_guide:
        unified_guide = "\n\n".join([s.strip() for s in [room_description, guide_text] if isinstance(s, str) and s.strip()])
    if unified_guide:
        prompt += f"""

[群聊目标与协作规则]
以下是用户为本群配置的目标、背景、角色分工和协作流程，所有智能体必须遵守：

{unified_guide.strip()}"""

    workspace_path = room_settings.get("__workspace_path") if isinstance(room_settings, dict) else None
    workspace_mode = room_settings.get("__workspace_mode") if isinstance(room_settings, dict) else None
    if workspace_path:
        prompt += f"""

[工作空间]
当前群聊/项目共享工作空间：{workspace_path}
工作空间模式：{'绑定目录' if workspace_mode == 'custom' else '默认群聊目录'}
- 所有本群智能体默认在这个共享工作空间内读写、运行命令和保存产物。
- 代码、测试报告、截图、导出文件等应优先放在该工作空间下。
- 不要把项目文件写到你的个人 Hermes profile 目录；profile 只用于记忆、技能和配置。
- 如果用户明确给出其他绝对路径，可按用户指定路径操作。"""

    # Slash command instructions
    prompt += """

[斜杠指令处理]
当用户发送以下指令时，按对应方式处理：
- /compact — 将之前的对话内容压缩为简洁摘要（保留关键决策、文件路径、代码变更），然后回复"✅ 上下文已压缩"并附上摘要。
- /summary — 总结当前对话的要点、完成的任务、待办事项，以结构化列表形式回复。
- /retry 由系统处理，你不会收到此指令。"""

    # Context management rules
    prompt += """

[上下文管理 — 防止退化]
1. 如果你发现自己在重复相同的操作或遇到相同的错误，立即停下来分析根因，换一种方法。
2. 处理大文件时，不要一次性读取整个文件再写回。用 patch/搜索替换，或分段处理。
3. 如果任务涉及多个大文件的修改，分步完成：先处理一个文件并确认成功，再处理下一个。
4. write_file 时必须提供 content 参数。如果文件内容太大无法一次写入，改用 execute_code 或 terminal 来写入。
5. 如果你感觉到自己的输出质量在下降（参数丢失、重复错误），主动告诉用户"我的上下文快满了，建议开新对话继续"。"""

    # Inject skills
    if skills:
        skill_text = "\n".join([f"- {s['name']}: {s.get('content', '')[:200]}" for s in skills[:5]])
        prompt += f"\n\n[已装载技能]\n{skill_text}"

    if room_type == "group" and other_agents:
        agent_list = "\n".join([f"  - @{a['name']}：{a.get('description') or '通用智能体'}" for a in other_agents[:8]])
        prompt += f"""

[群聊协作机制]
当前群聊中的其他智能体：
{agent_list}

协作规则：
1. 当任务超出你的职责范围时，直接在回复中用 @名字 请求对方协助
2. @提及格式：直接写 @名字（不要加粗、不要加引号、不要加括号），例如：@程序开发 请帮我修复这个bug
3. 被其他智能体@时，你必须响应并执行请求
4. 完成协作任务后，@回请求方告知结果
5. 不要自己尝试做不属于你职责的事情，交给专业的智能体处理"""

    # Inject legacy JSON collaboration guide if configured separately.
    guide_text = "" if unified_guide else room_settings.get("collaboration_guide", "")
    if guide_text and isinstance(guide_text, str) and guide_text.strip():
        # Support both new plain-text format and legacy JSON format
        display_text = guide_text.strip()
        try:
            steps = json.loads(guide_text)
            if isinstance(steps, list) and steps:
                # Legacy JSON format — convert to readable text
                display_text = "\n".join([
                    f"  {i+1}. {'@' + s['agent'] + ' ' if s.get('agent') else ''}{s.get('action', '')}"
                    for i, s in enumerate(steps)
                ])
        except (json.JSONDecodeError, TypeError, KeyError):
            pass  # Already plain text, use as-is

        prompt += f"""

[协作指导 — 所有智能体共享]
以下是用户为本群聊配置的协作流程，所有智能体都能看到。请理解你在流程中的角色，按照指导协作：

{display_text}

重要：完成你负责的部分后，主动 @下一个负责人并说明进展。"""

    handoff_rules = room_settings.get("handoff_rules") or []
    if isinstance(handoff_rules, list) and handoff_rules:
        lines = []
        for rule in handoff_rules[:20]:
            if not isinstance(rule, dict):
                continue
            trigger = str(rule.get("trigger") or "完成当前职责后").strip()
            target = str(rule.get("target") or "").strip()
            instruction = str(rule.get("instruction") or "").strip()
            if target:
                lines.append(f"- 当{trigger}，必须主动 @{target} {instruction}".rstrip())
        if lines:
            prompt += "\n\n[硬性交接规则]\n" + "\n".join(lines) + "\n这些规则优先级高于一般协作建议；完成对应阶段后不要等待用户提醒。"

    return prompt


def _parse_tools_config(agent: dict) -> dict:
    raw = agent.get("tools_config") if agent else None
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _merge_disabled_toolsets(exec_mode: str, tools_config: dict) -> list | None:
    disabled = []
    if exec_mode == "readonly":
        disabled.extend(["terminal", "file"])
    disabled.extend(tools_config.get("disabled_toolsets") or [])
    allowed = tools_config.get("allowed_toolsets") or []
    known = ["terminal", "file", "http", "browser", "memory", "skills"]
    if allowed:
        disabled.extend([name for name in known if name not in allowed])
    unique = []
    for item in disabled:
        if item and item not in unique:
            unique.append(item)
    return unique or None


def _direct_toolset_for_tool(name: str) -> str | None:
    mapping = {
        "run_command": "terminal",
        "read_file": "file",
        "write_file": "file",
        "search_files": "file",
        "http_request": "http",
    }
    return mapping.get(name)


def _handoff_mentions(reply: str, agent: dict, all_agents: list, room_settings: dict,
                      used_handoff_edges: set | None = None) -> list:
    """Return agent ids that should be triggered by structured room handoff rules."""
    rules = room_settings.get("handoff_rules") or []
    if not isinstance(rules, list) or not reply:
        return []
    agent_name = agent.get("name", "")
    result = []
    lowered = reply.lower()
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        source = str(rule.get("source") or "").strip()
        if source and source not in (agent_name, agent.get("id")):
            continue
        target_name = str(rule.get("target") or "").strip()
        if not target_name:
            continue
        keywords = rule.get("keywords") or rule.get("when_contains") or []
        if isinstance(keywords, str):
            keywords = [keywords]
        if keywords and not any(str(k).lower() in lowered for k in keywords if str(k).strip()):
            continue
        target = next((a for a in all_agents if a.get("name") == target_name or a.get("id") == target_name), None)
        edge_key = (agent.get("id"), target.get("id")) if target else None
        if used_handoff_edges and edge_key in used_handoff_edges:
            continue
        if target and target.get("id") != agent.get("id") and target.get("id") not in result:
            result.append(target["id"])
    return result


def _safe_completion_max_tokens(value, default: int = 4096, hard_limit: int = 8192) -> int:
    """Clamp stored model token values to a sane completion-token budget."""
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    if n <= 0:
        n = default
    return max(1, min(n, hard_limit))


async def run_hermes_agent(agent: dict, history: list, system_prompt: str,
                           model_config: dict | None, callbacks: dict,
                           cancel_event=None, room_id: str | None = None,
                           room_settings: dict | None = None) -> str | None:
    """
    Run Hermes AIAgent for a conversation turn.
    Uses callbacks for real-time tool event streaming to UI.
    cancel_event: threading.Event that signals cancellation from UI.
    """
    on_token = callbacks.get("on_token")
    on_tool_call = callbacks.get("on_tool_call")
    on_tool_result = callbacks.get("on_tool_result")

    # Determine API config
    if model_config:
        params = {}
        if model_config.get("params_json"):
            try:
                params = json.loads(model_config["params_json"]) if isinstance(model_config["params_json"], str) else model_config["params_json"]
            except:
                pass
        base_url = model_config["base_url"]
        api_key = model_config["api_key"]
        model = model_config["model"]
        max_tokens = _safe_completion_max_tokens(params.get("max_tokens") or model_config.get("max_tokens"))
        temperature = params.get("temperature") if params.get("temperature") is not None else model_config.get("temperature", 0.7)
        api_mode = params.get("api_mode", "chat_completions")
    else:
        hermes_config = get_hermes_config()
        if not hermes_config or not hermes_config["api_key"]:
            return None
        base_url = hermes_config["base_url"]
        api_key = hermes_config["api_key"]
        model = hermes_config["model"]
        max_tokens = 4096
        temperature = 0.7
        api_mode = "chat_completions"

    exec_mode = agent.get("execution_mode", "auto")
    tools_config = _parse_tools_config(agent)
    disabled_toolsets = _merge_disabled_toolsets(exec_mode, tools_config)
    preferred_tools = tools_config.get("preferred_tools") or tools_config.get("preference") or ""
    if preferred_tools:
        system_prompt += f"\n\n[Tool preference]\n{preferred_tools}\nDisabled tools must not be used."

    # Use Hermes Agent engine for full capabilities (tools, memory, skills)
    if HERMES_AVAILABLE:
        try:
            # Collect events from Hermes callbacks (called from thread)
            tool_events = []
            loop = asyncio.get_event_loop()
            # Tool loop detection: track consecutive identical failures
            _last_failures = []  # list of (name, error_output) tuples
            _MAX_IDENTICAL_FAILURES = 3

            def _tool_start(tool_call_id, name, args):
                # Check cancellation before each tool call
                if cancel_event and cancel_event.is_set():
                    raise InterruptedError("Stream cancelled by user")
                # Check for tool loop: if we've seen N identical failures, abort
                if len(_last_failures) >= _MAX_IDENTICAL_FAILURES:
                    last_set = set(_last_failures[-_MAX_IDENTICAL_FAILURES:])
                    if len(last_set) == 1:
                        raise InterruptedError(
                            f"Tool loop detected: {name} failed {_MAX_IDENTICAL_FAILURES} times with same error. "
                            f"Stopping to prevent infinite loop."
                        )
                summary = _tool_summary(name, args if isinstance(args, dict) else {})
                tool_events.append({"type": "start", "name": name, "summary": summary, "id": tool_call_id})
                if on_tool_call:
                    asyncio.run_coroutine_threadsafe(
                        on_tool_call({"name": name, "args": args if isinstance(args, dict) else {}, "summary": summary}),
                        loop
                    )

            def _tool_complete(tool_call_id, name, args, result):
                output = str(result)[:200] if result else ""
                ok = not (output.startswith("Error") or output.startswith("error"))
                tool_events.append({"type": "complete", "name": name, "ok": ok, "output": output, "id": tool_call_id})
                # Track failures for loop detection
                if not ok:
                    _last_failures.append((name, output[:80]))
                    # Immediate abort on context-pressure symptoms (dropped args)
                    if "missing required field" in output.lower() or "no code provided" in output.lower():
                        # This is a clear sign of context exhaustion — abort immediately
                        raise InterruptedError(
                            f"Context pressure detected: {name} called with missing arguments. "
                            f"上下文已满，无法继续执行。请开新对话重试。"
                        )
                else:
                    _last_failures.clear()  # Reset on success
                if on_tool_result:
                    asyncio.run_coroutine_threadsafe(
                        on_tool_result({"name": name, "ok": ok, "output": output}),
                        loop
                    )

            def _stream_delta(delta):
                # Stream intermediate text tokens to UI in real-time
                if on_token and delta:
                    asyncio.run_coroutine_threadsafe(
                        on_token(delta),
                        loop
                    )

            def _run_hermes_sync():
                nonlocal system_prompt  # Allow modifying the outer system_prompt
                # Isolate this agent's profile — each hub agent gets its own
                # memory, skills, sessions directory
                profile_dir = get_agent_profile_dir(agent.get("id", "default"))
                token = set_hermes_home_override(str(profile_dir))

                # Set room/project workspace as default cwd (shared by all agents in this room).
                # Agent profile remains isolated for memory/skills/config; project files do not
                # belong in the per-agent profile workspace.
                workspace_dir = get_room_workspace_dir(room_id or agent.get("id", "default"), room_settings)
                old_terminal_cwd = os.environ.get("TERMINAL_CWD")
                os.environ["TERMINAL_CWD"] = str(workspace_dir)

                # Determine execution mode from agent config
                exec_mode = agent.get("execution_mode", "auto")
                tools_config = _parse_tools_config(agent)

                # Configure profile based on execution_mode
                _ensure_hub_agent_config(profile_dir, base_url, api_key, model, exec_mode)

                # Set YOLO mode based on execution_mode
                old_yolo = os.environ.get("HERMES_YOLO_MODE")
                if exec_mode == "auto":
                    os.environ["HERMES_YOLO_MODE"] = "1"
                else:
                    os.environ.pop("HERMES_YOLO_MODE", None)

                # Determine toolsets based on execution_mode
                disabled_toolsets = _merge_disabled_toolsets(exec_mode, tools_config)
                preferred_tools = tools_config.get("preferred_tools") or ""
                if preferred_tools:
                    system_prompt += f"\n\n[工具偏好]\n{preferred_tools}\n如果与用户明确要求冲突，以用户本轮要求为准；如果与禁用工具冲突，禁用工具不可使用。"

                # Set up approval callback for 'confirm' mode
                if exec_mode == "confirm":
                    from tools.terminal_tool import set_approval_callback
                    def _hub_approval_callback(command, description, *, allow_permanent=True):
                        """Push approval request to UI via WS and wait for response."""
                        import uuid
                        approval_id = str(uuid.uuid4())[:8]
                        approval_event = asyncio.Event()
                        approval_result = {"decision": "deny"}

                        def _on_response(decision):
                            approval_result["decision"] = decision
                            approval_event.set()

                        # Register pending approval
                        _pending_approvals[approval_id] = _on_response

                        # Push to UI
                        asyncio.run_coroutine_threadsafe(
                            callbacks.get("on_approval_request", _noop_async)(
                                approval_id, command, description,
                                agent.get("id"), agent.get("name")
                            ),
                            loop
                        )

                        # Wait for response (timeout 120s)
                        try:
                            future = asyncio.run_coroutine_threadsafe(
                                _wait_for_approval(approval_event, 120),
                                loop
                            )
                            future.result(timeout=125)
                        except Exception:
                            pass
                        finally:
                            _pending_approvals.pop(approval_id, None)

                        return approval_result["decision"]

                    set_approval_callback(_hub_approval_callback)

                try:
                    # Get max_iterations from hub settings (budget = max API call rounds)
                    max_iters = 50
                    auto_mode = False
                    try:
                        import yaml
                        _settings_db_path = Path(__file__).parent.parent / "db" / "myna.sqlite"
                        if _settings_db_path.exists():
                            import sqlite3
                            _conn = sqlite3.connect(str(_settings_db_path))
                            _row = _conn.execute("SELECT value FROM hub_settings WHERE key = 'agent_max_rounds'").fetchone()
                            if _row:
                                if _row[0] == 'auto':
                                    max_iters = 200
                                    auto_mode = True
                                elif int(_row[0]) > 0:
                                    max_iters = int(_row[0])
                                elif int(_row[0]) == 0:
                                    max_iters = 200  # "unlimited" = 200 rounds
                            _conn.close()
                    except:
                        pass

                    # Auto mode: inject autonomous decision-making instructions
                    if auto_mode:
                        system_prompt += """

[智能执行模式 — 自主决策]
你处于智能执行模式。你需要自己判断：
1. 任务是否已完成？完成就停止，不要为了用完轮数而继续。
2. 是否需要先回复用户再继续工作？如果任务很长，先给用户一个进度更新，然后继续。
3. 遇到需要用户确认的决策点时，停下来询问，不要自作主张。
4. 如果任务明确且简单（如回答问题），直接回复，不需要调用工具。
5. 如果任务复杂（如修改代码、部署），按需调用工具直到完成，不受轮数限制。
核心原则：以完成任务为目标，不多不少。"""

                    agent_instance = AIAgent(
                        base_url=base_url,
                        api_key=api_key,
                        api_mode=api_mode,
                        model=model,
                        max_iterations=max_iters,
                        quiet_mode=True,
                        platform="myna",
                        skip_context_files=True,
                        skip_memory=False,
                        disabled_toolsets=disabled_toolsets,
                        tool_start_callback=_tool_start,
                        tool_complete_callback=_tool_complete,
                        stream_delta_callback=_stream_delta,
                    )
                    result = agent_instance.run_conversation(
                        user_message=history[-1]["content"] if history else "",
                        system_message=system_prompt,
                        conversation_history=history[:-1] if len(history) > 1 else None,
                    )
                    return result.get("final_response", "") if isinstance(result, dict) else str(result)
                finally:
                    reset_hermes_home_override(token)
                    if old_yolo is None:
                        os.environ.pop("HERMES_YOLO_MODE", None)
                    else:
                        os.environ["HERMES_YOLO_MODE"] = old_yolo
                    # Restore TERMINAL_CWD
                    if old_terminal_cwd is None:
                        os.environ.pop("TERMINAL_CWD", None)
                    else:
                        os.environ["TERMINAL_CWD"] = old_terminal_cwd
                    # Clear approval callback
                    if exec_mode == "confirm":
                        from tools.terminal_tool import set_approval_callback
                        set_approval_callback(None)

            final_text = await loop.run_in_executor(_executor, _run_hermes_sync)

            # Don't send final_text again — _stream_delta already sent tokens incrementally
            # if final_text and on_token:
            #     await on_token(final_text)

            return final_text or None

        except InterruptedError:
            raise  # Propagate cancellation/loop detection — don't fallback
        except Exception as e:
            print(f"[AI] Hermes Agent error: {e}")
            traceback.print_exc()
            # Fall through to direct API call

    # Fallback: Direct OpenAI-compatible API call with tool use
    return await direct_api_call(base_url, api_key, model, system_prompt, history,
                                  max_tokens, temperature, callbacks, disabled_toolsets)


async def direct_api_call(base_url: str, api_key: str, model: str,
                           system_prompt: str, history: list,
                           max_tokens: int, temperature: float, callbacks: dict,
                           disabled_toolsets: list | None = None) -> str | None:
    """Direct OpenAI-compatible API call with tool use loop."""
    import httpx

    on_token = callbacks.get("on_token")
    on_tool_call = callbacks.get("on_tool_call")
    on_tool_result = callbacks.get("on_tool_result")

    TOOL_DEFINITIONS = [
        {"type": "function", "function": {"name": "run_command", "description": "Execute a shell command", "parameters": {"type": "object", "properties": {"command": {"type": "string"}, "timeout": {"type": "integer", "default": 30}}, "required": ["command"]}}},
        {"type": "function", "function": {"name": "read_file", "description": "Read file contents", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
        {"type": "function", "function": {"name": "write_file", "description": "Write content to a file", "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}}},
        {"type": "function", "function": {"name": "http_request", "description": "Send HTTP request", "parameters": {"type": "object", "properties": {"method": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE", "PATCH"]}, "url": {"type": "string"}, "headers": {"type": "object"}, "body": {"type": "string"}}, "required": ["method", "url"]}}},
        {"type": "function", "function": {"name": "search_files", "description": "Search files by content or name", "parameters": {"type": "object", "properties": {"pattern": {"type": "string"}, "path": {"type": "string", "default": "."}, "file_glob": {"type": "string"}}, "required": ["pattern"]}}},
    ]
    disabled = set(disabled_toolsets or [])
    if disabled:
        TOOL_DEFINITIONS = [
            tool for tool in TOOL_DEFINITIONS
            if _direct_toolset_for_tool(tool["function"]["name"]) not in disabled
        ]

    messages = [{"role": "system", "content": system_prompt}] + history
    url = base_url.rstrip("/") + "/chat/completions"

    async with httpx.AsyncClient(timeout=120) as client:
        for round_num in range(8):
            body = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
            if TOOL_DEFINITIONS:
                body["tools"] = TOOL_DEFINITIONS
                body["tool_choice"] = "auto"

            resp = await client.post(url, json=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"})
            if resp.status_code != 200:
                print(f"[AI] API error {resp.status_code}: {resp.text[:200]}")
                return None

            data = resp.json()
            choice = data.get("choices", [{}])[0]
            msg = choice.get("message", {})

            if not msg.get("tool_calls"):
                text = msg.get("content", "")
                if text and on_token:
                    await on_token(text)
                return text or None

            messages.append(msg)
            for tc in msg["tool_calls"]:
                fn_name = tc["function"]["name"]
                try:
                    fn_args = json.loads(tc["function"]["arguments"])
                except:
                    fn_args = {}

                summary = _tool_summary(fn_name, fn_args)
                if on_tool_call:
                    await on_tool_call({"name": fn_name, "args": fn_args, "summary": summary})

                result = await _execute_tool(fn_name, fn_args)

                if on_tool_result:
                    await on_tool_result({"name": fn_name, "ok": result["ok"], "output": result["output"]})

                messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result["output"][:4000]})

    return None


def _tool_summary(name: str, args: dict) -> str:
    if name == "run_command":
        return (args.get("command") or "")[:80]
    elif name == "read_file":
        return args.get("path", "")
    elif name == "write_file":
        return args.get("path", "")
    elif name == "http_request":
        return f"{args.get('method', 'GET')} {(args.get('url') or '')[:60]}"
    elif name == "search_files":
        return f"{args.get('pattern', '')} in {args.get('path', '.')}"
    return str(args)[:60]


async def _execute_tool(name: str, args: dict) -> dict:
    """Execute a tool and return result."""
    import subprocess

    try:
        if name == "run_command":
            cmd = args.get("command", "")
            timeout = args.get("timeout", 30)
            cwd = os.environ.get("TERMINAL_CWD") or None
            proc = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, cwd=cwd)
            output = proc.stdout + proc.stderr
            return {"ok": proc.returncode == 0, "output": output[:8000] or "(empty)"}
        elif name == "read_file":
            path = args.get("path", "")
            p = Path(path).expanduser()
            if not p.is_absolute():
                p = Path(os.environ.get("TERMINAL_CWD") or os.getcwd()) / p
            if not p.exists():
                return {"ok": False, "output": f"File not found: {path}"}
            content = p.read_text(errors="replace")
            return {"ok": True, "output": content[:8000]}
        elif name == "write_file":
            path = args.get("path", "")
            content = args.get("content", "")
            p = Path(path).expanduser()
            if not p.is_absolute():
                p = Path(os.environ.get("TERMINAL_CWD") or os.getcwd()) / p
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content)
            return {"ok": True, "output": f"Written {len(content)} bytes to {path}"}
        elif name == "http_request":
            import httpx
            method = args.get("method", "GET")
            url = args.get("url", "")
            headers = args.get("headers", {})
            body = args.get("body")
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.request(method, url, headers=headers, content=body)
                return {"ok": resp.status_code < 400, "output": f"HTTP {resp.status_code}\n{resp.text[:4000]}"}
        elif name == "search_files":
            pattern = args.get("pattern", "")
            path = args.get("path", ".")
            cmd = f"grep -rn '{pattern}' {path} 2>/dev/null | head -30"
            proc = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
            return {"ok": True, "output": proc.stdout[:4000] or "(no matches)"}
        else:
            return {"ok": False, "output": f"Unknown tool: {name}"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "output": "Command timed out"}
    except Exception as e:
        return {"ok": False, "output": f"Error: {str(e)}"}


async def process_message(db, ws_manager, room_id: str, sender_id: str, text: str,
                           mentions: list = None, room_type: str = "group",
                           chain_depth: int = 0, thread_id: str = None,
                           handoff_edges: set | None = None):
    """
    Process a message and generate AI replies from mentioned agents.
    Core orchestration logic.
    """
    mentions = mentions or []
    handoff_edges = handoff_edges or set()

    # Chain depth limit: only applies to agent-to-agent chains, NOT user messages
    # Default max_chain = 5 if not configured (prevents infinite loops)
    room_settings = db.get_room_settings(room_id)
    max_chain = room_settings.get("max_chain_depth", 5)
    if sender_id != "user" and max_chain > 0 and chain_depth >= max_chain:
        print(f"[AI] Chain depth limit reached ({chain_depth}/{max_chain}) in room {room_id}")
        return

    members = db.get_room_members(room_id)
    # Full agent list is needed both for auto-adding mentioned agents and for
    # parsing @mentions in the agent's reply. Keep it initialized for every
    # code path; otherwise replies that mention another agent can crash after
    # streaming text, leaving the frontend stuck in "generating".
    all_agents = db.list_agents()
    responding_agents = []

    if room_type == "dm":
        responding_agents = [m for m in members if m["id"] not in (sender_id, "system", "user")]
    elif mentions:
        responding_agents = [m for m in members if m["id"] in mentions and m["id"] not in ("user", "system")]
        if len(responding_agents) < len(mentions):
            for mid in mentions:
                # Skip non-AI agents
                if mid in ("user", "system"):
                    continue
                if not any(m["id"] == mid for m in members):
                    agent = next((a for a in all_agents if a["id"] == mid), None)
                    if agent and agent.get("status") != "offline":
                        try:
                            db.add_member(room_id, mid)
                            responding_agents.append(agent)
                        except:
                            pass

    if not responding_agents:
        return

    responding_agents = [a for a in responding_agents if a.get("status") != "offline"]
    if not responding_agents:
        return

    # Determine context window size: room-level > global > default(20)
    context_limit = room_settings.get("context_messages_limit")
    if not context_limit or int(context_limit) <= 0:
        try:
            global_limit = db.get_hub_setting("context_messages_limit")
            context_limit = int(global_limit) if global_limit else 20
        except:
            context_limit = 20
    else:
        context_limit = int(context_limit)
    context_limit = max(1, min(200, context_limit))  # clamp 1-200

    recent_messages = db.get_thread_messages(thread_id, context_limit) if thread_id else db.get_room_messages(room_id, context_limit)

    for agent in responding_agents:
        # Special handling for System Agent
        if agent["id"] == "__system__":
            await _handle_system_agent_request(db, ws_manager, room_id, text, sender_id, thread_id)
            continue

        full_agent = db.get_agent_by_id(agent["id"])
        if not full_agent:
            continue

        # Build conversation history
        history = []
        # Track interrupted metadata but do not auto-continue it. User-initiated stop means
        # "stop talking", not "resume this partial reply next turn".
        for m in recent_messages:
            role = "assistant" if m["sender_id"] == agent["id"] else "user"
            content = m["text"]
            if m.get("sender_name") and m["sender_id"] != agent["id"]:
                content = f"[{m['sender_name']}]: {content}"
            history.append({"role": role, "content": content})

        # No automatic continuation for interrupted messages. If the user wants to
        # continue, they should explicitly ask; otherwise cancelled content should
        # not keep resurfacing in later turns.

        # Load agent skills for context (filtered by room scope)
        agent_skills = db.get_agent_skills(agent["id"])
        room_skill_ids = db.get_room_skills(room_id)
        if room_skill_ids:
            # Room has explicit skill config — only use skills enabled for this room
            agent_skills = [s for s in agent_skills if s["id"] in room_skill_ids]
        # If room has no skill config, use all agent skills (backward compatible)

        # Build system prompt
        # Only show agents that are members of this room (not all agents globally)
        room_workspace = get_room_workspace_dir(room_id, room_settings)
        prompt_room_settings = dict(room_settings)
        prompt_room_settings["__workspace_path"] = str(room_workspace)
        prompt_room_settings["__workspace_mode"] = "custom" if room_settings.get("workspace_path") else "default"
        room_members = db.get_room_members(room_id)
        other_agents = []
        for m in room_members:
            if m["id"] != agent["id"] and m["id"] not in ("user", "system"):
                # Enrich with description from full agent record
                full_m = db.get_agent_by_id(m["id"])
                if full_m:
                    other_agents.append(full_m)
                else:
                    other_agents.append(m)
        room = db.get_room(room_id)
        prompt_room_settings["room_description"] = room.get("description", "") if room else ""
        system_prompt = build_system_prompt(full_agent, room_type,
                                            other_agents if room_type == "group" else None,
                                            agent_skills,
                                            prompt_room_settings,
                                            room)

        model_config = get_model_config_for_agent(db, full_agent)
        stream_started_at = int(datetime.now().timestamp() * 1000)
        stream_id = f"stream_{stream_started_at}_{agent['id'][:8]}"

        await ws_manager.notify_ui({
            "type": "stream_start",
            "stream_id": stream_id,
            "room_id": room_id,
            "agent_id": agent["id"],
            "agent_name": agent.get("name") or full_agent.get("name", ""),
            "thread_id": thread_id,
            "timestamp": stream_started_at,
        })

        collected_tool_calls = []
        stream_parts = []

        async def on_token(chunk):
            if stream_parts and stream_parts[-1].get("type") == "text":
                stream_parts[-1]["text"] += chunk
            else:
                stream_parts.append({"type": "text", "text": chunk})
            await ws_manager.notify_ui({"type": "stream_token", "stream_id": stream_id, "room_id": room_id, "agent_id": agent["id"], "chunk": chunk})

        async def on_tool_call(info):
            tool_part = {"type": "tool", "name": info["name"], "summary": info["summary"], "status": "running", "result": None}
            collected_tool_calls.append(tool_part)
            stream_parts.append(tool_part)
            await ws_manager.notify_ui({"type": "tool_call", "stream_id": stream_id, "room_id": room_id, "agent_id": agent["id"], "tool": info["name"], "args_summary": info["summary"], "timestamp": int(datetime.now().timestamp() * 1000)})

        async def on_tool_result(info):
            for tc in reversed(collected_tool_calls):
                if tc["name"] == info["name"] and tc["status"] == "running":
                    tc["status"] = "done" if info["ok"] else "error"
                    tc["result"] = (info.get("output") or "")[:200]
                    break
            await ws_manager.notify_ui({"type": "tool_result", "stream_id": stream_id, "room_id": room_id, "agent_id": agent["id"], "tool": info["name"], "ok": info["ok"], "output_preview": (info.get("output") or "")[:200], "timestamp": int(datetime.now().timestamp() * 1000)})

        async def on_approval_request(approval_id, command, description, agent_id, agent_name):
            await ws_manager.notify_ui({
                "type": "approval_request",
                "approval_id": approval_id,
                "command": command,
                "description": description,
                "agent_id": agent_id,
                "agent_name": agent_name,
                "room_id": room_id,
                "stream_id": stream_id,
            })

        callbacks = {"on_token": on_token, "on_tool_call": on_tool_call, "on_tool_result": on_tool_result, "on_approval_request": on_approval_request}

        # Register cancellation event for this stream
        cancel_event = ws_manager.register_stream_cancel(stream_id)

        # Auto-compress history if context is getting full
        # Infer model context limit from model name
        model_context_limit = 128000  # Default for Claude Opus/Sonnet
        if model_config:
            model_name = model_config.get("model", "").lower()
            if "gpt-4" in model_name:
                model_context_limit = 128000
            elif "gpt-3.5" in model_name:
                model_context_limit = 16000
            elif "claude" in model_name:
                model_context_limit = 200000  # Claude 3.5 Sonnet has 200k
        
        history = _compress_history(history, keep_recent=5, model_context_limit=model_context_limit)

        try:
            reply = await run_hermes_agent(full_agent, history, system_prompt, model_config, callbacks, cancel_event,
                                           room_id=room_id, room_settings=room_settings)
        except InterruptedError as ie:
            # Could be user cancel OR context pressure / tool loop detection
            err_msg = str(ie)
            if "Context pressure" in err_msg or "Tool loop" in err_msg:
                # Context exhaustion — give user a meaningful message
                reply = f"⚠️ {err_msg}\n\n已完成的步骤已保存，请开新对话继续未完成的任务。"
                await ws_manager.notify_ui({
                    "type": "stream_error",
                    "stream_id": stream_id,
                    "room_id": room_id,
                    "agent_id": agent["id"],
                    "error": err_msg[:200],
                })
            else:
                # Normal user cancel
                reply = None
        except Exception as e:
            print(f"[AI] Error for {agent.get('name')}: {e}")
            traceback.print_exc()
            # Notify UI about the error so it's visible
            await ws_manager.notify_ui({
                "type": "stream_error",
                "stream_id": stream_id,
                "room_id": room_id,
                "agent_id": agent["id"],
                "error": str(e)[:200],
            })
            # Use whatever text was streamed so far
            stream_info = ws_manager.active_streams.get(stream_id)
            reply = (stream_info.get("text", "") if stream_info else "") or None
            if not reply:
                reply = f"⚠️ 执行出错：{str(e)[:100]}"
        finally:
            ws_manager.unregister_stream_cancel(stream_id)

        # Check if cancelled
        is_interrupted = cancel_event.is_set()

        # Give async callbacks time to complete (they're scheduled via run_coroutine_threadsafe)
        await asyncio.sleep(0.5)

        if is_interrupted:
            # User-initiated stop should stop the UI immediately and should not
            # persist a long partial reply that keeps sitting at the bottom.
            # Keep only a compact audit marker when tools already ran.
            if not collected_tool_calls:
                await ws_manager.notify_ui({"type": "stream_end", "stream_id": stream_id, "room_id": room_id, "agent_id": agent["id"], "interrupted": True})
                continue
            reply = f"⏹ 已停止（已执行 {len(collected_tool_calls)} 个工具调用）"
            metadata = {
                "interrupted": True,
                "stream_id": stream_id,
                "sort_ts": stream_started_at,
                "tool_calls": collected_tool_calls,
                "parts": stream_parts,
                "interrupted_tool_calls": collected_tool_calls,
            }
        else:
            metadata = {"tool_calls": collected_tool_calls, "parts": stream_parts} if (collected_tool_calls or stream_parts) else None

        if not reply and not collected_tool_calls and not stream_parts:
            # Send stream_end before continuing (no message to save)
            await ws_manager.notify_ui({"type": "stream_end", "stream_id": stream_id, "room_id": room_id, "agent_id": agent["id"], "interrupted": is_interrupted})
            continue

        # If reply is empty but we have tool calls, save a minimal message
        if not reply and collected_tool_calls:
            reply = "（工具执行完成）"

        # If interrupted, metadata/reply was already compacted above. Do not append
        # the partial streamed text here.
        if is_interrupted and not reply:
            reply = "⏹ 已停止"

        if not is_interrupted:
            metadata = {"tool_calls": collected_tool_calls, "parts": stream_parts} if (collected_tool_calls or stream_parts) else metadata

        reply_mentions = []
        # Strip markdown formatting around @mentions: **@name**, *@name*, `@name`, etc.
        clean_reply = re.sub(r'[*_`~|]', '', reply)
        for m in re.finditer(r"@([^\s@,，.。;；:：!！?？]+)", clean_reply):
            mention_name = m.group(1).strip()
            mentioned = next((a for a in all_agents if a["name"] == mention_name and a["id"] != agent["id"]), None)
            if mentioned and mentioned["id"] not in reply_mentions:
                reply_mentions.append(mentioned["id"])
        structured_handoff_mentions = _handoff_mentions(reply, full_agent, all_agents, room_settings, handoff_edges)
        visible_handoff_lines = []
        for mid in structured_handoff_mentions:
            if mid not in reply_mentions:
                reply_mentions.append(mid)
            handoff_edges.add((agent["id"], mid))
            target_agent = next((a for a in all_agents if a.get("id") == mid), None)
            target_name = target_agent.get("name") if target_agent else None
            if target_name and f"@{target_name}" not in clean_reply:
                visible_handoff_lines.append(f"@{target_name} 请继续跟进。")
        if visible_handoff_lines:
            reply = reply.rstrip() + "\n\n" + "\n".join(visible_handoff_lines)

        message = db.create_message(room_id, agent["id"], reply, "markdown", None, reply_mentions, metadata, thread_id)

        for member in members:
            if member["id"] != agent["id"]:
                payload = {"message_id": message["id"], "room_id": room_id, "from": {"id": agent["id"], "name": agent.get("name", "")}, "text": reply, "parse_mode": "markdown", "date": datetime.now().isoformat()}
                db.push_update(member["id"], "message", payload)
                await ws_manager.notify_agent(member["id"], {"type": "message", **payload})

        await ws_manager.notify_ui({"type": "new_message", "room_id": room_id, "thread_id": thread_id, "message": {"id": message["id"], "room_id": room_id, "sender_id": agent["id"], "sender_name": agent.get("name") or full_agent.get("name", ""), "text": reply, "thread_id": thread_id, "created_at": datetime.now().isoformat()}})

        # Send stream_end AFTER message is saved
        await ws_manager.notify_ui({"type": "stream_end", "stream_id": stream_id, "room_id": room_id, "agent_id": agent["id"], "interrupted": is_interrupted})

        # Chain collaboration (skip if interrupted)
        if reply_mentions and room_type == "group" and not is_interrupted:
            await asyncio.sleep(1)
            await process_message(db, ws_manager, room_id, agent["id"], reply, reply_mentions, room_type, chain_depth + 1, thread_id, handoff_edges)

        # Self-improvement (skip if interrupted)
        # Default: OFF globally and per-agent. Must be explicitly enabled.
        _global_self_improve = False
        _global_threshold = 2
        try:
            _si_val = db.get_hub_setting("self_improve_enabled")
            if _si_val is not None:
                _global_self_improve = _si_val == '1'
            _th_val = db.get_hub_setting("self_improve_threshold")
            if _th_val is not None:
                _global_threshold = int(_th_val)
        except:
            pass

        # Agent-level: default OFF (0), must be explicitly set to 1
        agent_self_improve = full_agent.get("self_improve", 0)
        effective_self_improve = bool(agent_self_improve) if agent_self_improve is not None else _global_self_improve
        effective_threshold = full_agent.get("self_improve_threshold") or _global_threshold

        if (collected_tool_calls and len(collected_tool_calls) >= effective_threshold
            and chain_depth == 0 and effective_self_improve and _global_self_improve):
            print(f"[AI] Self-improvement trigger for {full_agent.get('name')}: {len(collected_tool_calls)} tool calls >= threshold {effective_threshold}")
            asyncio.create_task(_self_improvement(db, ws_manager, room_id, thread_id, full_agent, collected_tool_calls, reply, model_config))
        elif collected_tool_calls:
            print(f"[AI] Self-improvement skipped for {full_agent.get('name')}: {len(collected_tool_calls)} tool calls, threshold={effective_threshold}, enabled={effective_self_improve}, global={_global_self_improve}, chain={chain_depth}")
        else:
            print(f"[AI] No tool calls collected for {full_agent.get('name')} (self_improve={effective_self_improve})")


async def _self_improvement(db, ws_manager, room_id, thread_id, agent, tool_calls, last_reply, model_config):
    """Background self-improvement: extract skills from tool usage with dedup and quality filter."""
    try:
        # Get existing skills for this agent to avoid duplicates
        existing_skills = db.get_agent_skills(agent["id"])
        existing_names = [s["name"] for s in existing_skills]
        existing_summary = "\n".join([f"- {s['name']}: {s.get('description', '')}" for s in existing_skills[:20]]) if existing_skills else "（暂无已有技能）"

        tool_summary = "\n".join([f"- {t['name']}: {t.get('summary', '')} (结果: {t['status']}, {(t.get('result') or '')[:100]})" for t in tool_calls])

        review_msgs = [
            {"role": "system", "content": f"""你是技能提取器。根据智能体的工具使用记录，判断是否值得提取/更新技能。

已有技能列表：
{existing_summary}

判断规则：
1. 如果这次操作只是简单的一问一答、查询信息、闲聊，输出 {{"action": "skip", "reason": "简单查询不需要保存"}}
2. 如果这次操作和已有技能高度重复（同类任务、同样步骤），输出 {{"action": "update", "target_skill": "已有技能名", "skill_content": "更新后的完整内容"}}
3. 只有当这次操作涉及多步骤、有复用价值、且和已有技能不重复时，才输出 {{"action": "create", "skill_name": "名称", "skill_description": "一句话描述", "skill_content": "详细步骤和要点"}}

不值得保存的例子：查看文件内容、简单问答、单步命令、日常对话
值得保存的例子：多步部署流程、复杂调试过程、数据处理管道、配置多个服务的协作

只输出JSON，不要其他文字。"""},
            {"role": "user", "content": f"智能体: {agent['name']}\n\n工具使用记录:\n{tool_summary}\n\n最终回复摘要: {last_reply[:500]}"}
        ]

        cfg = model_config or {}
        base_url = cfg.get("base_url") or get_hermes_config()["base_url"]
        api_key_val = cfg.get("api_key") or get_hermes_config()["api_key"]
        model_val = cfg.get("model") or get_hermes_config()["model"]

        result = await direct_api_call(base_url, api_key_val, model_val, review_msgs[0]["content"], [review_msgs[1]], 1024, 0.3, {})
        if not result:
            print(f"[AI] Self-improvement: no response from API for {agent['name']}")
            return

        json_match = re.search(r"\{[\s\S]*\}", result)
        if not json_match:
            print(f"[AI] Self-improvement: no JSON in response for {agent['name']}: {result[:200]}")
            return

        parsed = json.loads(json_match.group())
        action = parsed.get("action", "skip")

        if action == "skip":
            reason = parsed.get("reason", "不值得保存")
            print(f"[AI] Self-improvement skipped for {agent['name']}: {reason}")
            return

        if action == "update":
            target_name = parsed.get("target_skill", "")
            new_content = parsed.get("skill_content", "")
            # Find the existing skill to update
            target_skill = None
            for s in existing_skills:
                if s["name"] == target_name:
                    target_skill = s
                    break
            if target_skill and new_content:
                db.update_skill(target_skill["id"], {"content": new_content})
                print(f"[AI] Self-improvement: updated skill \"{target_name}\" for {agent['name']}")
                db.ensure_system_agents()
                review_msg = f"🔄 **已更新技能**「{target_name}」"
                message = db.create_message(room_id, "system", review_msg, "markdown", None, [], None, thread_id)
                await ws_manager.notify_ui({"type": "new_message", "room_id": room_id, "thread_id": thread_id, "message": {"id": message["id"], "room_id": room_id, "sender_id": "system", "sender_name": "系统", "text": review_msg, "thread_id": thread_id, "created_at": datetime.now().isoformat()}})
            else:
                print(f"[AI] Self-improvement: wanted to update \"{target_name}\" but not found, skipping")
            return

        if action == "create":
            skill_name = parsed.get("skill_name", "").strip()
            if not skill_name:
                print(f"[AI] Self-improvement: empty skill_name for {agent['name']}")
                return

            # Final dedup check - fuzzy match against existing names
            for existing_name in existing_names:
                if skill_name.lower() == existing_name.lower() or skill_name in existing_name or existing_name in skill_name:
                    print(f"[AI] Self-improvement: skill \"{skill_name}\" too similar to existing \"{existing_name}\", skipping")
                    return

            db.create_skill(
                agent["id"],
                skill_name,
                parsed.get("skill_description", ""),
                parsed.get("skill_content", ""),
                "learned"
            )
            print(f"[AI] Self-improvement: saved skill \"{skill_name}\" for {agent['name']}")

            db.ensure_system_agents()
            review_msg = f"💾 **已学习新技能**「{skill_name}」— {parsed.get('skill_description', '')}"
            message = db.create_message(room_id, "system", review_msg, "markdown", None, [], None, thread_id)
            await ws_manager.notify_ui({"type": "new_message", "room_id": room_id, "thread_id": thread_id, "message": {"id": message["id"], "room_id": room_id, "sender_id": "system", "sender_name": "系统", "text": review_msg, "thread_id": thread_id, "created_at": datetime.now().isoformat()}})

    except Exception as e:
        print(f"[AI] Self-improvement error: {e}")
        import traceback
        traceback.print_exc()


# === API for frontend: get engine status ===
def get_engine_status() -> dict:
    """Return Hermes engine status for the admin panel."""
    return {
        "hermes_available": HERMES_AVAILABLE,
        "hermes_path": str(HERMES_PATH),
        "engine": "hermes-agent" if HERMES_AVAILABLE else "direct-api",
        "capabilities": [
            "tool_use", "memory", "skills", "delegation", "cron",
            "web_browse", "file_ops", "terminal", "http_requests"
        ] if HERMES_AVAILABLE else [
            "tool_use", "file_ops", "terminal", "http_requests"
        ],
    }


async def _handle_system_agent_request(db, ws_manager, room_id: str, text: str, sender_id: str, thread_id: str = None):
    """
    Handle @System mentions by parsing the request and delegating to SystemAgent.
    Supports natural language commands like:
      @System clone https://github.com/user/repo
      @System pull myrepo
      @System status myrepo
      @System list repos
      @System list credentials
    """
    import re
    from fastapi import Request

    # Get system agent instance from the module-level or app state
    # We import it here to avoid circular imports
    try:
        from main import app
        system_agent = app.state.system_agent
    except Exception:
        # Fallback: send error message
        reply = "⚠️ 系统智能体未初始化"
        msg = db.create_message(room_id, "__system__", reply, "markdown", None, [], thread_id=thread_id)
        await ws_manager.notify_ui({
            "type": "message", "message_id": msg["id"], "room_id": room_id,
            "from": {"id": "__system__", "name": "System"},
            "text": reply, "parse_mode": "markdown",
            "thread_id": thread_id,
        })
        return

    # Parse the command from text (strip @System prefix)
    cmd_text = re.sub(r"@System\s*", "", text, flags=re.IGNORECASE).strip()

    # Parse action and params
    action, params = _parse_system_command(cmd_text)

    if not action:
        reply = """🔐 **System Agent** — 可用命令：

• `@System clone <url>` — Clone 仓库
• `@System pull <repo>` — 拉取最新代码
• `@System push <repo>` — 推送代码
• `@System status <repo>` — 查看仓库状态
• `@System commit <repo> <message>` — 提交更改
• `@System list repos` — 列出所有仓库
• `@System list credentials` — 列出可用凭据
• `@System exec <repo> <command>` — 在仓库中执行命令"""
    else:
        result = system_agent.handle_request(action, params, sender_id)
        if result["ok"]:
            data = result["data"]
            # Format response based on action
            if action == "git_clone":
                reply = f"✅ 已 Clone 到 `{data.get('path', '')}`"
            elif action == "git_pull":
                reply = f"✅ Pull 完成: {data.get('message', '')}"
            elif action == "git_push":
                reply = f"✅ Push 完成: {data.get('message', '')}"
            elif action == "git_status":
                reply = f"📂 **{data.get('repo')}** (branch: `{data.get('branch')}`)\n```\n{data.get('status')}\n```"
            elif action == "git_commit":
                reply = f"✅ {data.get('message', 'Committed')}"
            elif action == "list_repos":
                repos = data.get("repos", [])
                if repos:
                    lines = [f"• `{r['name']}` ({r['branch']}) — {r['path']}" for r in repos]
                    reply = "📂 **工作区仓库：**\n" + "\n".join(lines)
                else:
                    reply = "📂 工作区暂无仓库"
            elif action == "list_credentials":
                creds = data.get("credentials", [])
                if creds:
                    lines = [f"• `{c['name']}` ({c['type']})" for c in creds]
                    reply = "🔑 **可用凭据：**\n" + "\n".join(lines)
                else:
                    reply = "🔑 暂无配置凭据"
            elif action == "exec_command":
                exit_code = data.get("exit_code", -1)
                stdout = data.get("stdout", "").strip()
                icon = "✅" if exit_code == 0 else "❌"
                reply = f"{icon} Exit code: {exit_code}"
                if stdout:
                    reply += f"\n```\n{stdout[:1000]}\n```"
            else:
                reply = f"✅ {json.dumps(data, ensure_ascii=False)}"
        else:
            reply = f"❌ {result.get('error', 'Unknown error')}"

    # Send reply as System Agent
    msg = db.create_message(room_id, "__system__", reply, "markdown", None, [], thread_id=thread_id)
    await ws_manager.notify_ui({
        "type": "message", "message_id": msg["id"], "room_id": room_id,
        "from": {"id": "__system__", "name": "System"},
        "text": reply, "parse_mode": "markdown",
        "thread_id": thread_id,
    })


def _parse_system_command(text: str):
    """Parse a natural language command into (action, params)."""
    import re
    text = text.strip()
    if not text:
        return None, {}

    # clone <url> [name]
    m = re.match(r"clone\s+(https?://\S+)(?:\s+(\S+))?", text, re.IGNORECASE)
    if m:
        params = {"url": m.group(1)}
        if m.group(2):
            params["name"] = m.group(2)
        return "git_clone", params

    # pull <repo>
    m = re.match(r"pull\s+(\S+)", text, re.IGNORECASE)
    if m:
        return "git_pull", {"repo": m.group(1)}

    # push <repo> [branch]
    m = re.match(r"push\s+(\S+)(?:\s+(\S+))?", text, re.IGNORECASE)
    if m:
        params = {"repo": m.group(1)}
        if m.group(2):
            params["branch"] = m.group(2)
        return "git_push", params

    # status <repo>
    m = re.match(r"status\s+(\S+)", text, re.IGNORECASE)
    if m:
        return "git_status", {"repo": m.group(1)}

    # commit <repo> <message>
    m = re.match(r"commit\s+(\S+)\s+(.+)", text, re.IGNORECASE)
    if m:
        return "git_commit", {"repo": m.group(1), "message": m.group(2)}

    # list repos
    if re.match(r"list\s+repos?", text, re.IGNORECASE):
        return "list_repos", {}

    # list credentials
    if re.match(r"list\s+cred", text, re.IGNORECASE):
        return "list_credentials", {}

    # exec <repo> <command>
    m = re.match(r"exec\s+(\S+)\s+(.+)", text, re.IGNORECASE)
    if m:
        return "exec_command", {"repo": m.group(1), "command": m.group(2)}

    # run <command> (no repo)
    m = re.match(r"run\s+(.+)", text, re.IGNORECASE)
    if m:
        return "exec_command", {"command": m.group(1)}

    return None, {}
