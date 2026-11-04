/**
 * 验收「家具可站立」和「快速松手不悬停」。
 *
 * 三个场景（书房：书桌 y=0.553 / 地面 standY=0.94）：
 *   1. 拖到桌面上方松手 → 停在桌面高度，不掉回地面
 *   2. 从桌面拖到桌外空地松手 → 落回地面
 *   3. 快速拖到半空 + 立刻松手 → 必须落到某个支撑面，不能停在任意高度（老板报的 bug）
 *
 * 判据用「相对高度」而不是绝对像素：角色脚底在地面时的 y 记为 0，
 * 桌面期望 ≈ -(standY - 0.553) * worldH。
 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const room = process.argv[3] ?? 'study'
const surfaceY = parseFloat(process.argv[4] ?? '0.553')
const standY = parseFloat(process.argv[5] ?? '0.94')

const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto(url, { waitUntil: 'networkidle' })
await p.evaluate((r) => {
  localStorage.setItem('dfy.scene', r)
  localStorage.setItem('dfy.weather', 'clear')
  localStorage.setItem('dfy.daylight', 'day')
}, room)
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(2600)

const layer = p.locator('.pet-layer')
const boxOf = async () => {
  const bx = await layer.boundingBox()
  return { x: bx.x, y: bx.y, w: bx.width, h: bx.height }
}

const base = await boxOf()
const cx = base.x + base.w / 2
const cy = base.y + base.h / 2
const worldH = await p.evaluate(() => {
  // 用角色容器高反推世界高：boxH = roleH / 0.748，roleH = worldH * 0.42
  const el = document.querySelector('.pet-layer')
  return el ? parseFloat(el.style.height) / (0.42 / (0.915 - 0.167)) : 800
})
const deskExpect = (standY - surfaceY) * worldH

async function dragBy(dx, dy, steps = 12, settle = 400) {
  await p.mouse.move(cx, cy)
  await p.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await p.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps)
    await p.waitForTimeout(16)
  }
  if (settle) await p.waitForTimeout(settle)
  await p.mouse.up()
  await p.waitForTimeout(1300)
}

// 1) 拖到桌面上方（桌面在中间，横向几乎不用动）
await dragBy(-30, -Math.round(deskExpect + 40))
const onDesk = await boxOf()
const h1 = base.y - onDesk.y
const okDesk = Math.abs(h1 - deskExpect) < 30
console.log(`① 拖到书桌松手：抬高 ${h1.toFixed(0)}px（期望 ${deskExpect.toFixed(0)}）${okDesk ? '✅ 停在桌面' : '❌ 没停住'}`)

// 2) 从桌面拖到左边空地（桌外）→ 应该掉回地面
const cx2 = onDesk.x + onDesk.w / 2
const cy2 = onDesk.y + onDesk.h / 2
await p.mouse.move(cx2, cy2)
await p.mouse.down()
for (let i = 1; i <= 12; i++) {
  await p.mouse.move(cx2 - (worldH * 0.55 * i) / 12, cy2 - (40 * i) / 12)
  await p.waitForTimeout(16)
}
await p.waitForTimeout(300)
await p.mouse.up()
await p.waitForTimeout(1400)
const offDesk = await boxOf()
const h2 = base.y - offDesk.y
const okGround = Math.abs(h2) < 25
console.log(`② 从桌面拖到空地松手：抬高 ${h2.toFixed(0)}px ${okGround ? '✅ 已落回地面' : '❌ 还悬着'}`)

// 3) 快速拖到半空 + 立刻松手（不等跟手收敛）
await p.mouse.move(cx, cy)
await p.mouse.down()
await p.mouse.move(cx, cy - 420)
await p.mouse.up()
await p.waitForTimeout(1600)
const fast = await boxOf()
const h3 = base.y - fast.y
// 允许落在地面(0)或桌面(deskExpect)，其它高度都算悬停
const onSome = Math.abs(h3) < 25 || Math.abs(h3 - deskExpect) < 30
console.log(`③ 快速拖拽 + 立刻松手：停在 ${h3.toFixed(0)}px ${onSome ? '✅ 落在支撑面上' : '❌ 悬停在半空（bug 未修）'}`)

console.log(`页面错误 ${errs.length ? errs.join(' / ') : '无'}`)
console.log(okDesk && okGround && onSome ? '全部通过' : '有失败项')
await b.close()
