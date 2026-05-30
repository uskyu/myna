"""
WebSocket connection manager for UI clients and agent connections.
"""
import json
import time
import asyncio
import threading
from fastapi import WebSocket

# Stream timeout: 5 minutes without activity = auto-cleanup
STREAM_TIMEOUT_SECONDS = 300


class WSManager:
    def __init__(self):
        self.ui_connections: set[WebSocket] = set()
        self.agent_connections: dict[str, set[WebSocket]] = {}  # agent_id -> set of ws
        self.active_streams: dict[str, dict] = {}  # stream_id -> info
        self._stream_last_activity: dict[str, float] = {}  # stream_id -> timestamp
        self._cancelled_streams: dict[str, threading.Event] = {}  # stream_id -> cancel event

    def add_ui(self, ws: WebSocket):
        self.ui_connections.add(ws)

    def remove_ui(self, ws: WebSocket):
        self.ui_connections.discard(ws)

    def add_agent(self, agent_id: str, ws: WebSocket):
        if agent_id not in self.agent_connections:
            self.agent_connections[agent_id] = set()
        self.agent_connections[agent_id].add(ws)

    def remove_agent(self, agent_id: str, ws: WebSocket):
        if agent_id in self.agent_connections:
            self.agent_connections[agent_id].discard(ws)
            if not self.agent_connections[agent_id]:
                del self.agent_connections[agent_id]

    def get_online_agents(self) -> list[str]:
        return list(self.agent_connections.keys())

    async def notify_ui(self, payload: dict):
        """Send event to all UI clients."""
        # Track active streams
        if payload.get("type") == "stream_start":
            self.active_streams[payload["stream_id"]] = {
                "room_id": payload.get("room_id"),
                "agent_id": payload.get("agent_id"),
                "agent_name": payload.get("agent_name"),
                "thread_id": payload.get("thread_id"),
                "text": "",
                "tool_calls": [],
                "parts": [],
                "timestamp": payload.get("timestamp"),
                "interrupted": False,
            }
            self._stream_last_activity[payload["stream_id"]] = time.time()
        elif payload.get("type") == "stream_interrupted":
            stream = self.active_streams.get(payload.get("stream_id", ""))
            if stream:
                stream["interrupted"] = True
                stream["working"] = False
                self._stream_last_activity[payload.get("stream_id", "")] = time.time()
        elif payload.get("type") == "stream_end":
            self.active_streams.pop(payload.get("stream_id", ""), None)
            self._stream_last_activity.pop(payload.get("stream_id", ""), None)
        elif payload.get("type") == "stream_token":
            stream = self.active_streams.get(payload.get("stream_id", ""))
            if stream:
                chunk = payload.get("chunk", "")
                stream["text"] += chunk
                if stream["parts"] and stream["parts"][-1].get("type") == "text":
                    stream["parts"][-1]["text"] += chunk
                else:
                    stream["parts"].append({"type": "text", "text": chunk})
                self._stream_last_activity[payload.get("stream_id", "")] = time.time()
        elif payload.get("type") == "tool_call":
            stream = self.active_streams.get(payload.get("stream_id", ""))
            if stream:
                tool_part = {
                    "name": payload.get("tool"),
                    "summary": payload.get("args_summary", ""),
                    "status": "running",
                    "result": None,
                }
                stream["tool_calls"].append(tool_part)
                stream["parts"].append({"type": "tool", **tool_part})
                self._stream_last_activity[payload.get("stream_id", "")] = time.time()
        elif payload.get("type") == "tool_result":
            stream = self.active_streams.get(payload.get("stream_id", ""))
            if stream:
                # Update the last matching running tool call
                for tc in reversed(stream["tool_calls"]):
                    if tc["name"] == payload.get("tool") and tc["status"] == "running":
                        tc["status"] = "done" if payload.get("ok") else "error"
                        tc["result"] = payload.get("output", "")[:200]
                        break
                for part in reversed(stream["parts"]):
                    if part.get("type") == "tool" and part.get("name") == payload.get("tool") and part.get("status") == "running":
                        part["status"] = "done" if payload.get("ok") else "error"
                        part["result"] = payload.get("output", "")[:200]
                        break
                self._stream_last_activity[payload.get("stream_id", "")] = time.time()

        data = json.dumps(payload)
        dead = set()
        for ws in self.ui_connections:
            try:
                await ws.send_text(data)
            except Exception:
                dead.add(ws)
        self.ui_connections -= dead

    async def notify_agent(self, agent_id: str, payload: dict):
        """Send event to a specific agent's connections."""
        conns = self.agent_connections.get(agent_id, set())
        if not conns:
            return
        data = json.dumps(payload)
        dead = set()
        for ws in conns:
            try:
                await ws.send_text(data)
            except Exception:
                dead.add(ws)
        conns -= dead

    def notify_ui_sync(self, payload: dict):
        """Fire-and-forget UI notification from sync context."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(self.notify_ui(payload))
            else:
                loop.run_until_complete(self.notify_ui(payload))
        except RuntimeError:
            pass

    async def cleanup_stale_streams(self):
        """Remove streams that have been inactive for too long. Called periodically."""
        now = time.time()
        stale = [
            sid for sid, last in self._stream_last_activity.items()
            if now - last > STREAM_TIMEOUT_SECONDS
        ]
        for sid in stale:
            info = self.active_streams.pop(sid, None)
            self._stream_last_activity.pop(sid, None)
            if info:
                print(f"[WS] Cleaning up stale stream {sid} (agent={info.get('agent_name')}, inactive {int(now - (self._stream_last_activity.get(sid) or now))}s)")
                await self.notify_ui({
                    "type": "stream_end",
                    "stream_id": sid,
                    "room_id": info.get("room_id"),
                    "agent_id": info.get("agent_id"),
                    "timeout": True,
                })

    def register_stream_cancel(self, stream_id: str) -> threading.Event:
        """Register a cancellation event for a stream. Returns the Event to check in agent loop."""
        event = threading.Event()
        self._cancelled_streams[stream_id] = event
        return event

    def cancel_stream(self, stream_id: str) -> bool:
        """Signal cancellation for a stream. Returns True only on first cancel."""
        event = self._cancelled_streams.get(stream_id)
        first_cancel = bool(event and not event.is_set())
        if event:
            event.set()
        stream = self.active_streams.get(stream_id)
        if stream:
            stream["interrupted"] = True
            stream["working"] = False
        if first_cancel:
            print(f"[WS] Stream {stream_id} cancelled by user")
        return first_cancel

    async def interrupt_stream(self, stream_id: str):
        """Cancel a stream and immediately tell UI to render it as interrupted."""
        self.cancel_stream(stream_id)
        info = self.active_streams.get(stream_id, {})
        await self.notify_ui({
            "type": "stream_interrupted",
            "stream_id": stream_id,
            "room_id": info.get("room_id"),
            "agent_id": info.get("agent_id"),
            "thread_id": info.get("thread_id"),
            "timestamp": info.get("timestamp"),
        })

    def unregister_stream_cancel(self, stream_id: str):
        """Clean up cancellation event after stream ends."""
        self._cancelled_streams.pop(stream_id, None)

    def is_stream_cancelled(self, stream_id: str) -> bool:
        """Check if a stream has been cancelled."""
        event = self._cancelled_streams.get(stream_id)
        return event.is_set() if event else False
