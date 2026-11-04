/**
 * 验收「角色与房间的比例不随屏幕变化」：
 * 在多种屏幕尺寸下量「角色视觉高度 / 画面高度」，结果应该一致。
 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })

const sizes = [
  ['手机竖屏', 390, 844],
  ['手机横屏', 844, 390],
  ['平板', 768, 1024],
  ['笔记本', 1440, 900],
  ['带鱼屏', 2560, 1080],
  ['超宽', 3440, 1440],
]

const rows = []
for (const [name, w, h] of sizes) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2200)
  await p.evaluate(() => window.__fish?.act('待机呼吸休闲'))
  await p.waitForTimeout(1500)
  const m = await p.evaluate(() => {
    const pet = document.querySelector('.pet-layer')
    const world = document.querySelector('.world')
    const r = pet.getBoundingClientRect()
    const wr = world.getBoundingClientRect()
    // 角色在视频画布里占高 74.8%（实测），容器高 r.height
    const roleH = r.height * 0.748
    return {
      roleH: Math.round(roleH),
      vh: window.innerHeight,
      worldH: Math.round(wr.height),
      worldW: Math.round(wr.width),
      ofViewport: +(roleH / window.innerHeight).toFixed(3),
      ofWorld: +(roleH / wr.height).toFixed(3),
    }
  })
  rows.push({ name, ...m })
  await p.close()
}
await b.close()

console.log('屏幕            角色高  视口高  世界高  占视口   占房间')
for (const r of rows) {
  console.log(
    `${r.name.padEnd(10)} ${String(r.roleH).padStart(6)} ${String(r.vh).padStart(7)} ${String(r.worldH).padStart(7)}  ${String(r.ofViewport).padStart(6)}  ${String(r.ofWorld).padStart(6)}`,
  )
}
const ofWorld = rows.map((r) => r.ofWorld)
const spread = Math.max(...ofWorld) - Math.min(...ofWorld)
console.log(`\n占房间比例 ${Math.min(...ofWorld).toFixed(3)} ~ ${Math.max(...ofWorld).toFixed(3)}，极差 ${spread.toFixed(4)} ${spread < 0.01 ? '✅ 比例锁定' : '❌ 还在变'}`)
