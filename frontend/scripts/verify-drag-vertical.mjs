/**
 * 验收拖拽：水平 + 垂直都要跟手，松手要落回地面。
 *
 * 老板的原话是「完全跟随鼠标，垂直也拖拽，像在 dsh 里一样」。
 * 判据：
 *   1. 往上拖 180px，角色 y 要跟着上去（不是只有 x 动）
 *   2. 水平拖 150px，x 跟着走（原来就有，防回归）
 *   3. 松手后回到地面线（素材是脚踩地板的站立动作，悬空会露馅）
 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = process.argv[2] ?? 'http://127.0.0.1:5173'

const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto(url, { waitUntil: 'networkidle' })
await p.waitForTimeout(2600)

const layer = p.locator('.pet-layer')
const before = await layer.boundingBox()
if (!before) throw new Error('找不到角色')

const cx = before.x + before.width / 2
const cy = before.y + before.height / 2
// 客厅中央 ±150px 已加入桌椅站立面；移到左侧空地，专测「松手回地面」。
const DX = -450
const DY = -180

await p.mouse.move(cx, cy)
await p.mouse.down()
for (let i = 1; i <= 12; i++) {
  await p.mouse.move(cx + (DX * i) / 12, cy + (DY * i) / 12)
  await p.waitForTimeout(16)
}
await p.waitForTimeout(400)
const during = await layer.boundingBox()
await p.mouse.up()
await p.waitForTimeout(1200)
const after = await layer.boundingBox()

const dxMove = during.x - before.x
const dyMove = during.y - before.y
const backY = after.y - before.y
const backX = after.x - before.x

const okX = Math.abs(dxMove - DX) < 45
const okY = Math.abs(dyMove - DY) < 45
const okDrop = Math.abs(backY) < 6

console.log(`拖动位移  期望 (${DX}, ${DY})  实际 (${dxMove.toFixed(0)}, ${dyMove.toFixed(0)})  ${okX ? '✅' : '❌'}水平 ${okY ? '✅' : '❌'}垂直`)
console.log(`松手回落  期望 y≈0  实际 y=${backY.toFixed(1)}  ${okDrop ? '✅ 已落回地面' : '❌ 没落回去'}`)
console.log(`松手后水平位置偏移 ${backX.toFixed(0)}px（摄像机回正会带一点，正常）`)
console.log(`页面错误 ${errs.length ? errs.join(' / ') : '无'}`)
const passed = okX && okY && okDrop
console.log(passed ? '全部通过' : '有失败项')
if (!passed) process.exitCode = 1
await b.close()
