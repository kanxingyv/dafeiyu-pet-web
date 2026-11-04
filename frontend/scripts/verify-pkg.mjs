/**
 * Wallpaper Engine 包自检 —— 上传工坊前跑一次。
 *
 *   node scripts/verify-pkg.mjs
 *
 * 检查的是「审核/反垃圾最容易挑毛病」的几项：
 *   1. assets 下 js/css 数量（每次 build 的 hash 不同，残留旧文件 = 死代码 + 噪音）
 *   2. project.json 是否完整（preview 缺了工坊缩略图会空白）
 *   3. index.html 引用的资源是否真实存在（断链 = 白屏）
 *   4. 是否存在运行时外部 http(s) 请求（审核敏感项）
 *   5. 包体积与文件数（异常增大时能立刻发现）
 *
 * 全绿再上传。任何 ✗ 都会给出具体文件路径。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd())
const pkg = path.resolve(root, '..', 'wallpaper-pkg', 'dafeiyu-pet')

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

if (!existsSync(pkg)) {
  console.error('✗ 包目录不存在：', pkg)
  console.error('  先跑 node scripts/pack-wallpaper.mjs')
  process.exit(1)
}

// ── 1. assets 下 js/css 数量 ──
const assetsDir = path.join(pkg, 'assets')
const assetFiles = existsSync(assetsDir) ? readdirSync(assetsDir) : []
const codeFiles = assetFiles.filter((f) => f.endsWith('.js') || f.endsWith('.css'))
check(
  'assets 下 js/css ≤ 2（多出来就是旧 hash 残留）',
  codeFiles.length <= 2,
  codeFiles.join(', ') || '无',
)

// ── 2. project.json ──
const projPath = path.join(pkg, 'project.json')
let proj = {}
try {
  proj = JSON.parse(readFileSync(projPath, 'utf8'))
  check('project.json 可解析', true, '')
} catch (e) {
  check('project.json 可解析', false, String(e))
}
check('type = web', proj.type === 'web', String(proj.type))
check('file = index.html', proj.file === 'index.html', String(proj.file))
check('title 非空', typeof proj.title === 'string' && proj.title.length > 0, String(proj.title ?? ''))
check(
  'preview 字段存在且文件真实存在',
  typeof proj.preview === 'string' && existsSync(path.join(pkg, proj.preview)),
  proj.preview ? String(proj.preview) : '缺失',
)

// ── 3. index.html 引用是否都在包内 ──
const htmlPath = path.join(pkg, 'index.html')
if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, 'utf8')
  // 引用里的中文是 URL 编码的（%E5%8F%AF%E7%88%B1.png），比较前要解码
  const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1])
  const missing = refs.filter((r) => {
    const rel = decodeURIComponent(r)
    return !existsSync(path.join(pkg, rel))
  })
  check(
    'index.html 引用的本地资源都存在',
    missing.length === 0,
    missing.length ? `缺失: ${missing.join(', ')}` : `${refs.length} 个引用`,
  )
} else {
  check('index.html 存在', false, '缺失')
}

// ── 4. 运行时外部 http(s) 请求 ──
// 白名单：XML 命名空间、React 报错文档链接（报错文案里的静态字符串，不会发起请求）、
// github.com（左下角 dsh-pet 署名 <a> 的静态 href —— 许可要求必须挂，点开才走，不发起请求）
const allow = ['w3.org', 'reactjs.org', 'github.com']
const offenders = []
const scanDirs = [assetsDir].filter((d) => existsSync(d))
const walk = (dir) => {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(full)
    else if (/\.(js|css|html)$/.test(ent.name)) {
      const text = readFileSync(full, 'utf8')
      for (const m of text.matchAll(/https?:\/\/[a-zA-Z0-9.-]+/g)) {
        const host = m[0].replace(/^https?:\/\//, '')
        if (!allow.some((a) => host.includes(a))) offenders.push(`${path.relative(pkg, full)} → ${m[0]}`)
      }
    }
  }
}
for (const d of scanDirs) walk(d)
const uniqOffenders = [...new Set(offenders)]
check('无运行时外部 http(s) 请求', uniqOffenders.length === 0, uniqOffenders.slice(0, 5).join(' | '))

// ── 5. 体积与文件数 ──
let bytes = 0
let files = 0
const sizeWalk = (dir) => {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) sizeWalk(full)
    else {
      bytes += statSync(full).size
      files++
    }
  }
}
sizeWalk(pkg)
const mb = bytes / 1024 / 1024
check('包体积在合理范围（< 120 MB）', mb < 120, `${mb.toFixed(1)} MB / ${files} 个文件`)

// ── 输出 ──
console.log('\nWE 包自检：', pkg, '\n')
let failed = 0
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? `  — ${r.detail}` : ''}`)
  if (!r.ok) failed++
}
console.log('')
if (failed === 0) {
  console.log('全部通过，可以上传工坊。')
} else {
  console.log(`有 ${failed} 项未通过，先修再传。`)
  process.exit(1)
}
