/**
 * 验收「命中区贴合角色本体」：.pet-hit 之前是 inset:0 铺满整个视频容器，
 * 而角色本体只占画布横向 33.3%~66.7%、纵向 16.7%~91.5%（见 layout.ts 实测数字）——
 * 四边一大圈透明留白也能抓到她：鼠标停在旁边的门上还显示 grab，
 * 在空地处点一下/拖动她也有反应（看起来像隔空抓人）。
 *
 *   node scripts/verify-hit.mjs http://127.0.0.1:5173
 *
 * 判据（1440×900，客厅）：
 *   - 角色身体中心 → 必须命中 .pet-hit（本体可点可拖）
 *   - 容器右侧留白（角色右缘之外 >8% 容器宽）→ 不许命中 .pet-hit
 *   - 容器上方留白（头顶之上）→ 不许命中 .pet-hit
 *   - 上述留白处的 cursor 不许是 grab
 */
import { chromium } from 'playwright'
import os from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'

const root = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
let exe
for (const d of (await readdir(root)).filter((x) => x.startsWith('chromium')).sort().reverse()) {
  for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
    if (existsSync(path.join(root, d, rel))) { exe = path.join(root, d, rel); break }
  }
  if (exe) break
}

const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.goto(url, { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)

/*
 * rect 读取和 elementFromPoint 必须在同一次 evaluate 里做原子完成：
 * 她随时可能自己溜达，分两次调用之间人可能挪了位置，判据就假阳/假阴了。
 * 身体边界用 layout.ts 里的实测数字：横 33.3%~66.7%，纵 16.7%~91.5%。
 */
const probe = (fx, fy) =>
  p.evaluate(([fx, fy]) => {
    const el = document.querySelector('.pet-layer')
    const r = el.getBoundingClientRect()
    const bodyL = r.left + r.width * 0.333
    const bodyR = r.left + r.width * 0.667
    const bodyT = r.top + r.height * 0.167
    const bodyB = r.top + r.height * 0.915
    const x = bodyL + (bodyR - bodyL) * fx
    const y = bodyT + (bodyB - bodyT) * fy
    const hit = document.elementFromPoint(x, y)
    const cursor = hit ? getComputedStyle(hit).cursor : '(none)'
    return {
      x: Math.round(x),
      y: Math.round(y),
      cls: hit?.className ?? '(null)',
      isHit: hit?.classList?.contains('pet-hit') ?? false,
      cursor,
      boxW: Math.round(r.width),
    }
  }, [fx, fy])

let fail = 0
const check = (name, ok, info) => {
  console.log(`${ok ? '✓' : '✗'} ${name}  →  (${info.x},${info.y}) 命中=${info.cls} cursor=${info.cursor}`)
  if (!ok) fail++
}

// ① 身体中心：必须能点能拖
const c = await probe(0.5, 0.5)
check('身体中心命中 pet-hit', c.isHit && c.cursor === 'grab', c)

// ② 容器右侧留白（fx=1.2 → 角色右缘外约一大步，即截图里红框那类位置）
const r = await probe(1.2, 0.5)
check('右侧留白不命中 / 不是 grab', !r.isHit && r.cursor !== 'grab', r)

// ③ 头顶上方留白（fy=-0.15）
const t = await probe(0.5, -0.15)
check('头顶上方不命中 / 不是 grab', !t.isHit && t.cursor !== 'grab', t)

// ④ 拖动对照：先 pause 冻结自动链（她自己随时会溜达，不冻住的话 petX 的变化分不清
//    是「被拖走」还是「自己走」，判据就是玄学）。
await p.evaluate(() => window.__fish?.pause())
const petX = () => p.evaluate(() => parseFloat(document.querySelector('.pet-layer').style.left))

// pause 拦得住「开新动作」，拦不住在途的 walkTo rAF。
// 静止窗口要 > 2s：走动动作有最长 ~2s 的 lead 原地准备期，短窗会把「蓄力中」误判成「停稳」。
let x0 = await petX()
let quiet = 0
for (let i = 0; i < 66 && quiet < 5; i++) {
  await p.waitForTimeout(500)
  const cur = await petX()
  quiet = Math.abs(cur - x0) < 0.5 ? quiet + 1 : 0
  x0 = cur
}

const dragAt = async (fx) => {
  // 拖拽方向动态朝房间中心：她要是正贴着可走边界，往墙里拖会被拖拽边界 clamp 掉，
  // 位移就只剩 clamp 的零头，正反对照全乱
  const pt = await p.evaluate((fx) => {
    const el = document.querySelector('.pet-layer')
    const rr = el.getBoundingClientRect()
    const bl = rr.left + rr.width * 0.333
    const br = rr.left + rr.width * 0.667
    const bt = rr.top + rr.height * 0.167
    const bb = rr.top + rr.height * 0.915
    const petX = parseFloat(el.style.left)
    const worldW = parseFloat(document.querySelector('.world').style.width)
    const dir = worldW / 2 > petX ? 1 : -1
    return { x: Math.round(bl + (br - bl) * fx), y: Math.round((bt + bb) / 2), dir }
  }, fx)
  await p.mouse.move(pt.x, pt.y)
  await p.mouse.down()
  // 拟人节奏：多步慢慢拖 + 松手前留 250ms 让跟随收敛
  await p.mouse.move(pt.x + pt.dir * 120, pt.y, { steps: 24 })
  await p.waitForTimeout(250)
  await p.mouse.up()
  await p.waitForTimeout(400)
}

await dragAt(1.2) // 空地：不该带得走她
const x1 = await petX()
await dragAt(0.5) // 身体：拖拽机制本身必须是好的（对照）
const x2 = await petX()
check('右侧留白拖动带不走她', Math.abs(x1 - x0) < 1, { x: 0, y: 0, cls: `petX ${x0}→${x1}`, cursor: '-' })
check('身体上照样拖得动（对照）', Math.abs(x2 - x1) > 50, { x: 0, y: 0, cls: `petX ${x1}→${x2}`, cursor: '-' })

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项不通过`)
await b.close()
process.exit(fail === 0 ? 0 : 1)
