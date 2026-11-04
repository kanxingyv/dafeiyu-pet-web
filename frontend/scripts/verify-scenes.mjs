/** 验收房间切换：点四个房间，背景图要换、角色位置要合理、不能报错 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
const p = await b.newPage({ viewport: { width: 390, height: 844 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto(url, { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)

await p.click('.panel-toggle')
await p.waitForTimeout(300)
await p.locator('.panel-tabs button', { hasText: '房间' }).click()
await p.waitForTimeout(400)
const count = await p.locator('.scene-item').count()
console.log('房间数:', count)

for (let i = 0; i < count; i++) {
  // 每轮都要重新打开面板（点完房间会自动收起）
  if ((await p.locator('.panel').count()) === 0) {
    await p.click('.panel-toggle')
    await p.waitForTimeout(300)
  }
  await p.locator('.panel-tabs button', { hasText: '房间' }).click()
  await p.waitForTimeout(300)
  const name = await p.locator('.scene-item span').nth(i).textContent()
  await p.locator('.scene-item').nth(i).click()
  await p.waitForTimeout(1200)
  const st = await p.evaluate(() => {
    const img = document.querySelector('.room-bg')
    const pet = document.querySelector('.pet-layer')
    const r = pet?.getBoundingClientRect()
    return {
      bg: decodeURIComponent((img?.src || '').split('/').pop() || ''),
      bgOk: img ? img.complete && img.naturalWidth > 0 : false,
      screenX: r ? Math.round(r.x + r.width / 2) : 0,
    }
  })
  console.log(`  ${name}: 背景=${st.bg} 加载=${st.bgOk ? '✅' : '❌'} 角色x=${st.screenX}`)
  await p.screenshot({ path: `../../work/web-check/scene-${i}.png` })
}
console.log('页面错误:', errs.length ? errs : '无')
await b.close()
