#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把几段现有动画拼成一个新动作（不需要绿幕源视频）。

为什么要有这个：
    dsh-pet 的正式素材链（prompts/ + scripts/）要求你先有 AI 生成的绿幕 mp4，
    门槛在于「生成」而不在于「处理」。但手上这 106 段有个很好的性质：
    每一段都是 640×360、角色居中、脚底落在 91.5%、**首尾帧都是标准正面站立**。
    所以它们天然可以任意首尾相接，硬切也不跳帧 —— 新动作可以先靠「编排」拿到。

    什么时候该改用正式素材链：
    想要的是「她做了件原来没做过的事」（新表情、新道具、新动作语义），
    而不是「把已有动作接起来」。那时才需要 prompts/ 的绿幕配方。

用法：
    python web/scripts/make_action.py 午后打盹 哈欠连天 原地小憩沉眠 打瞌睡被惊醒
    python web/scripts/make_action.py 摸鱼被抓 写代码 偷吃零食被抓住 --crf 30
    python web/scripts/make_action.py 慢速女仆舞 优雅女仆舞 --speed 0.6

    # 只看会产出什么，不落盘
    python web/scripts/make_action.py 测试 哈欠连天 吃白饭 --dry-run

输出的 webm 按编号进 assets/anim/（aNNN.webm），并自动在 filename-map.json 里
登记「动作名 → 文件名」。接下来只差一步：在 web/assets/config.mine.jsonc 的某个分类
actions 里加上这个名字，重跑 gen_manifest.py。

    ⚠️ 别再用中文名当文件名 —— 中文文件名在打包 / 上传工坊 / 跨平台解压时都出过问题，
    所以磁盘上只存 a001.webm 这种编号，名字只活在配置与映射表里。
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANIM_DIR = ROOT / "frontend/public/assets/anim"
MAP_PATH = ROOT / "frontend/public/assets/filename-map.json"

# VP9-alpha 的编码参数，改动前先读这段：
#   -pix_fmt yuva420p   必须。只写 yuv420p 会得到黑底，浏览器里一眼假。
#   -auto-alt-ref 0     必须。alt-ref 帧不支持 alpha 平面，开着会丢透明。
#   -b:v 0 -crf N       libvpx-vp9 的恒定质量模式；crf 越小越清晰、文件越大（32 ≈ 原素材体量）。
#   输入侧 -c:v libvpx-vp9  必须。ffmpeg 自带的 native vp9 解码器**不读 alpha 平面**，
#                       不加这个参数，alphaextract 会报 "Requested planes not available"。
ENCODE_ARGS = [
    "-c:v", "libvpx-vp9",
    "-pix_fmt", "yuva420p",
    "-auto-alt-ref", "0",
    "-b:v", "0",
]


def find_ffmpeg() -> str:
    """按「PATH → winget Links」顺序找 ffmpeg。

    为什么要两段：winget 装完会改进注册表里的 PATH，但**当前这个 shell 读不到**，
    重开终端才生效。用户装完立刻跑脚本是常态，不能让他先重开窗口。

    为什么不做更聪明的兜底：试过 @ffmpeg-installer 那个 2018 年的构建 —— 它能跑，
    但**解不出 alpha 平面**（native vp9 解码器不读 alpha），转出来的动作一圈黑底
    且全程不报错。静默产出废品比直接失败糟得多，所以宁可这里报「找不到」，
    让人去装个新版。
    """
    found = shutil.which("ffmpeg")
    if found:
        return found
    win_get = Path.home() / "AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe"
    if win_get.exists():
        return str(win_get)
    print("[ERR] 找不到 ffmpeg。装一个：winget install Gyan.FFmpeg", file=sys.stderr)
    raise SystemExit(2)


def load_map() -> dict:
    """读 filename-map.json；缺了就现造一个空壳（第一次用这脚本时很常见）。"""
    if MAP_PATH.exists():
        return json.loads(MAP_PATH.read_text(encoding="utf-8")) or {}
    return {"animations": {}, "memes": {}}


def save_map(data: dict) -> None:
    MAP_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def alloc_name(data: dict) -> str:
    """下一个没用过的编号（a110.webm…）。按数字取 max+1，删过中间几个也不会撞。"""
    used = set()
    for f in (data.get("animations") or {}).values():
        m = re.fullmatch(r"a(\d{3,})\.webm", f)
        if m:
            used.add(int(m.group(1)))
    n = max(used) + 1 if used else 1
    while (ANIM_DIR / f"a{n:03d}.webm").exists():
        n += 1
    return f"a{n:03d}.webm"


def resolve(names: list[str]) -> list[Path]:
    """动作名 → webm 路径，缺一个都不干（宁可报错也别产出半截动作）"""
    data = load_map()
    anim_map: dict[str, str] = data.get("animations") or {}
    paths: list[Path] = []
    missing: list[str] = []
    for n in names:
        file = anim_map.get(n)
        p = ANIM_DIR / file if file else None
        if p and p.exists():
            paths.append(p)
        else:
            missing.append(n if not file else f"{n}({file} 不存在)")
    if missing:
        print(f"[ERR] 找不到这些动作：{', '.join(missing)}", file=sys.stderr)
        print(f"      目录：{ANIM_DIR}", file=sys.stderr)
        print(f"      映射：{MAP_PATH}", file=sys.stderr)
        raise SystemExit(2)
    return paths


def build(out_name: str, names: list[str], crf: int, speed: float, dry: bool) -> int:
    srcs = resolve(names)
    data = load_map()
    anim_map: dict[str, str] = data.setdefault("animations", {})
    out_file = anim_map.get(out_name) or alloc_name(data)
    out = ANIM_DIR / out_file
    if out.exists():
        print(f"[WARN] {out.name} 已存在，会被覆盖")

    ffmpeg = find_ffmpeg()
    cmd = [ffmpeg, "-hide_banner", "-y", "-loglevel", "error"]
    for p in srcs:
        # 每个输入都要指定 libvpx-vp9 解码器，否则拿不到 alpha 平面
        cmd += ["-c:v", "libvpx-vp9", "-i", str(p)]

    # 变速用 setpts，作用在拼接之后：整段统一节奏，段与段之间不会出现快慢不一
    chain = "".join(f"[{i}:v]" for i in range(len(srcs)))
    filt = f"{chain}concat=n={len(srcs)}:v=1:a=0[v]"
    if speed != 1.0:
        filt += f";[v]setpts=PTS/{speed}[v2]"
        last = "[v2]"
    else:
        last = "[v]"

    cmd += ["-filter_complex", filt, "-map", last]
    cmd += ENCODE_ARGS + ["-crf", str(crf), "-an", str(out)]

    print(f"[..] {' + '.join(names)}")
    print(f"     → {out.name}  ({len(names)} 段, crf {crf}, 速度 x{speed})")
    if dry:
        print("[dry-run] " + " ".join(cmd))
        return 0

    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("[ERR] ffmpeg 失败：", file=sys.stderr)
        print(r.stderr[-2000:], file=sys.stderr)
        return 1

    size = out.stat().st_size
    dur = probe_duration(ffmpeg, out)
    print(f"[OK] {out}  {size / 1024:.0f} KB  {dur:.1f}s")
    if anim_map.get(out_name) != out_file:
        anim_map[out_name] = out_file
        save_map(data)
        print(f"[OK] 已登记映射：{out_name} → {out_file}")
    print(f"     下一步：把「{out_name}」加进 config 的分类 actions，再跑 gen_manifest.py")
    return 0


def probe_duration(ffmpeg: str, p: Path) -> float:
    ffprobe = str(Path(ffmpeg).with_name("ffprobe.exe"))
    if not Path(ffprobe).exists():
        ffprobe = "ffprobe"
    r = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", "-c:v", "libvpx-vp9", str(p)],
        capture_output=True, text=True,
    )
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def main() -> int:
    ap = argparse.ArgumentParser(description="把几段现有动画拼成一个新动作")
    ap.add_argument("out", help="新动作名（就是 webm 文件名）")
    ap.add_argument("parts", nargs="+", help="按播放顺序排的现有动作名")
    ap.add_argument("--crf", type=int, default=32, help="质量，越小越清晰（默认 32）")
    ap.add_argument("--speed", type=float, default=1.0, help="整体倍速，<1 慢放 >1 快进（默认 1）")
    ap.add_argument("--dry-run", action="store_true", help="只打印命令，不实际转码")
    args = ap.parse_args()

    if len(args.parts) < 1:
        print("[ERR] 至少要一个源动作", file=sys.stderr)
        return 2
    return build(args.out, args.parts, args.crf, args.speed, args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
