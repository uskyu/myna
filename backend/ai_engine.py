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
_executor = ThreadPoolExecutor(max_workers=4)

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
    return profile_dir


def get_hermes_config():
    """Read Hermes config for API credentials."""
    import yaml
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


def build_system_prompt(agent: dict, room_type: str, other_agents: list = None, skills: list = None) -> str:
    """Build system prompt for an agent."""
    tools_desc = """你拥有 Hermes Agent 引擎的完整能力：
- 执行系统命令（本地/SSH远程）
- 读写文件、搜索文件
- 发送HTTP请求、调用API
- 安装软件包（npm/pip/apt）
- 持久记忆（跨对话记住信息）
- 技能学习（从经验中提取可复用流程）
- 网页浏览和信息提取

需要时主动使用工具。你可以接收服务器地址、密码、API密钥等信息并直接使用。"""

    base = agent.get("description", "")
    name = agent.get("name", "Assistant")

    if base:
        prompt = f"你是 {name}。{base}\n\n{tools_desc}"
    else:
        prompt = f"你是 {name}，一个全能智能助手。\n\n{tools_desc}"

    prompt += "\n\n回复使用 Markdown 格式，保持简洁专业。直接执行用户的指令。"

    # Inject skills
    if skills:
        skill_text = "\n".join([f"- {s['name']}: {s.get('content', '')[:200]}" for s in skills[:5]])
        prompt += f"\n\n[已装载技能]\n{skill_text}"

    if room_type == "group" and other_agents:
        agent_list = "、".join([f"@{a['name']}（{a.get('description') or '通用智能体'}）" for a in other_agents[:8]])
        prompt += f"\n\n[群聊环境] 可协作智能体：{agent_list}。需要时在回复中 @他们。"

    return prompt


async def run_hermes_agent(agent: dict, history: list, system_prompt: str,
                           model_config: dict | None, callbacks: dict) -> str | None:
    """
    Run Hermes AIAgent for a conversation turn.
    Uses callbacks for real-time tool event streaming to UI.
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
        max_tokens = params.get("max_tokens") or model_config.get("max_tokens") or 4096
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

    # Use Hermes Agent engine for full capabilities (tools, memory, skills)
    if HERMES_AVAILABLE:
        try:
            # Collect events from Hermes callbacks (called from thread)
            tool_events = []
            loop = asyncio.get_event_loop()

            def _tool_start(tool_call_id, name, args):
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
                if on_tool_result:
                    asyncio.run_coroutine_threadsafe(
                        on_tool_result({"name": name, "ok": ok, "output": output}),
                        loop
                    )

            def _stream_delta(delta):
                pass  # We get the full text at the end

            def _run_hermes_sync():
                # Isolate this agent's profile — each hub agent gets its own
                # memory, skills, sessions directory
                profile_dir = get_agent_profile_dir(agent.get("id", "default"))
                token = set_hermes_home_override(str(profile_dir))
                try:
                    agent_instance = AIAgent(
                        base_url=base_url,
                        api_key=api_key,
                        api_mode=api_mode,
                        model=model,
                        max_iterations=15,
                        quiet_mode=True,
                        platform="hermes-hub",
                        skip_context_files=True,
                        skip_memory=False,
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

            final_text = await loop.run_in_executor(_executor, _run_hermes_sync)

            if final_text and on_token:
                await on_token(final_text)

            return final_text or None

        except Exception as e:
            print(f"[AI] Hermes Agent error: {e}")
            traceback.print_exc()
            # Fall through to direct API call

    # Fallback: Direct OpenAI-compatible API call with tool use
    return await direct_api_call(base_url, api_key, model, system_prompt, history,
                                  max_tokens, temperature, callbacks)


async def direct_api_call(base_url: str, api_key: str, model: str,
                           system_prompt: str, history: list,
                           max_tokens: int, temperature: float, callbacks: dict) -> str | None:
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

    messages = [{"role": "system", "content": system_prompt}] + history
    url = base_url.rstrip("/") + "/chat/completions"

    async with httpx.AsyncClient(timeout=120) as client:
        for round_num in range(8):
            body = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature, "tools": TOOL_DEFINITIONS, "tool_choice": "auto"}

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
            proc = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
            output = proc.stdout + proc.stderr
            return {"ok": proc.returncode == 0, "output": output[:8000] or "(empty)"}
        elif name == "read_file":
            path = args.get("path", "")
            p = Path(path).expanduser()
            if not p.exists():
                return {"ok": False, "output": f"File not found: {path}"}
            content = p.read_text(errors="replace")
            return {"ok": True, "output": content[:8000]}
        elif name == "write_file":
            path = args.get("path", "")
            content = args.get("content", "")
            p = Path(path).expanduser()
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
                           chain_depth: int = 0, thread_id: str = None):
    """
    Process a message and generate AI replies from mentioned agents.
    Core orchestration logic.
    """
    mentions = mentions or []

    room_settings = db.get_room_settings(room_id)
    max_chain = room_settings.get("max_chain_depth", 0)
    if max_chain > 0 and chain_depth >= max_chain:
        return

    members = db.get_room_members(room_id)
    responding_agents = []

    if room_type == "dm":
        responding_agents = [m for m in members if m["id"] not in (sender_id, "system", "user")]
    elif mentions:
        responding_agents = [m for m in members if m["id"] in mentions]
        if len(responding_agents) < len(mentions):
            all_agents = db.list_agents()
            for mid in mentions:
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

    recent_messages = db.get_thread_messages(thread_id, 20) if thread_id else db.get_room_messages(room_id, 20)

    for agent in responding_agents:
        full_agent = db.get_agent_by_id(agent["id"])
        if not full_agent:
            continue

        # Build conversation history
        history = []
        for m in recent_messages:
            role = "assistant" if m["sender_id"] == agent["id"] else "user"
            content = m["text"]
            if m.get("sender_name") and m["sender_id"] != agent["id"]:
                content = f"[{m['sender_name']}]: {content}"
            history.append({"role": role, "content": content})

        # Load agent skills for context
        agent_skills = db.get_agent_skills(agent["id"])

        # Build system prompt
        all_agents = db.list_agents()
        other_agents = [a for a in all_agents if a["id"] != agent["id"] and a["id"] != "user" and a.get("status") == "online"]
        system_prompt = build_system_prompt(full_agent, room_type,
                                            other_agents if room_type == "group" else None,
                                            agent_skills)

        model_config = get_model_config_for_agent(db, full_agent)
        stream_id = f"stream_{int(datetime.now().timestamp() * 1000)}_{agent['id'][:8]}"

        await ws_manager.notify_ui({
            "type": "stream_start",
            "stream_id": stream_id,
            "room_id": room_id,
            "agent_id": agent["id"],
            "agent_name": agent.get("name") or full_agent.get("name", ""),
            "thread_id": thread_id,
        })

        collected_tool_calls = []

        async def on_token(chunk):
            await ws_manager.notify_ui({"type": "stream_token", "stream_id": stream_id, "room_id": room_id, "agent_id": agent["id"], "chunk": chunk})

        async def on_tool_call(info):
            collected_tool_calls.append({"name": info["name"], "summary": info["summary"], "status": "running", "result": None})
            await ws_manager.notify_ui({"type": "tool_call", "stream_id": stream_id, "room_id": room_id, "agent_id": agent["id"], "tool": info["name"], "args_summary": info["summary"], "timestamp": int(datetime.now().timestamp() * 1000)})

        async def on_tool_result(info):
            for tc in reversed(collected_tool_calls):
                if tc["name"] == info["name"] and tc["status"] == "running":
                    tc["status"] = "done" if info["ok"] else "error"
                    tc["result"] = (info.get("output") or "")[:200]
                    break
            await ws_manager.notify_ui({"type": "tool_result", "stream_id": stream_id, "room_id": room_id, "agent_id": agent["id"], "tool": info["name"], "ok": info["ok"], "output_preview": (info.get("output") or "")[:200], "timestamp": int(datetime.now().timestamp() * 1000)})

        callbacks = {"on_token": on_token, "on_tool_call": on_tool_call, "on_tool_result": on_tool_result}

        try:
            reply = await run_hermes_agent(full_agent, history, system_prompt, model_config, callbacks)
        except Exception as e:
            print(f"[AI] Error for {agent.get('name')}: {e}")
            traceback.print_exc()
            reply = None

        await ws_manager.notify_ui({"type": "stream_end", "stream_id": stream_id, "room_id": room_id, "agent_id": agent["id"]})

        if not reply:
            continue

        metadata = {"tool_calls": collected_tool_calls} if collected_tool_calls else None

        reply_mentions = []
        for m in re.finditer(r"@(\S+)", reply):
            mentioned = next((a for a in all_agents if a["name"] == m.group(1) and a["id"] != agent["id"]), None)
            if mentioned:
                reply_mentions.append(mentioned["id"])

        message = db.create_message(room_id, agent["id"], reply, "markdown", None, reply_mentions, metadata, thread_id)

        for member in members:
            if member["id"] != agent["id"]:
                payload = {"message_id": message["id"], "room_id": room_id, "from": {"id": agent["id"], "name": agent.get("name", "")}, "text": reply, "parse_mode": "markdown", "date": datetime.now().isoformat()}
                db.push_update(member["id"], "message", payload)
                await ws_manager.notify_agent(member["id"], {"type": "message", **payload})

        await ws_manager.notify_ui({"type": "new_message", "room_id": room_id, "thread_id": thread_id, "message": {"id": message["id"], "room_id": room_id, "sender_id": agent["id"], "sender_name": agent.get("name") or full_agent.get("name", ""), "text": reply, "thread_id": thread_id, "created_at": datetime.now().isoformat()}})

        # Chain collaboration
        if reply_mentions and room_type == "group":
            await asyncio.sleep(1)
            await process_message(db, ws_manager, room_id, agent["id"], reply, reply_mentions, room_type, chain_depth + 1, thread_id)

        # Self-improvement
        if (collected_tool_calls and len(collected_tool_calls) >= (full_agent.get("self_improve_threshold") or 2)
            and chain_depth == 0 and full_agent.get("self_improve", 1)):
            asyncio.create_task(_self_improvement(db, ws_manager, room_id, thread_id, full_agent, collected_tool_calls, reply, model_config))


async def _self_improvement(db, ws_manager, room_id, thread_id, agent, tool_calls, last_reply, model_config):
    """Background self-improvement."""
    try:
        tool_summary = "\n".join([f"{t['name']}: {t.get('summary', '')} -> {t['status']}" for t in tool_calls])
        review_msgs = [
            {"role": "system", "content": "分析工具使用记录，判断是否有值得保存的技能。有则输出JSON：{\"save\": true, \"skill_name\": \"名称\", \"skill_description\": \"描述\", \"skill_content\": \"内容\"}，无则输出{\"save\": false}。只输出JSON。"},
            {"role": "user", "content": f"智能体: {agent['name']}\n工具使用:\n{tool_summary}\n\n回复摘要: {last_reply[:500]}"}
        ]

        cfg = model_config or {}
        base_url = cfg.get("base_url") or get_hermes_config()["base_url"]
        api_key_val = cfg.get("api_key") or get_hermes_config()["api_key"]
        model_val = cfg.get("model") or get_hermes_config()["model"]

        result = await direct_api_call(base_url, api_key_val, model_val, review_msgs[0]["content"], [review_msgs[1]], 1024, 0.3, {})
        if not result:
            return

        json_match = re.search(r"\{[\s\S]*\}", result)
        if not json_match:
            return

        parsed = json.loads(json_match.group())
        if not parsed.get("save") or not parsed.get("skill_name"):
            return

        db.create_skill(agent["id"], parsed["skill_name"], parsed.get("skill_description", ""), parsed.get("skill_content", ""), "learned")
        print(f"[AI] 💾 Self-improvement: saved skill \"{parsed['skill_name']}\" for {agent['name']}")

        db.ensure_system_agents()
        review_msg = f"💾 **Self-improvement**: 已学习新技能「{parsed['skill_name']}」— {parsed.get('skill_description', '')}"
        message = db.create_message(room_id, "system", review_msg, "markdown", None, [], None, thread_id)
        await ws_manager.notify_ui({"type": "new_message", "room_id": room_id, "thread_id": thread_id, "message": {"id": message["id"], "room_id": room_id, "sender_id": "system", "sender_name": "系统", "text": review_msg, "thread_id": thread_id, "created_at": datetime.now().isoformat()}})
    except Exception as e:
        print(f"[AI] Self-improvement error: {e}")


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
