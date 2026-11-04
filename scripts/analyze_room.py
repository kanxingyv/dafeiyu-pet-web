#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从房间背景图里自动判断「地面线」在哪，产出 scene.json。

为什么要它：
    角色跑动时必须踩在地上，不能飘在墙上。手写一个 y 值最省事，
    但换一张背景图就得重新量 —— 所以让脚本看图算，量完画一条线给人复核。

判据（单张室内图的常识）：
    1. **水平边缘能量**：墙纸多是竖向花纹/竖条纹，行内相邻像素差异大；
       地板是横向木纹，行内相对平缓。→ 地板行的水平梯度低。
    2. **暖色程度**：木地板 R 明显高于 B，墙纸通常偏冷（蓝绿）。
    3. **位置先验**：地面只可能在画面下半部分。

输出：
    scene.json —— 前端直接读
    ground-check.png —— 把判定线画在原图上，人眼一秒钟就能看出对不对

用法：
    python web/scripts/analyze_room.py [图片路径] [输出目录]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

# 只在下半部分找地面（上限：画面 38% 处；下限：画面 96% 处）
SEARCH_TOP = 0.38
SEARCH_BOTTOM = 0.96


def load(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGB")
    return im


def row_features(im: Image.Image) -> list[dict]:
    """逐行算三个特征：水平边缘能量、暖度、亮度。"""
    w, h = im.size
    px = im.load()
    # 横向抽样，够用且快（1536 宽抽 384 个点）
    step = max(1, w // 384)
    rows = []
    for y in range(h):
        edge = 0.0
        warm = 0.0
        lum = 0.0
        sr = sg = sb = 0.0
        n = 0
        prev = None
        for x in range(0, w, step):
            r, g, b = px[x, y]
            if prev is not None:
                edge += abs(r - prev[0]) + abs(g - prev[1]) + abs(b - prev[2])
            prev = (r, g, b)
            warm += (r - b)
            lum += 0.299 * r + 0.587 * g + 0.114 * b
            sr += r
            sg += g
            sb += b
            n += 1
        rows.append(
            {
                "y": y,
                "edge": edge / max(1, n - 1),
                "warm": warm / max(1, n),
                "lum": lum / max(1, n),
                "r": sr / max(1, n),
                "g": sg / max(1, n),
                "b": sb / max(1, n),
            }
        )
    return rows


def find_ground(rows: list[dict], h: int) -> tuple[int, list[float]]:
    """返回 (墙脚行号, 每行得分)。

    走过的弯路：
      1. 取「得分最高的行」→ 永远是最底部那块纯地板（93%），没用。
      2. 取「得分上升沿最陡的行」→ 会被窗台、柜子边缘抢走（54.9%），也没用。

    现在改成**从底部往上找地板的尽头**：地板（含地毯）在颜色上是连续的，
    墙纸是另一套色系。所以从画面底部取参照色往上扫，第一次「连续几行都不像底部」
    的地方就是墙脚。
    """
    y0, y1 = int(h * SEARCH_TOP), int(h * SEARCH_BOTTOM)

    scores = [0.0] * h
    for y in range(y0, y1):
        scores[y] = rows[y]["warm"] / 255.0 - rows[y]["edge"] / 255.0

    # 参照色：最底部 8 行的平均 RGB（那里一定是地板）
    def rgb_at(y: int) -> tuple[float, float, float]:
        return (rows[y].get("r", 0.0), rows[y].get("g", 0.0), rows[y].get("b", 0.0))

    ref = [0.0, 0.0, 0.0]
    base = range(max(0, h - 8), h)
    for y in base:
        r, g, b = rgb_at(y)
        ref[0] += r / len(base)
        ref[1] += g / len(base)
        ref[2] += b / len(base)

    # 从下往上扫：连续 4 行与参照色差距过大 → 地板到此为止
    THRESH = 46.0
    need = 4
    run = 0
    wall_y = y0
    for y in range(h - 1, y0, -1):
        r, g, b = rgb_at(y)
        d = ((r - ref[0]) ** 2 + (g - ref[1]) ** 2 + (b - ref[2]) ** 2) ** 0.5
        if d > THRESH:
            run += 1
            if run >= need:
                wall_y = y + need
                break
        else:
            run = 0
    return wall_y, scores


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("image", nargs="?", default="web/frontend/public/assets/bg/room.webp")
    ap.add_argument("outdir", nargs="?", default=None)
    ap.add_argument("--wall", type=float, default=None, help="手工指定墙脚线（0-1），覆盖自动结果")
    ap.add_argument("--stand", type=float, default=None, help="手工指定角色站立线（0-1）")
    args = ap.parse_args()

    src = Path(args.image)
    outdir = Path(args.outdir) if args.outdir else src.parent
    if not src.exists():
        print(f"[ERR] 找不到 {src}", file=sys.stderr)
        return 2

    im = load(src)
    w, h = im.size
    rows = row_features(im)
    wall_y, _scores = find_ground(rows, h)
    source = "自动分析"

    # 自动结果被地毯/家具抢走时，允许手工校正（脚本会把这个值写进 scene.json）
    if args.wall is not None:
        wall_y = int(args.wall * h)
        source = "手工指定"
    if args.stand is not None:
        stand_y = int(args.stand * h)
    else:
        # 角色站立线：站在地板靠前一点，有"人站在屋里"的纵深感
        stand_y = int(wall_y + (h - wall_y) * 0.5)

    scene = {
        "image": src.name,
        "imageWidth": w,
        "imageHeight": h,
        "wallY": round(wall_y / h, 4),
        "standY": round(stand_y / h, 4),
        "walkableX": [0.04, 0.96],
        "source": source,
        "note": "web/scripts/analyze_room.py 生成；线画得不对就用 --wall/--stand 手工校正",
    }
    (outdir / "scene.json").write_text(json.dumps(scene, ensure_ascii=False, indent=2), encoding="utf-8")

    # 标注图：蓝线 = 墙脚线，绿线 = 角色站立线
    mark = im.copy()
    mp = mark.load()
    for x in range(w):
        for t in range(3):
            mp[x, min(h - 1, wall_y + t)] = (40, 110, 230)
            mp[x, min(h - 1, stand_y + t)] = (30, 170, 90)
    mark.save(outdir / "ground-check.png")

    print(f"图片 {w}×{h}")
    print(f"墙脚线 y={wall_y} ({wall_y / h:.1%})   站立线 y={stand_y} ({stand_y / h:.1%})   来源：{source}")
    print(f"→ {outdir / 'scene.json'}")
    print(f"→ {outdir / 'ground-check.png'}（打开看一眼线画得对不对）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
