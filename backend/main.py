"""
Myna - Python Backend
Multi-agent collaboration platform powered by Hermes Agent.
"""
import os
import sys
import asyncio
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Add hermes-agent to path for direct import
HERMES_AGENT_PATH = Path("/root/hermes")
if HERMES_AGENT_PATH.exists():
    sys.path.insert(0, str(HERMES_AGENT_PATH))

from db import get_database
from ws_manager import WSManager
from routes.admin import router as admin_router
from routes.gateway import router as gateway_router
from routes.upload import router as upload_router
from routes.auth import router as auth_router, is_authenticated, ensure_password_initialized
from routes.system_agent import router as system_agent_router
from workflow_engine import WorkflowRunner, WorkflowScheduler
from credentials import CredentialStore
from system_agent import SystemAgent

# Globals
db = None
ws_manager: WSManager = None
workflow_runner: WorkflowRunner = None
workflow_scheduler: WorkflowScheduler = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db, ws_manager, workflow_runner, workflow_scheduler
    
    # Startup
    data_dir = Path(__file__).parent.parent / "db"
    data_dir.mkdir(exist_ok=True)
    
    db = get_database(str(data_dir / "myna.sqlite"))
    # Initialize password hash at startup to prevent race condition
    ensure_password_initialized(db)
    ws_manager = WSManager()
    workflow_runner = WorkflowRunner(db, ws_manager)
    workflow_scheduler = WorkflowScheduler(db, workflow_runner)
    workflow_scheduler.start()

    # Initialize credential store and system agent
    # Use a stable secret for encryption (derived from DB path + machine id)
    encryption_secret = os.environ.get("MYNA_ENCRYPTION_KEY", "myna-default-key-change-me")
    credential_store = CredentialStore(db, encryption_secret)
    system_agent = SystemAgent(credential_store)
    
    # Store in app state
    app.state.db = db
    app.state.ws_manager = ws_manager
    app.state.workflow_runner = workflow_runner
    app.state.workflow_scheduler = workflow_scheduler
    app.state.credential_store = credential_store
    app.state.system_agent = system_agent
    
    port = int(os.environ.get("PORT", "3456"))
    print(f"""
╔══════════════════════════════════════════╗
║           Myna v0.5.0                   ║
╠══════════════════════════════════════════╣
║  Web UI:    http://localhost:{port}        ║
║  Gateway:   http://localhost:{port}/bot*   ║
║  WebSocket: ws://localhost:{port}/ws       ║
║  Admin API: http://localhost:{port}/admin  ║
║  Engine:    Hermes Agent (direct)        ║
╚══════════════════════════════════════════╝
    """)

    # Start stream cleanup task
    async def _stream_cleanup_loop():
        while True:
            await asyncio.sleep(60)  # Check every minute
            try:
                await ws_manager.cleanup_stale_streams()
            except Exception as e:
                print(f"[WS] Stream cleanup error: {e}")

    cleanup_task = asyncio.create_task(_stream_cleanup_loop())
    
    # Start update check task (Docker mode only)
    async def _update_check_loop():
        from routes.admin import check_for_update
        IS_DOCKER = os.path.exists("/.dockerenv")
        if not IS_DOCKER:
            return
        
        while True:
            await asyncio.sleep(600)  # Check every 10 minutes
            try:
                result = await check_for_update()
                if isinstance(result, dict) and result.get("available"):
                    await ws_manager.notify_ui({
                        "type": "update_available",
                        "local_version": result.get("current"),
                        "remote_version": result.get("latest")
                    })
            except Exception as e:
                print(f"[UPDATE] Check error: {e}")
    
    update_check_task = asyncio.create_task(_update_check_loop())

    yield
    
    # Shutdown
    cleanup_task.cancel()
    update_check_task.cancel()
    workflow_scheduler.stop()
    db.close()


app = FastAPI(title="Myna", version="0.3.8", lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth_router, prefix="/auth")
app.include_router(admin_router, prefix="/admin")
app.include_router(system_agent_router, prefix="/admin/system-agent")
app.include_router(gateway_router)
app.include_router(upload_router)


# Auth middleware - protect all routes except /auth/*, /health, static files, /ws
# Using pure ASGI middleware instead of BaseHTTPMiddleware to avoid response truncation bugs
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.requests import Request as StarletteRequest
from starlette.responses import JSONResponse as StarletteJSONResponse


class AuthMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] not in ("http",):
            await self.app(scope, receive, send)
            return

        path = scope["path"]
        # Skip auth for: login/check endpoints, health, static assets, websocket upgrade, media files, uploads
        if (path.startswith("/auth/") or
            path == "/health" or
            path.startswith("/assets/") or
            path.startswith("/admin/media/") or
            path == "/admin/system/version" or
            path == "/api/system/version" or
            path.startswith("/uploads/") or
            path.endswith(".js") or path.endswith(".css") or
            path.endswith(".ico") or path.endswith(".png") or
            path.endswith(".svg") or path.endswith(".woff") or path.endswith(".woff2") or
            path == "/" or path == "/index.html"):
            await self.app(scope, receive, send)
            return
        # WebSocket auth is handled in the endpoint itself
        if path == "/ws":
            await self.app(scope, receive, send)
            return
        # Check auth for API routes
        if path.startswith("/admin/") or path.startswith("/upload"):
            request = StarletteRequest(scope, receive)
            if not is_authenticated(request):
                response = StarletteJSONResponse({"ok": False, "error": "未登录"}, status_code=401)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)

app.add_middleware(AuthMiddleware)


# WebSocket endpoint
from fastapi import WebSocket, WebSocketDisconnect

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    params = websocket.query_params
    is_ui = params.get("ui") == "1"
    api_key = params.get("api_key")
    
    if is_ui:
        app.state.ws_manager.add_ui(websocket)
        try:
            await websocket.send_json({"type": "connected", "client": "ui"})
            # Send active streams for reconnection with ordered parts preserved.
            for stream_id, info in app.state.ws_manager.active_streams.items():
                await websocket.send_json({
                    "type": "stream_start",
                    "stream_id": stream_id,
                    **{k: v for k, v in info.items() if k not in ("text", "tool_calls", "parts")},
                })
                for part in info.get("parts") or []:
                    if part.get("type") == "text" and part.get("text"):
                        await websocket.send_json({
                            "type": "stream_token",
                            "stream_id": stream_id,
                            "room_id": info["room_id"],
                            "chunk": part.get("text", ""),
                        })
                    elif part.get("type") == "tool":
                        await websocket.send_json({
                            "type": "tool_call",
                            "stream_id": stream_id,
                            "room_id": info["room_id"],
                            "agent_id": info["agent_id"],
                            "tool": part.get("name"),
                            "args_summary": part.get("summary", ""),
                            "timestamp": 0,
                        })
                        if part.get("status") != "running":
                            await websocket.send_json({
                                "type": "tool_result",
                                "stream_id": stream_id,
                                "room_id": info["room_id"],
                                "agent_id": info["agent_id"],
                                "tool": part.get("name"),
                                "ok": part.get("status") == "done",
                                "output_preview": part.get("result", ""),
                            })
                if info.get("interrupted"):
                    await websocket.send_json({
                        "type": "stream_interrupted",
                        "stream_id": stream_id,
                        "room_id": info.get("room_id"),
                        "agent_id": info.get("agent_id"),
                        "thread_id": info.get("thread_id"),
                        "timestamp": info.get("timestamp"),
                    })
            while True:
                raw = await websocket.receive_text()
                # Handle UI commands (cancel stream, etc.)
                try:
                    import json as _json
                    cmd = _json.loads(raw)
                    if cmd.get("type") == "cancel_stream":
                        stream_id = cmd.get("stream_id")
                        if stream_id:
                            await app.state.ws_manager.interrupt_stream(stream_id)
                except:
                    pass
        except WebSocketDisconnect:
            pass
        finally:
            app.state.ws_manager.remove_ui(websocket)
    elif api_key:
        agent = app.state.db.get_agent_by_key(api_key)
        if not agent:
            await websocket.close(code=4001, reason="Invalid api_key")
            return
        app.state.ws_manager.add_agent(agent["id"], websocket)
        app.state.db.update_agent_status(agent["id"], "online")
        try:
            rooms = app.state.db.get_agent_rooms(agent["id"])
            await websocket.send_json({
                "type": "connected",
                "agent": {"id": agent["id"], "name": agent["name"]},
                "rooms": rooms
            })
            while True:
                data = await websocket.receive_json()
                await handle_agent_ws_message(app, agent, data)
        except WebSocketDisconnect:
            pass
        finally:
            app.state.ws_manager.remove_agent(agent["id"], websocket)
            app.state.db.update_agent_status(agent["id"], "offline")
    else:
        await websocket.close(code=4001, reason="api_key or ui=1 required")


async def handle_agent_ws_message(app, agent, msg):
    """Handle messages from agent WebSocket connections."""
    db = app.state.db
    ws_manager = app.state.ws_manager
    
    if msg.get("type") == "sendMessage":
        room_id = msg.get("room_id")
        text = msg.get("text")
        if not room_id or not text:
            return
        rooms = db.get_agent_rooms(agent["id"])
        if not any(r["id"] == room_id for r in rooms):
            return
        message = db.create_message(room_id, agent["id"], text, msg.get("parse_mode", "markdown"),
                                     msg.get("reply_to_message_id"), msg.get("mentions", []))
        members = db.get_room_members(room_id)
        for member in members:
            if member["id"] != agent["id"]:
                payload = {
                    "type": "message",
                    "message_id": message["id"],
                    "room_id": room_id,
                    "from": {"id": agent["id"], "name": agent["name"]},
                    "text": text,
                    "parse_mode": msg.get("parse_mode", "markdown"),
                    "date": message.get("created_at", "")
                }
                db.push_update(member["id"], "message", payload)
                await ws_manager.notify_agent(member["id"], payload)


# Health check
@app.get("/health")
async def health():
    agents = app.state.db.list_agents()
    rooms = app.state.db.list_rooms()
    return {
        "status": "ok",
        "agents": len(agents),
        "rooms": len(rooms),
        "online": len(app.state.ws_manager.get_online_agents()),
        "engine": "hermes-agent"
    }


# Serve uploaded files
uploads_dir = Path(__file__).parent.parent / "data" / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

# Serve frontend static files
frontend_dist = Path(__file__).parent.parent / "src" / "web" / "public"
if frontend_dist.exists():
    class NoCacheIndexStaticFiles(StaticFiles):
        def file_response(self, full_path, stat_result, scope, status_code=200):
            response = super().file_response(full_path, stat_result, scope, status_code)
            if Path(full_path).name == "index.html":
                response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
                response.headers["Pragma"] = "no-cache"
                response.headers["Expires"] = "0"
            return response

    app.mount("/", NoCacheIndexStaticFiles(directory=str(frontend_dist), html=True), name="static")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3456"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
