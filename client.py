#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""大肥鱼网页端 · Python 客户端

给 QQ 机器人插件、定时脚本、以后的语音模块用。零依赖（标准库 urllib）。

用法：
    from client import Fish
    fish = Fish("http://127.0.0.1:8765")
    fish.act("吃白饭")
    fish.say("主人回来啦～", image="可爱")
    fish.state("work", work_index=2)

设计原则：**失败不抛异常**（返回 False + 记一条 warning），
网页挂了不该把 QQ 机器人的回复流程带崩。
"""
from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request

log = logging.getLogger(__name__)


class Fish:
    def __init__(self, base: str = "http://127.0.0.1:8765", token: str = "", timeout: float = 5.0):
        self.base = base.rstrip("/")
        self.token = token
        self.timeout = timeout

    # ── 内部 ──────────────────────────────────────────
    def _url(self, path: str) -> str:
        url = f"{self.base}{path}"
        if self.token:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}k={urllib.parse.quote(self.token)}"
        return url

    def _post(self, path: str, body: dict | None = None) -> bool:
        try:
            data = json.dumps(body, ensure_ascii=False).encode() if body is not None else b""
            req = urllib.request.Request(
                self._url(path),
                data=data,
                method="POST",
                headers={"content-type": "application/json"} if body is not None else {},
            )
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return 200 <= r.status < 300
        except Exception as e:  # noqa: BLE001 —— 故意吞掉，网页不该拖垮机器人
            log.warning("大肥鱼网页端调用失败 %s: %s", path, e)
            return False

    def _get(self, path: str) -> dict | None:
        try:
            with urllib.request.urlopen(self._url(path), timeout=self.timeout) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa: BLE001
            log.warning("大肥鱼网页端读取失败 %s: %s", path, e)
            return None

    # ── 对外 ──────────────────────────────────────────
    def act(self, name: str, facing: str | None = None) -> bool:
        """让她做某个动作。name 必须是 /api/actions 里的名字。"""
        body: dict = {"type": "act", "name": name}
        if facing in ("left", "right"):
            body["facing"] = facing
        return self._post("/api/event", body)

    def say(self, text: str, image: str | None = None, hold_ms: int | None = None) -> bool:
        """冒一个气泡。image 是表情包名（/api/actions 的 memes 字段）。"""
        body: dict = {"type": "say", "text": text}
        if image:
            body["image"] = image
        if hold_ms:
            body["holdMs"] = hold_ms
        return self._post("/api/event", body)

    def state(self, mode: str, work_index: int | None = None) -> bool:
        """切状态：idle / work / sleep。"""
        body: dict = {"type": "state", "mode": mode}
        if work_index is not None:
            body["workIndex"] = work_index
        return self._post("/api/event", body)

    def poke(self) -> bool:
        return self._post("/api/event", {"type": "poke"})

    def actions(self) -> dict | None:
        return self._get("/api/actions")

    def health(self) -> dict | None:
        return self._get("/api/health")


if __name__ == "__main__":
    import sys

    f = Fish(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765")
    print(f.health())
