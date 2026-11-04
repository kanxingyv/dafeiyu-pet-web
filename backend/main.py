# -*- coding: utf-8 -*-
"""大肥鱼网页端 · 后端

职责只有三件：
  1. 托管前端静态文件（dist/）
  2. 提供一个**统一事件入口**，任何程序（QQ 机器人插件、脚本、以后的语音）都能调她
  3. 用 WebSocket 把事件广播给所有打开的页面 —— 手机和电脑看到同一只鱼做同一个动作

刻意保持极简：单进程、无数据库、状态全在内存。
服务器只有 1 GB 可用内存，这里常驻应控制在 100 MB 内。
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
# 两种部署形态：本地是 web/backend/main.py（前端在上一级），
# 容器里 main.py 和 frontend/ 平铺在 /app。这里按「哪层有 frontend/」自动认。
ROOT = next((p for p in (HERE, HERE.parent) if (p / "frontend").is_dir()), HERE)
DIST = ROOT / "frontend" / "dist"
ASSETS = ROOT / "frontend" / "public" / "assets"

# 访问口令：为空 = 不校验（本地开发）。线上建议设置，避免任何人都能指挥她
TOKEN = os.environ.get("DAFEIYU_WEB_TOKEN", "").strip()


def _load_manifest() -> dict[str, Any]:
    for p in (ASSETS / "manifest.json", DIST / "assets" / "manifest.json"):
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    return {}


MANIFEST = _load_manifest()
ANIM_NAMES: set[str] = set(MANIFEST.get("animations", {}))
MEME_NAMES: set[str] = set(MANIFEST.get("memes", {}))


# ── 事件模型 ────────────────────────────────────────────
class Event(BaseModel):
    """统一事件。type 决定 payload 怎么解释，加新事件类型不用改老逻辑。"""

    type: Literal["act", "say", "state", "poke", "reload"]
    # act
    name: str | None = None
    facing: Literal["left", "right"] | None = None
    # say
    text: str | None = None
    image: str | None = None
    holdMs: int | None = Field(default=None, ge=300, le=60_000)
    voice: str | None = None
    # state
    mode: Literal["idle", "work", "sleep"] | None = None
    workIndex: int | None = Field(default=None, ge=0, le=10)


class Hub:
    """内存里的一份连接表 + 最近一次状态（新页面打开时补发，避免空白）。"""

    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.last: dict[str, Any] | None = None
        self.lock = asyncio.Lock()

    async def join(self, ws: WebSocket) -> None:
        async with self.lock:
            self.clients.add(ws)
        if self.last:
            try:
                await ws.send_text(json.dumps(self.last, ensure_ascii=False))
            except Exception:
                pass

    async def leave(self, ws: WebSocket) -> None:
        async with self.lock:
            self.clients.discard(ws)

    async def broadcast(self, ev: dict[str, Any]) -> int:
        if ev.get("type") in ("act", "state"):
            self.last = ev
        payload = json.dumps(ev, ensure_ascii=False)
        dead: list[WebSocket] = []
        for ws in list(self.clients):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.leave(ws)
        return len(self.clients)


hub = Hub()
app = FastAPI(title="大肥鱼 · 在家", docs_url="/api/docs", openapi_url="/api/openapi.json")


def check_token(token: str | None) -> None:
    if TOKEN and token != TOKEN:
        raise HTTPException(status_code=401, detail="bad token")


# ── 路由 ────────────────────────────────────────────────
@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "animations": len(ANIM_NAMES),
        "memes": len(MEME_NAMES),
        "clients": len(hub.clients),
        "tokenRequired": bool(TOKEN),
        "ts": int(time.time()),
    }


@app.get("/api/manifest")
async def manifest() -> JSONResponse:
    return JSONResponse(MANIFEST)


@app.get("/api/actions")
async def actions() -> dict[str, Any]:
    """给调用方枚举可用动作（按分类分组），省得去翻 106 个文件名。"""
    groups: dict[str, list[str]] = {}
    for name, meta in MANIFEST.get("animations", {}).items():
        groups.setdefault(meta.get("category", "other"), []).append(name)
    return {"count": len(ANIM_NAMES), "groups": groups, "memes": sorted(MEME_NAMES)}


async def dispatch(ev: Event) -> dict[str, Any]:
    """校验 + 归一化成前端能直接吃的事件，再广播。"""
    out: dict[str, Any] = {"type": ev.type}

    if ev.type == "act":
        if not ev.name:
            raise HTTPException(400, "act 需要 name")
        if ANIM_NAMES and ev.name not in ANIM_NAMES:
            raise HTTPException(404, f"没有这个动作: {ev.name}")
        out["name"] = ev.name
        if ev.facing:
            out["facing"] = ev.facing

    elif ev.type == "say":
        # 允许只发一张表情包（text 留空）—— 表情包本身就是一句"话"
        if not ev.text and not ev.image:
            raise HTTPException(400, "say 需要 text 或 image")
        content: dict[str, Any] = {}
        if ev.text:
            content["text"] = ev.text
        if ev.image:
            if MEME_NAMES and ev.image not in MEME_NAMES:
                raise HTTPException(404, f"没有这张表情包: {ev.image}")
            content["image"] = ev.image
        if ev.holdMs:
            content["holdMs"] = ev.holdMs
        if ev.voice:
            content["voice"] = ev.voice
        out["content"] = content

    elif ev.type == "state":
        if not ev.mode:
            raise HTTPException(400, "state 需要 mode")
        out["mode"] = ev.mode
        if ev.workIndex is not None:
            out["workIndex"] = ev.workIndex

    elif ev.type in ("poke", "reload"):
        pass

    clients = await hub.broadcast(out)
    return {"ok": True, "clients": clients, "event": out}


@app.post("/api/event")
async def post_event(ev: Event, token: str | None = Query(default=None)) -> dict[str, Any]:
    check_token(token)
    return await dispatch(ev)


# 便捷别名：curl 一行就能用，不用拼 JSON
@app.post("/api/act")
async def post_act(
    name: str = Query(...), facing: str | None = None, token: str | None = None
) -> dict[str, Any]:
    check_token(token)
    return await dispatch(Event(type="act", name=name, facing=facing))  # type: ignore[arg-type]


@app.post("/api/say")
async def post_say(
    text: str | None = None, image: str | None = None, token: str | None = None
) -> dict[str, Any]:
    check_token(token)
    return await dispatch(Event(type="say", text=text, image=image))


@app.get("/api/act")
async def get_act(name: str = Query(...), token: str | None = None) -> dict[str, Any]:
    """GET 版本：方便直接在浏览器地址栏戳一下验证。"""
    check_token(token)
    return await dispatch(Event(type="act", name=name))


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    await hub.join(ws)
    try:
        while True:
            raw = await ws.receive_text()
            # 页面也可以回推事件（比如以后从网页控制台发指令）
            try:
                data = json.loads(raw)
                ev = Event(**data)
            except Exception:
                continue
            try:
                await dispatch(ev)
            except HTTPException as e:
                await ws.send_text(json.dumps({"type": "error", "detail": e.detail}, ensure_ascii=False))
    except WebSocketDisconnect:
        pass
    finally:
        await hub.leave(ws)


# ── 静态文件（必须放最后，否则会吃掉 /api） ─────────────
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(DIST / "index.html")

    @app.get("/{path:path}")
    async def spa(path: str, request: Request) -> Any:
        # 静态资源直出，其余一律回 index.html（前端路由兜底）
        target = (DIST / path).resolve()
        if target.is_file() and str(target).startswith(str(DIST.resolve())):
            return FileResponse(target)
        return FileResponse(DIST / "index.html")
else:

    @app.get("/")
    async def no_build() -> dict[str, str]:
        return {"error": "前端还没构建：先在 web/frontend 执行 npm run build"}
