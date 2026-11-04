#!/usr/bin/env bash
# 拉取 iOS 用的 HEVC-alpha .mov 素材（81 MB，不进版本库）。
#
# 为什么需要：Safari / WKWebView 不认 VP9 webm 的 alpha 通道，会渲染成黑底。
# 官方在 dsh-pet 的 release 里提供了同名 .mov，放进 assets/anim-mov/ 后
# 前端会按 UA 自动切过去（见 src/engine/player.ts 的 url()）。
#
# 用法：
#   bash web/scripts/fetch-mov.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HERE/../frontend/public/assets/anim-mov"
TMP="${TMPDIR:-/tmp}/dsh-mov-assets.zip"

URLS=(
  "https://ghfast.top/https://github.com/PC2005-cloud/dsh-pet/releases/download/assets-mov/dsh-pet-mov-assets-mov.zip"
  "https://github.com/PC2005-cloud/dsh-pet/releases/download/assets-mov/dsh-pet-mov-assets-mov.zip"
)

mkdir -p "$DEST"

if [ "$(ls -1 "$DEST"/*.mov 2>/dev/null | wc -l)" -ge 100 ]; then
  echo "已存在 $(ls -1 "$DEST"/*.mov | wc -l) 个 .mov，跳过下载"
  exit 0
fi

for u in "${URLS[@]}"; do
  echo "下载: ${u:0:60}…"
  if curl -L --http1.1 --max-time 600 -o "$TMP" "$u"; then
    break
  fi
done

python - "$TMP" "$DEST" <<'PY'
import json, os, shutil, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
# 上游 zip 里是中文名，本地素材统一用编号（a001.mov…）——按 filename-map 改名，
# 不改的话 iOS 会拿着 a001.mov 的地址去要「三球抛接.mov」，静默 404 回落黑底。
name_map = json.load(open(os.path.join(os.path.dirname(dst), "filename-map.json"), encoding="utf-8"))["animations"]
z = zipfile.ZipFile(src)
n = skipped = 0
for info in z.infolist():
    if info.is_dir():
        continue
    stem = os.path.splitext(os.path.basename(info.filename))[0]
    target = name_map.get(stem)
    if not target:
        # 上游多出来的动作（本地没有对应 webm），留着也永远播不到
        skipped += 1
        continue
    out_name = os.path.splitext(target)[0] + ".mov"
    with z.open(info) as f, open(os.path.join(dst, out_name), 'wb') as out:
        shutil.copyfileobj(f, out)
    n += 1
print(f"解压 {n} 个 .mov → {dst}（已按 filename-map.json 改成编号）")
if skipped:
    print(f"跳过 {skipped} 个上游独有动作（本地没有同名 webm，播不到）")
PY

echo "完成。iOS 打开时会自动使用 .mov；不想要可整个删掉 anim-mov/（会回落 webm，黑底但动作正常）。"
