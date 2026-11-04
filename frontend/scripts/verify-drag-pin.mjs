/**
 * 拖拽「钉子模式」验收：角色屏幕位置钉在指针上，指针进边缘区时地图自行滚动。
 *
 * 断言的三个性质：
 * 1) 跟手：指针未贴边时，角色屏幕位置与指针偏差 ≤ 2px
 * 2) 边缘滚动：指针停在边缘区不动，camX 仍持续变化（地图在滚）
 * 3) 反向：拖到另一侧边缘，camX 反向滚
 *
 * 用法：node scripts/verify-drag-pin.mjs [url]
 */
import { chromium } from 'playwright'
import os from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'

const URL = process.argv[2] ?? 'http://127.0.0.1:5181'
const root = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
let exe
for (const d of (await readdir(root)).filter((x) => x.startsWith('chromium')).sort().reverse()) {
  for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
    const q = path.join(root, d, rel)
    if (existsSync(q)) {
      exe = q
      break
    }
  }
  if (exe) break
}
const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })

const read = () =>
  p.evaluate(() => {
    const world = document.querySelector('.world')
    const pet = document.querySelector('.pet-layer')
    const tr = world?.style.transform ?? ''
    const camX = -parseFloat((tr.match(/translate3d\((-?[\d.]+)px/) ?? [0, '0'])[1])
    const petX = parseFloat(pet?.style.left ?? '0')
    return { camX: +camX.toFixed(1), petX: +petX.toFixed(1), screenX: +(petX - camX).toFixed(1), vw: innerWidth }
  })

await p.goto(URL, { waitUntil: 'networkidle' })
await p.evaluate(() => {
  localStorage.setItem('dfy.scene', 'living')
  localStorage.setItem('dfy.weather', 'clear')
  localStorage.setItem('dfy.daylight', 'day')
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(3200)

const box = await p.$eval('.pet-layer', (el) => {
  const r = el.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height * 0.72 }
})
await p.mouse.move(box.x, box.y)
await p.mouse.down()

// ── 1) 中间位置：完全跟手 ──
const midX = Math.round(box.x) + 120
await p.mouse.move(midX, box.y)
await p.waitForTimeout(220)
const mid = await read()
const midErr = Math.abs(mid.screenX - midX)
console.log(`跟手（中间 x=${midX}）：screenX=${mid.screenX} 偏差=${midErr.toFixed(1)}px`, midErr <= 2 ? '✓' : '✗')

// ── 2) 右边缘区驻留：camX 持续增长 ──
const rightX = 1340
for (let i = 1; i <= 10; i++) {
  await p.mouse.move(midX + ((rightX - midX) * i) / 10, box.y)
  await p.waitForTimeout(25)
}
const seq = []
for (let i = 0; i < 6; i++) {
  seq.push(await read())
  await p.waitForTimeout(180)
}
const grew = seq.every((s, i) => i === 0 || s.camX >= seq[i - 1].camX) && seq[5].camX - seq[0].camX > 100
console.log(`右边缘驻留 1s：camX ${seq[0].camX} → ${seq[5].camX} (+${(seq[5].camX - seq[0].camX).toFixed(0)}px)`, grew ? '✓' : '✗')
const edgeErr = Math.abs(seq[5].screenX - rightX)
console.log(`  右边缘偏差=${edgeErr.toFixed(1)}px（钳制 margin 内可接受）`)

// ── 3) 左边缘：反向滚 + 完全跟手 ──
for (let i = 1; i <= 10; i++) {
  await p.mouse.move(rightX + ((160 - rightX) * i) / 10, box.y)
  await p.waitForTimeout(25)
}
const l1 = await read()
await p.waitForTimeout(500)
const l2 = await read()
console.log(`左边缘：camX ${l1.camX} → ${l2.camX}`, l2.camX < l1.camX ? '✓ 反向滚' : '✗')
console.log(`  左边缘偏差=${Math.abs(l2.screenX - 160).toFixed(1)}px`, Math.abs(l2.screenX - 160) <= 2 ? '✓' : '✗')

// ── 4) 松手：摄像机回到居中 ──
await p.mouse.up()
await p.waitForTimeout(800)
const after = await read()
console.log(`松手后 camX=${after.camX}（settleCamera 已回中）`)

// ── 5) 点击时旧画面继续播放，直到点击动作首帧就绪（人为延迟新片源，稳定复现解码窗口）──
await p.route('**/*', async (route) => {
  const url = decodeURIComponent(route.request().url())
  if (url.includes('/assets/anim/点击回应-')) {
    await new Promise((resolve) => setTimeout(resolve, 450))
  }
  await route.continue()
})
let hit = await p.$eval('.pet-hit', (el) => {
  const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(hit.x, hit.y)
await p.waitForTimeout(100)
const keptPlaying = await p.evaluate(() =>
  [...document.querySelectorAll('.pet-video')].some((v) => Number(v.style.opacity || 1) > 0 && !v.paused && v.readyState >= 2),
)
console.log(`点击动作加载期间旧画面继续播放：${keptPlaying ? '✓' : '✗'}`)
await p.waitForTimeout(700)
await p.unroute('**/*')

// ── 6) 连点 5 次 + 立刻拖 5 次：位置跟手，且拖拽动作不被旧点击/自动链抢回 ──
let comboOk = true
for (let i = 0; i < 5; i++) {
  hit = await p.$eval('.pet-hit', (el) => {
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await p.mouse.click(hit.x, hit.y)
  await p.waitForTimeout(25)
  await p.mouse.down()
  const targetX = hit.x + (i % 2 === 0 ? 90 : -90)
  await p.mouse.move(targetX, hit.y, { steps: 4 })
  await p.waitForTimeout(500)
  const pos = await read()
  const dragVisible = await p.evaluate(() =>
    [...document.querySelectorAll('.pet-video')].some(
      (v) => v.style.opacity === '1' && decodeURIComponent(v.dataset.url ?? '').includes('被鼠标拖拽悬空反馈'),
    ),
  )
  const err = Math.abs(pos.screenX - targetX)
  const ok = err <= 2 && dragVisible
  comboOk = comboOk && ok
  console.log(`点击后立刻拖拽 #${i + 1}：偏差=${err.toFixed(1)}px 拖拽动作保持=${dragVisible}`, ok ? '✓' : '✗')
  await p.mouse.up()
  await p.waitForTimeout(700)
}

const coreOk = midErr <= 2 && grew && l2.camX < l1.camX && Math.abs(l2.screenX - 160) <= 2
if (!coreOk || !keptPlaying || !comboOk) process.exitCode = 1
await b.close()
