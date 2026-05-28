"""
Admin API routes - agents, rooms, threads, workflows, skills, models, messages.
"""
import os
import json
import asyncio
from datetime import datetime
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse

router = APIRouter()


def get_db(request: Request):
    return request.app.state.db


def get_ws(request: Request):
    return request.app.state.ws_manager


# === Auth middleware (via dependency) ===
async def check_auth(request: Request):
    secret = os.environ.get("SECRET_KEY", "")
    if not secret or secret == "change-me-to-a-random-string":
        return True
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {secret}":
        return False
    return True


# === Agents ===

@router.get("/agents")
async def list_agents(request: Request):
    db = get_db(request)
    agents = db.list_agents()
    return {"ok": True, "result": agents}


@router.post("/agents")
async def create_agent(request: Request):
    db = get_db(request)
    body = await request.json()
    name = body.get("name")
    if not name:
        return JSONResponse({"ok": False, "error": "name is required"}, status_code=400)
    agent = db.create_agent(name, body.get("description", ""))
    return {"ok": True, "result": agent}


@router.put("/agents/{agent_id}")
async def update_agent(agent_id: str, request: Request):
    db = get_db(request)
    body = await request.json()
    name = body.get("name")
    if not name:
        return JSONResponse({"ok": False, "error": "name is required"}, status_code=400)
    fields = {"name": name, "description": body.get("description", "")}
    for key in ["status", "model_config_id", "execution_mode", "self_improve",
                "self_improve_threshold", "tools_config"]:
        if key in body:
            val = body[key]
            if key == "self_improve":
                val = 1 if val else 0
            if key == "tools_config" and not isinstance(val, str):
                val = json.dumps(val)
            fields[key] = val
    if "sort_order" in body:
        fields["container_id"] = str(body["sort_order"])
    db.update_agent(agent_id, fields)
    return {"ok": True}


@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str, request: Request):
    db = get_db(request)
    db.delete_agent(agent_id)
    return {"ok": True}


# === Rooms ===

@router.get("/rooms")
async def list_rooms(request: Request):
    db = get_db(request)
    rooms = db.list_rooms()
    result = []
    for r in rooms:
        members = db.get_room_members(r["id"])
        msgs = db.get_room_messages(r["id"], 1)
        last_msg = msgs[-1] if msgs else None
        result.append({**r, "members": members, "last_message": last_msg})
    return {"ok": True, "result": result}


@router.post("/rooms")
async def create_room(request: Request):
    db = get_db(request)
    body = await request.json()
    name = body.get("name")
    if not name:
        return JSONResponse({"ok": False, "error": "name is required"}, status_code=400)
    room = db.create_room(name, body.get("description", ""), body.get("type", "group"))
    return {"ok": True, "result": room}


@router.put("/rooms/{room_id}")
async def update_room(room_id: str, request: Request):
    db = get_db(request)
    body = await request.json()
    room = db.get_room(room_id)
    if not room:
        return JSONResponse({"ok": False, "error": "Room not found"}, status_code=404)
    if "settings_json" in body:
        settings = body["settings_json"]
        if isinstance(settings, str):
            settings = json.loads(settings)
        db.update_room_settings(room_id, settings)
    sets = []
    vals = []
    if "name" in body:
        sets.append("name = ?"); vals.append(body["name"])
    if "description" in body:
        sets.append("description = ?"); vals.append(body["description"])
    if sets:
        vals.append(room_id)
        db.conn.execute(f"UPDATE rooms SET {', '.join(sets)} WHERE id = ?", vals)
        db.conn.commit()
    return {"ok": True}


@router.delete("/rooms/{room_id}")
async def delete_room(room_id: str, request: Request):
    db = get_db(request)
    db.delete_room(room_id)
    return {"ok": True}


# Room members
@router.post("/rooms/{room_id}/members")
async def add_members(room_id: str, request: Request):
    db = get_db(request)
    body = await request.json()
    agent_ids = body.get("agent_ids") or ([body["agent_id"]] if body.get("agent_id") else [])
    if not agent_ids:
        return JSONResponse({"ok": False, "error": "agent_id or agent_ids required"}, status_code=400)
    for aid in agent_ids:
        db.add_member(room_id, aid, body.get("role", "member"))
    return {"ok": True, "added": len(agent_ids)}


@router.delete("/rooms/{room_id}/members/{agent_id}")
async def remove_member(room_id: str, agent_id: str, request: Request):
    db = get_db(request)
    db.remove_member(room_id, agent_id)
    return {"ok": True}


# Room messages
@router.get("/rooms/{room_id}/messages")
async def get_room_messages(room_id: str, request: Request):
    db = get_db(request)
    limit = int(request.query_params.get("limit", "50"))
    before_id = request.query_params.get("before_id")
    messages = db.get_room_messages(room_id, limit, int(before_id) if before_id else None)
    return {"ok": True, "result": messages}


@router.delete("/rooms/{room_id}/messages")
async def clear_room_messages(room_id: str, request: Request):
    db = get_db(request)
    db.clear_room_messages(room_id)
    return {"ok": True}


# Message edit/delete
@router.patch("/messages/{message_id}")
async def update_message(message_id: int, request: Request):
    db = get_db(request)
    body = await request.json()
    text = body.get("text")
    if not text:
        return JSONResponse({"ok": False, "error": "text is required"}, status_code=400)
    db.update_message(message_id, text)
    return {"ok": True}


@router.delete("/messages/{message_id}")
async def delete_message(message_id: int, request: Request):
    db = get_db(request)
    db.delete_message(message_id)
    return {"ok": True}


# Send message (triggers AI)
@router.post("/rooms/{room_id}/send")
async def send_message(room_id: str, request: Request):
    db = get_db(request)
    ws_manager = get_ws(request)
    body = await request.json()
    text = body.get("text")
    if not text:
        return JSONResponse({"ok": False, "error": "text is required"}, status_code=400)

    db.ensure_system_agents()

    # Parse mentions
    mentions = body.get("mentions") or []
    if not mentions:
        import re
        agents = db.list_agents()
        for m in re.finditer(r"@(\S+)", text):
            mentioned = next((a for a in agents if a["name"] == m.group(1)), None)
            if mentioned:
                mentions.append(mentioned["id"])

    message = db.create_message(room_id, "user", text, "markdown", None, mentions)

    room = db.get_room(room_id)
    room_type = room["type"] if room else "group"

    # Trigger AI asynchronously
    from ai_engine import process_message
    async def _run_ai():
        try:
            await process_message(db, ws_manager, room_id, "user", text, mentions, room_type)
        except Exception as e:
            import traceback
            print(f"[AI] process_message error: {e}")
            traceback.print_exc()
    asyncio.create_task(_run_ai())

    return {"ok": True, "result": message}


# === DMs ===

@router.post("/dm/{agent_id}")
async def create_dm(agent_id: str, request: Request):
    db = get_db(request)
    agent = db.get_agent_by_id(agent_id)
    if not agent:
        return JSONResponse({"ok": False, "error": "Agent not found"}, status_code=404)
    db.ensure_system_agents()
    dm_room = db.get_dm_room("user", agent_id)
    if not dm_room:
        dm_room = db.create_room(f"DM: {agent['name']}", "", "dm")
        db.add_member(dm_room["id"], "user", "member")
        db.add_member(dm_room["id"], agent_id, "member")
    return {"ok": True, "result": {"room_id": dm_room["id"], "agent": agent}}


@router.get("/dms")
async def list_dms(request: Request):
    db = get_db(request)
    dms = db.list_dm_rooms()
    result = []
    for dm in dms:
        members = db.get_room_members(dm["id"])
        msgs = db.get_room_messages(dm["id"], 1)
        last_msg = msgs[-1] if msgs else None
        agent = next((m for m in members if m["id"] not in ("user", "system")), None)
        result.append({**dm, "members": members, "agent": agent, "last_message": last_msg})
    return {"ok": True, "result": result}


# === Model Configs ===

@router.get("/models")
async def list_models(request: Request):
    db = get_db(request)
    configs = db.list_model_configs()
    safe = [{**c, "api_key": "***" + c["api_key"][-4:] if c.get("api_key") else ""} for c in configs]
    return {"ok": True, "result": safe}


@router.post("/models")
async def create_model(request: Request):
    db = get_db(request)
    body = await request.json()
    for key in ["name", "provider", "base_url", "api_key", "model"]:
        if not body.get(key):
            return JSONResponse({"error": f"{key} required"}, status_code=400)
    config = db.create_model_config(body)
    return {"ok": True, "result": config}


@router.put("/models/{model_id}")
async def update_model(model_id: str, request: Request):
    db = get_db(request)
    body = await request.json()
    db.update_model_config(model_id, body)
    return {"ok": True}


@router.delete("/models/{model_id}")
async def delete_model(model_id: str, request: Request):
    db = get_db(request)
    db.delete_model_config(model_id)
    return {"ok": True}


# Model metadata (litellm)
_model_metadata_cache = None
_model_metadata_time = 0


@router.post("/models/test")
async def test_model_connection(request: Request):
    """Test a model connection by sending a simple prompt."""
    import httpx
    body = await request.json()
    base_url = body.get("base_url", "").rstrip("/")
    api_key_val = body.get("api_key", "")
    model = body.get("model", "gpt-4o-mini")
    api_mode = body.get("api_mode", "chat_completions")

    # If no api_key provided but model_config_id given, fetch from DB
    if not api_key_val and body.get("model_config_id"):
        db = get_db(request)
        config = db.get_model_config(body["model_config_id"])
        if config:
            api_key_val = config["api_key"]
            if not base_url:
                base_url = config["base_url"].rstrip("/")

    if not base_url or not api_key_val:
        return JSONResponse({"ok": False, "error": "需要 base_url 和 api_key"}, status_code=400)

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            if api_mode == "anthropic_messages":
                # Anthropic Messages API format
                url = base_url + "/messages"
                resp = await client.post(url, json={
                    "model": model,
                    "max_tokens": 50,
                    "messages": [{"role": "user", "content": "Say hi in 5 words"}]
                }, headers={
                    "x-api-key": api_key_val,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                })
            elif api_mode == "responses":
                # OpenAI Responses API format
                url = base_url + "/responses"
                resp = await client.post(url, json={
                    "model": model,
                    "input": "Say hi in 5 words",
                }, headers={
                    "Authorization": f"Bearer {api_key_val}",
                    "Content-Type": "application/json",
                })
            else:
                # Chat Completions (default)
                url = base_url + "/chat/completions"
                resp = await client.post(url, json={
                    "model": model,
                    "max_tokens": 50,
                    "messages": [{"role": "user", "content": "Say hi in 5 words"}]
                }, headers={
                    "Authorization": f"Bearer {api_key_val}",
                    "Content-Type": "application/json",
                })

            if resp.status_code != 200:
                error_text = resp.text[:200]
                return {"ok": False, "error": f"HTTP {resp.status_code}: {error_text}"}

            data = resp.json()
            # Extract reply based on format
            reply = ""
            if api_mode == "anthropic_messages":
                reply = data.get("content", [{}])[0].get("text", "")
            elif api_mode == "responses":
                reply = data.get("output_text", "") or str(data.get("output", ""))[:100]
            else:
                reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            return {"ok": True, "result": {"reply": reply, "model": model, "api_mode": api_mode}}

    except httpx.TimeoutException:
        return {"ok": False, "error": "连接超时（30秒）"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@router.get("/models/metadata")
async def get_model_metadata(request: Request):
    import time
    import httpx
    global _model_metadata_cache, _model_metadata_time

    if _model_metadata_cache and (time.time() - _model_metadata_time < 86400):
        pass
    else:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get("https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json")
                if resp.status_code == 200:
                    data = resp.json()
                    simplified = {}
                    for key, val in data.items():
                        if key == "sample_spec":
                            continue
                        simplified[key] = {
                            "max_input_tokens": val.get("max_input_tokens"),
                            "max_output_tokens": val.get("max_output_tokens"),
                            "provider": val.get("litellm_provider"),
                            "supports_vision": bool(val.get("supports_vision")),
                            "supports_function_calling": bool(val.get("supports_function_calling")),
                        }
                    _model_metadata_cache = simplified
                    _model_metadata_time = time.time()
        except Exception:
            pass

    metadata = _model_metadata_cache or {}
    q = request.query_params.get("q")
    id_param = request.query_params.get("id")

    if id_param:
        exact = metadata.get(id_param)
        if exact:
            return {"ok": True, "result": {id_param: exact}}
        matches = {k: v for k, v in metadata.items() if id_param in k}
        return {"ok": True, "result": dict(list(matches.items())[:20])}
    if q:
        query = q.lower()
        matches = {k: v for k, v in metadata.items() if query in k.lower()}
        return {"ok": True, "result": dict(list(matches.items())[:50])}
    return {"ok": True, "total": len(metadata)}


# === Threads ===

@router.get("/rooms/{room_id}/threads")
async def get_threads(room_id: str, request: Request):
    db = get_db(request)
    threads = db.get_threads(room_id)
    return {"ok": True, "result": threads}


@router.post("/rooms/{room_id}/threads")
async def create_thread(room_id: str, request: Request):
    db = get_db(request)
    body = await request.json()
    title = body.get("title")
    if not title:
        return JSONResponse({"ok": False, "error": "title is required"}, status_code=400)
    thread = db.create_thread(room_id, title)
    return {"ok": True, "result": thread}


@router.put("/threads/{thread_id}")
async def update_thread(thread_id: str, request: Request):
    db = get_db(request)
    body = await request.json()
    db.update_thread(thread_id, body)
    return {"ok": True}


@router.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str, request: Request):
    db = get_db(request)
    db.delete_thread(thread_id)
    return {"ok": True}


@router.get("/threads/{thread_id}/messages")
async def get_thread_messages(thread_id: str, request: Request):
    db = get_db(request)
    limit = int(request.query_params.get("limit", "30"))
    messages = db.get_thread_messages(thread_id, limit)
    return {"ok": True, "result": messages}


@router.post("/threads/{thread_id}/send")
async def send_thread_message(thread_id: str, request: Request):
    db = get_db(request)
    ws_manager = get_ws(request)
    body = await request.json()
    text = body.get("text")
    if not text:
        return JSONResponse({"ok": False, "error": "text is required"}, status_code=400)

    thread = db.get_thread(thread_id)
    if not thread:
        return JSONResponse({"ok": False, "error": "Thread not found"}, status_code=404)

    db.ensure_system_agents()

    # Parse mentions
    mentions = body.get("mentions") or []
    if not mentions:
        import re
        agents = db.list_agents()
        for m in re.finditer(r"@(\S+)", text):
            mentioned = next((a for a in agents if a["name"] == m.group(1)), None)
            if mentioned:
                mentions.append(mentioned["id"])

    message = db.create_message(thread["room_id"], "user", text, "markdown", None, mentions, thread_id=thread_id)

    room = db.get_room(thread["room_id"])
    room_type = room["type"] if room else "group"

    # Trigger AI
    from ai_engine import process_message
    asyncio.create_task(process_message(db, ws_manager, thread["room_id"], "user", text, mentions, room_type, thread_id=thread_id))

    return {"ok": True, "result": message}


# === Workflows ===

@router.get("/rooms/{room_id}/workflows")
async def get_workflows(room_id: str, request: Request):
    db = get_db(request)
    workflows = db.get_workflows(room_id)
    return {"ok": True, "result": workflows}


@router.post("/rooms/{room_id}/workflows")
async def create_workflow(room_id: str, request: Request):
    db = get_db(request)
    body = await request.json()
    name = body.get("name")
    steps_json = body.get("steps_json")
    if not name or not steps_json:
        return JSONResponse({"ok": False, "error": "name and steps_json required"}, status_code=400)
    if not isinstance(steps_json, str):
        steps_json = json.dumps(steps_json)
    trigger_config = body.get("trigger_config", "{}")
    if not isinstance(trigger_config, str):
        trigger_config = json.dumps(trigger_config)
    workflow = db.create_workflow(room_id, name, body.get("description", ""),
                                  steps_json, body.get("trigger_type", "manual"), trigger_config)
    # Reload scheduler
    scheduler = request.app.state.workflow_scheduler
    if scheduler:
        scheduler.reload()
    return {"ok": True, "result": workflow}


@router.get("/workflows/{workflow_id}")
async def get_workflow(workflow_id: str, request: Request):
    db = get_db(request)
    workflow = db.get_workflow(workflow_id)
    if not workflow:
        return JSONResponse({"ok": False, "error": "Workflow not found"}, status_code=404)
    return {"ok": True, "result": workflow}


@router.put("/workflows/{workflow_id}")
async def update_workflow(workflow_id: str, request: Request):
    db = get_db(request)
    body = await request.json()
    db.update_workflow(workflow_id, body)
    scheduler = request.app.state.workflow_scheduler
    if scheduler:
        scheduler.reload()
    return {"ok": True}


@router.delete("/workflows/{workflow_id}")
async def delete_workflow(workflow_id: str, request: Request):
    db = get_db(request)
    db.delete_workflow(workflow_id)
    scheduler = request.app.state.workflow_scheduler
    if scheduler:
        scheduler.reload()
    return {"ok": True}


@router.get("/workflows/{workflow_id}/runs")
async def get_workflow_runs(workflow_id: str, request: Request):
    db = get_db(request)
    runs = db.get_workflow_runs(workflow_id)
    return {"ok": True, "result": runs}


@router.post("/workflows/{workflow_id}/run")
@router.post("/workflows/{workflow_id}/trigger")
async def run_workflow(workflow_id: str, request: Request):
    db = get_db(request)
    workflow = db.get_workflow(workflow_id)
    if not workflow:
        return JSONResponse({"ok": False, "error": "Workflow not found"}, status_code=404)
    runner = request.app.state.workflow_runner
    if not runner:
        return JSONResponse({"ok": False, "error": "WorkflowRunner not initialized"}, status_code=500)
    try:
        result = await runner.start(workflow_id, workflow["room_id"])
        return {"ok": True, "result": result}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/workflow-runs/{run_id}/cancel")
async def cancel_workflow_run(run_id: str, request: Request):
    runner = request.app.state.workflow_runner
    if not runner:
        return JSONResponse({"ok": False, "error": "WorkflowRunner not initialized"}, status_code=500)
    runner.cancel(run_id)
    return {"ok": True}


# === Agent Skills ===

@router.get("/agents/{agent_id}/skills")
async def get_agent_skills(agent_id: str, request: Request):
    db = get_db(request)
    skills = db.get_agent_skills(agent_id)
    return {"ok": True, "result": skills}


@router.get("/skills")
async def get_all_skills(request: Request):
    db = get_db(request)
    skills = db.get_all_skills()
    return {"ok": True, "result": skills}


@router.get("/skills/{skill_id}")
async def get_skill(skill_id: str, request: Request):
    db = get_db(request)
    skill = db.get_skill_by_id(skill_id)
    if not skill:
        return JSONResponse({"ok": False, "error": "Skill not found"}, status_code=404)
    return {"ok": True, "result": skill}


@router.post("/agents/{agent_id}/skills")
async def create_skill(agent_id: str, request: Request):
    db = get_db(request)
    body = await request.json()
    name = body.get("name")
    if not name:
        return JSONResponse({"ok": False, "error": "name is required"}, status_code=400)
    skill = db.create_skill(agent_id, name, body.get("description", ""),
                            body.get("content", ""), body.get("file_type", "text"))
    return {"ok": True, "result": skill}


@router.put("/skills/{skill_id}")
async def update_skill(skill_id: str, request: Request):
    db = get_db(request)
    body = await request.json()
    skill = db.update_skill(skill_id, body)
    return {"ok": True, "result": skill}


@router.delete("/skills/{skill_id}")
async def delete_skill(skill_id: str, request: Request):
    db = get_db(request)
    db.delete_skill(skill_id)
    return {"ok": True}


# === Engine Status ===

@router.get("/engine/status")
async def engine_status(request: Request):
    from ai_engine import get_engine_status
    return {"ok": True, "result": get_engine_status()}


@router.post("/skills/{skill_id}/copy")
async def copy_skill(skill_id: str, request: Request):
    db = get_db(request)
    body = await request.json()
    target = body.get("target_agent_id")
    if not target:
        return JSONResponse({"ok": False, "error": "target_agent_id required"}, status_code=400)
    skill = db.copy_skill_to_agent(skill_id, target)
    if not skill:
        return JSONResponse({"ok": False, "error": "Source skill not found"}, status_code=404)
    return {"ok": True, "result": skill}
