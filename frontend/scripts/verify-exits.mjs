/**
 * 验收房间互通：
 *   1. 手机 / 桌面 都能走到门口（之前桌面可走范围只有 0.31~0.69，门在 0.18/0.9 走不到）
 *   2. 走到房间端点也能触发那一头的门
 *   3. 点按钮先播礼让动作，再切房间
 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })

for (const [dev, vp] of [['手机', { width: 390, height: 844 }], ['桌面', { width: 1440, height: 900 }]]) {
  const p = await b.newPage({ viewport: vp })
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2500)

  const state = () => p.evaluate(() => {
    const btn = document.querySelector('.exit-btn')
    const img = document.querySelector('.room-bg')
    const pet = document.querySelector('.pet-layer')
    const world = document.querySelector('.world')
    return {
      exit: btn ? btn.textContent.trim() : null,
      bg: decodeURIComponent((img?.src || '').split('/').pop() || ''),
      ratio: +(parseFloat(pet.style.left || '0') / world.getBoundingClientRect().width).toFixed(3),
    }
  })

  const start = await state()
  // 一路往右拖到底
  const box = await p.evaluate(() => {
    const r = document.querySelector('.pet-layer').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height * 0.6 }
  })
  await p.mouse.move(box.x, box.y)
  await p.mouse.down()
  for (let i = 1; i <= 24; i++) {
    await p.mouse.move(box.x + i * 40, box.y)
    await p.waitForTimeout(60)
  }
  await p.mouse.up()
  await p.waitForTimeout(600)
  const rightEnd = await state()

  console.log(`[${dev}] 进门 ${JSON.stringify(start)}`)
  console.log(`[${dev}] 拖到最右 ${JSON.stringify(rightEnd)} ${rightEnd.exit ? '✅ 触发' : '❌ 没触发'}`)

  if (rightEnd.exit) {
    await p.click('.exit-btn')
    await p.waitForTimeout(600)
    const mid = await state()
    console.log(`[${dev}] 点了 0.6s 后 ${JSON.stringify(mid)} ${mid.bg === rightEnd.bg ? '✅ 还在播礼让动作（未立即切换）' : '⚠️ 立刻切了'}`)
    await p.waitForTimeout(2200)
    console.log(`[${dev}] 2.8s 后 ${JSON.stringify(await state())}`)
  }
  console.log(`[${dev}] 页面错误:`, errs.length ? errs : '无')
  await p.close()
}
await b.close()
