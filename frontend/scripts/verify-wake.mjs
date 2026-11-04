/**
 * 门口读条验收（用户定稿的交互）：
 *
 *   A. 鼠标拖她到门口（按住）→ 头顶进度条 → 读满 1 秒 → 松手进门
 *   B. 读条中继续拖走 → 进度条取消、松手不进门
 *   C. 拖到门口松手站定 → 只有按钮、**不读条**（不拖就不读）
 *   D. 点门口按钮 → 直接进门（老路径不受影响）
 *
 * 用法：node scripts/verify-wake.mjs [url]
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
    if (existsSync(q)) { exe = q; break }
  }
  if (exe) break
}
const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))

const st = () => p.evaluate(() => {
  const w = document.querySelector('.world')
  const pt = document.querySelector('.pet-layer')
  const m = (w?.style.transform ?? '').match(/translate3d\((-?[\d.]+)px/)
  return {
    camX: m ? -parseFloat(m[1]) : 0,
    worldW: parseFloat(w?.style.width ?? '0'),
    petX: parseFloat(pt?.style.left ?? '0'),
    wake: !!document.querySelector('.wake-bar.active'),
    ready: !!document.querySelector('.wake-bar.ready'),
    scene: localStorage.getItem('dfy.scene'),
    btns: document.querySelectorAll('.exit-btn').length,
  }
})

/** 载入客厅（清掉上次的 localStorage 状态） */
const load = async () => {
  await p.evaluate(() => {
    localStorage.setItem('dfy.scene', 'living')
    localStorage.setItem('dfy.weather', 'clear')
    localStorage.setItem('dfy.daylight', 'day')
  })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(3200)
}

/** 按住她拖到客厅法式门（exit.x = 0.724），保持按住不放 */
const dragToDoor = async () => {
  const g = await st()
  const box = await p.$eval('.pet-layer', (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height * 0.7 }
  })
  const tx = 0.724 * g.worldW - g.camX
  await p.mouse.move(box.x, box.y)
  await p.mouse.down()
  for (let i = 1; i <= 14; i++) {
    await p.mouse.move(box.x + ((tx - box.x) * i) / 14, box.y)
    await p.waitForTimeout(26)
  }
}

await p.goto(URL, { waitUntil: 'networkidle' })

// ═══ A. 拖到门口 → 读条 → 满 → 松手进门 ═══
await load()
await dragToDoor()
await p.waitForTimeout(550)
const a1 = await st()
await p.waitForTimeout(1100)
const a2 = await st()
await p.mouse.up()
await p.waitForTimeout(3800)
const a3 = await st()
console.log('A 拖到门口：进度条=%s 满格=%s 松手后=%s', a1.wake, a2.ready, a3.scene, a1.wake && a2.ready && a3.scene === 'lawn' ? '✓' : '✗')

// ═══ B. 读条中继续拖走 → 取消、不进门 ═══
await load()
await dragToDoor()
await p.waitForTimeout(400)
const b1 = await st()
for (let i = 1; i <= 8; i++) {
  await p.mouse.move(700 - i * 30, 600)
  await p.waitForTimeout(30)
}
await p.waitForTimeout(250)
const b2 = await st()
await p.mouse.up()
await p.waitForTimeout(2600)
const b3 = await st()
console.log('B 读条中拖走：进度条 %s→%s 松手后=%s', b1.wake, b2.wake, b3.scene, b1.wake && !b2.wake && b3.scene === 'living' ? '✓' : '✗')

// ═══ C. 拖到门口松手站定 → 只有按钮、不读条 ═══
await load()
await dragToDoor()
await p.mouse.up()
await p.waitForTimeout(1600)
const c1 = await st()
console.log('C 门口站定：进度条=%s 按钮=%d', c1.wake, c1.btns, !c1.wake && c1.btns >= 1 ? '✓ 只有按钮不读条' : '✗')

// ═══ D. 点按钮 → 直接进门 ═══
await load()
await dragToDoor()
await p.mouse.up()
await p.waitForTimeout(700)
const btn = await p.$('.exit-btn')
if (btn) await btn.click()
await p.waitForTimeout(3800)
const d1 = await st()
console.log('D 点按钮：场景=%s', d1.scene, d1.scene === 'lawn' ? '✓' : '✗')

console.log('页面错误：', errs.length ? errs.slice(0, 2) : '无')
await b.close()
