/**
 * 打包 Wallpaper Engine 网页壁纸。
 *
 *   node scripts/pack-wallpaper.mjs
 *
 * 产出：wallpaper/dafeiyu-pet/
 *   ├── project.json      WE 的项目描述（type: web）
 *   ├── index.html        入口
 *   └── assets/…          全部素材
 *
 * 排除 anim-mov/（MOV 回落是给 iOS Safari 的，WE 的 CEF 只吃 webm，省 ~81MB）。
 * 打完把整个 dafeiyu-pet/ 文件夹丢进 WE 的 projects/myprojects/ 即可。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd())
const dist = path.join(root, 'dist')
const out = path.join(root, '..', 'wallpaper-pkg', 'dafeiyu-pet')

if (!existsSync(dist)) {
  console.error('先 npm run build —— dist 不存在')
  process.exit(1)
}

/*
 * 打包前先清空输出目录。
 *
 * 为什么必须清：每次 build 的 js/css 文件名都带新 hash（index-DtfkT8h_.js…），
 * 只覆盖不清理会残留十几个旧版本 —— 包里躺着一堆用不到的脚本、每个都含
 * WebSocket 连接代码，审核/反垃圾扫描时是明显的噪音（2026-11-04 实测包里残留 12 个旧 JS）。
 *
 * 用 unlinkSync/rmdirSync 逐个删，不用 rmSync：本机 rmSync 被 safe-delete shim
 * 替换成「移到回收站」，对不存在/被锁的目录会抛错。
 */
function cleanDir(dir) {
  if (!existsSync(dir)) return
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      cleanDir(full)
      try {
        rmdirSync(full)
      } catch {
        /* 目录非空/被占用时忽略 */
      }
    } else {
      try {
        unlinkSync(full)
      } catch {
        /* 单个文件删不掉不阻塞打包 */
      }
    }
  }
}
cleanDir(out)
mkdirSync(out, { recursive: true })

// 素材全拷，但排除 mov 回落目录
/*
 * 不用 cpSync：本机 Node 的 cpSync 覆盖「中文文件名 + \\?\ 长路径」时会在内部
 * unlink 那一步炸掉（errno 0 / code ''，报 `unlink ... 三球抛接.webm`）。
 * copyFileSync 是直接覆盖、不需要先删，绕开这个坑。
 * （2026-11-03 实测：同一个文件 fs.unlinkSync / copyFileSync 单独调都正常，
 *   cpSync 递归时就挂 —— 所以是 cpSync 自己的问题，不是文件被占用。）
 */
function copyTree(from, to, skip) {
  mkdirSync(to, { recursive: true })
  for (const ent of readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, ent.name)
    const d = path.join(to, ent.name)
    if (skip && skip(s)) continue
    if (ent.isDirectory()) copyTree(s, d, skip)
    else copyFileSync(s, d)
  }
}

copyTree(dist, out, (src) => src.includes(`${path.sep}anim-mov`))

writeFileSync(
  path.join(out, 'project.json'),
  JSON.stringify(
    {
      title: '深海女仆 · 桌宠',
      type: 'web',
      file: 'index.html',
      // 工坊封面：WE 用它显示项目缩略图，缺了这个字段列表里会是空白格子
      preview: 'preview.jpg',
      general: {
        supportsaudioplayback: false,
        properties: {},
      },
    },
    null,
    2,
  ),
)

function dirSize(p) {
  let n = 0
  for (const f of readdirRecursive(p)) n += statSync(f).size
  return n
}
function readdirRecursive(p) {
  const out = []
  for (const name of readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, name.name)
    if (name.isDirectory()) out.push(...readdirRecursive(full))
    else out.push(full)
  }
  return out
}

console.log('打包完成 →', out)
console.log('体积:', (dirSize(out) / 1024 / 1024).toFixed(1), 'MB')
console.log('下一步：把 dafeiyu-pet 整个文件夹拷到')
console.log('  steamapps/common/wallpaper_engine/projects/myprojects/')
