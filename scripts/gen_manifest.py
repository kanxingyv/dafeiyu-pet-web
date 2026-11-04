#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 dsh-pet 的 config.jsonc 生成网页端 manifest.json。

为什么要这一步：
    动作清单、权重、镜像规则、事件档位全部写在 dsh-pet 的 config.jsonc 里（JSONC，带注释）。
    网页端不该硬编码这 106 个名字 —— 让数据驱动，以后换 pet pack 或加动作只改配置。

三条路径（默认值即日常用法，不带参数就能跑）：
    config  默认取 dsh-pet 包内的 assets/config.jsonc；想自持就复制一份到
            web/assets/config.mine.jsonc 再用 --config 指过去（包升级不会冲掉你的改动）
    webm    默认扫 web/frontend/public/assets/anim/ —— **以磁盘上真实存在的文件为准**，
            不存在的动作会被跳过并警告，避免「面板里有名字、点开 404」
    out     默认 web/frontend/public/assets/manifest.json

素材文件名是**编号**（a001.webm / m001.png），不是中文名 —— 中文名在打包、上传工坊、
跨平台解压时都踩过坑。名字↔文件的对应关系在 `filename-map.json`（与 manifest 同级），
本脚本读它来填 file 字段；**没有映射的动作会被跳过并报错**，不会退回中文名。

加动作的最小闭环：
    1) 把视频丢进 anim/，并在 filename-map.json 的 animations 里登记「动作名 → aNNN.webm」
       （用 make_action.py 生成的会自动登记）
    2) 在 config 的 animations.categories 某个分类 actions 里加「动作名」
    3) 重跑本脚本

用法：
    python web/scripts/gen_manifest.py
    python web/scripts/gen_manifest.py --config web/assets/config.mine.jsonc
    python web/scripts/gen_manifest.py --src <dsh-pet 目录> --out <manifest 路径>

默认 src = ~/.dsh/profiles/desktop/node_modules/dsh-pet
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

DEFAULT_SRC = Path.home() / ".dsh/profiles/desktop/node_modules/dsh-pet"


def strip_jsonc(text: str) -> str:
    """去掉 // 与 /* */ 注释，保留字符串里的内容（不能用正则一刀切，URL 里也有 //）。"""
    out: list[str] = []
    i, n = 0, len(text)
    in_str = False
    quote = ""
    while i < n:
        ch = text[i]
        if in_str:
            out.append(ch)
            if ch == "\\" and i + 1 < n:  # 转义：整对吃掉
                out.append(text[i + 1])
                i += 2
                continue
            if ch == quote:
                in_str = False
            i += 1
            continue
        # 非字符串状态
        if ch in ('"', "'"):
            in_str, quote = True, ch
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n:
            nxt = text[i + 1]
            if nxt == "/":
                j = text.find("\n", i)
                i = n if j < 0 else j  # 保留换行
                continue
            if nxt == "*":
                j = text.find("*/", i + 2)
                i = n if j < 0 else j + 2
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def load_jsonc(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8-sig")
    # 容忍尾逗号（JSONC 允许，json 模块不允许）
    cleaned = strip_jsonc(raw)
    import re

    cleaned = re.sub(r",(\s*[}\]])", r"\1", cleaned)
    return json.loads(cleaned)


def collect_anim_names(cfg: dict) -> dict[str, str]:
    """动作名 → 所属分类（idle / turn / drag / clicks / move / 分类名 / 事件名）。"""
    anims = cfg.get("animations") or {}
    where: dict[str, str] = {}

    def put(name, cat):
        if isinstance(name, str) and name:
            where.setdefault(name, cat)

    for key in ("idle", "turn", "drag", "clicks"):
        for name in anims.get(key) or []:
            put(name, key)

    for act in (anims.get("moves") or {}).get("actions") or []:
        put((act or {}).get("name"), "move")

    for cat in anims.get("categories") or []:
        for name in (cat or {}).get("actions") or []:
            put(name, (cat or {}).get("id") or "category")

    for ev, slots in (anims.get("events") or {}).items():
        if not isinstance(slots, list):
            continue
        for slot in slots:
            if isinstance(slot, str):
                put(slot, f"event:{ev}")
            elif isinstance(slot, list):
                for name in slot:
                    put(name, f"event:{ev}")
    return where


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(DEFAULT_SRC), help="dsh-pet 包目录（只用来找默认 config 与兜底 webm）")
    ap.add_argument("--config", default=None, help="配置文件路径；默认 <src>/assets/config.jsonc")
    ap.add_argument("--anim-dir", default=None, help="webm 目录；默认 <manifest 同级>/anim")
    ap.add_argument("--out", default=None, help="manifest 输出路径")
    args = ap.parse_args()

    out = Path(args.out) if args.out else Path(__file__).resolve().parents[1] / "frontend/public/assets/manifest.json"

    src = Path(args.src)
    cfg_path = Path(args.config) if args.config else src / "assets" / "config.jsonc"
    if not cfg_path.exists():
        print(f"[ERR] 找不到 {cfg_path}", file=sys.stderr)
        return 2

    # 动作以「磁盘上实际有的 webm」为准，配置只提供分类与权重
    anim_dir = Path(args.anim_dir) if args.anim_dir else out.parent / "anim"
    if not anim_dir.is_dir():
        anim_dir = src / "assets" / "webm"
    on_disk = {p.stem for p in anim_dir.glob("*.webm")}
    if not on_disk:
        print(f"[ERR] {anim_dir} 下没有 webm", file=sys.stderr)
        return 2

    # 名字 → 文件名的映射表。素材用编号存（a001.webm），没有它就只能靠中文名拼路径 ——
    # 而中文名正是要避免的东西，所以这里**必须**有，缺了直接失败而不是悄悄退回。
    map_path = out.parent / "filename-map.json"
    if not map_path.exists():
        print(f"[ERR] 找不到 {map_path}", file=sys.stderr)
        print("      素材是编号存放的，缺映射表就不知道「动作名」对应哪个文件。", file=sys.stderr)
        return 2
    name_map = json.loads(map_path.read_text(encoding="utf-8")) or {}
    anim_map: dict[str, str] = name_map.get("animations") or {}
    meme_map: dict[str, str] = name_map.get("memes") or {}

    cfg = load_jsonc(cfg_path)

    where = collect_anim_names(cfg)
    no_mirror = {
        name
        for cat in cfg.get("animations", {}).get("categories") or []
        if (cat or {}).get("noMirror")
        for name in (cat or {}).get("actions") or []
    }

    anims: dict[str, dict] = {}
    missing: list[str] = []
    unmapped: list[str] = []
    for name in sorted(where):
        file = anim_map.get(name)
        if not file:
            unmapped.append(name)
            continue
        if Path(file).stem not in on_disk:
            missing.append(file)
            continue
        anims[name] = {
            "file": file,
            "category": where[name],
            "mirror": name not in no_mirror,
        }

    unused = sorted(on_disk - {Path(a["file"]).stem for a in anims.values()})

    # 表情包同理：标签 → mNNN.png。配置里没登记映射的图会 404，提前喊出来。
    meme_files: dict[str, str] = {}
    for label in (cfg.get("memes") or {}):
        file = meme_map.get(label)
        if file:
            meme_files[label] = file
        else:
            print(f"[WARN] 表情包「{label}」在 filename-map.json 里没有映射（前端会 404）", file=sys.stderr)

    manifest = {
        "version": 1,
        "generator": "web/scripts/gen_manifest.py",
        "source": {
            "package": "dsh-pet",
            "license": "MIT",
            "copyright": "Copyright (c) 2026 PC2005-cloud",
            "homepage": "https://github.com/PC2005-cloud/dsh-pet",
        },
        "baseWidth": 462,
        "animations": anims,
        "pools": {
            "idle": cfg.get("animations", {}).get("idle") or [],
            "turn": cfg.get("animations", {}).get("turn") or [],
            "drag": cfg.get("animations", {}).get("drag") or [],
            "clicks": cfg.get("animations", {}).get("clicks") or [],
            "moves": cfg.get("animations", {}).get("moves") or {},
            "categories": cfg.get("animations", {}).get("categories") or [],
            "events": cfg.get("animations", {}).get("events") or {},
        },
        "weights": cfg.get("animationWeights") or {"idle": 10, "turn": 5, "move": 5},
        "memes": cfg.get("memes") or {},
        "memeFiles": meme_files,
        "workStatusTexts": cfg.get("workStatusTexts") or [],
    }

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[OK] 动作 {len(anims)} 个 / 池子动作 {len(where)} 个 → {out}")
    print(f"     webm 来源 {anim_dir}")
    print(f"     配置 {cfg_path}")
    print(f"     体积 {out.stat().st_size / 1024:.0f} KB")
    if missing:
        print(f"[WARN] 配置里有但磁盘缺文件（已跳过）: {', '.join(missing)}")
    if unmapped:
        print(f"[ERR] 这些动作没有登记到 filename-map.json（已跳过）: {', '.join(unmapped)}")
    if unused:
        print(f"[INFO] 磁盘上有但配置没引用: {', '.join(unused)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
