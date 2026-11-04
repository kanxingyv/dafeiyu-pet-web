/**
 * 验收拖拽：
 *   1. 拖拽时背景跟着动（camX 变化）
 *   2. 背景到尽头后 camX 停住，角色继续在屏幕上滑
 *   3. 松手后停住、摄像机回中
 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
const p = await b.newPage({ viewport: { width: 390, height: 844 } })
await p.goto(url, { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)

const snap = () => p.evaluate(() => {
  const pet = document.querySelector('.pet-layer')
  const world = document.querySelector('.world')
  const r = pet.getBoundingClientRect()
  const m = /translate3d\((-?[\d.]+)px/.exec(world.style.transform || '')
  return {
    screenX: Math.round(r.x + r.width / 2),
    camX: m ? -Math.round(parseFloat(m[1])) : 0,
    worldW: Math.round(world.getBoundingClientRect().width),
  }
})

const box = await p.evaluate(() => {
  const r = document.querySelector('.pet-layer').getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height * 0.6 }
})

// 按住往左一路拖，看背景是否跟、到尽头是否停
await p.mouse.move(box.x, box.y)
await p.mouse.down()
await p.waitForTimeout(80)
const track = []
for (let i = 1; i <= 26; i++) {
  await p.mouse.move(box.x - i * 26, box.y)
  await p.waitForTimeout(110)
  track.push(await snap())
}
await p.mouse.up()
await p.waitForTimeout(900)
const after = await snap()

const camStart = track[0].camX
const camMin = Math.min(...track.map((s) => s.camX))
const camEnd = track[track.length - 1].camX
const screenMoved = track[track.length - 1].screenX - track[0].screenX
const hitWall = track.some((s) => s.camX <= 1)

console.log('起点:', JSON.stringify(track[0]))
console.log('终点:', JSON.stringify(camEnd ? track[track.length - 1] : after))
console.log(`背景位移 ${camStart - camEnd}px ${camStart - camEnd > 60 ? '✅ 背景跟着动了' : '❌ 背景没动'}`)
console.log(`到尽头(${camMin}px)后角色继续滑 ${screenMoved}px ${hitWall && Math.abs(screenMoved) > 20 ? '✅ 符合「除非到尽头」' : hitWall ? '⚠️ 到尽头了但角色没继续滑' : '（没拖到尽头）'}`)
console.log(`松手后角色屏幕x=${after.screenX}（居中=195）`)
await b.close()
