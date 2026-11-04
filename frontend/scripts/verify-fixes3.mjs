/**
 * 一次验三件事：
 *  1. 向右跑时摄像机真的往右移（背景动），且角色不贴边
 *  2. 点表情包只出图、不出文字
 *  3. 面板点完自动收起
 */
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

const camX = () => p.evaluate(() => {
  const m = /translate3d\((-?[\d.]+)px/.exec(document.querySelector('.world').style.transform || '')
  return m ? -Math.round(parseFloat(m[1])) : 0
})

// ── 1. 向右跑 ──
const c0 = await camX()
await p.evaluate(() => fetch('/api/event', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'act', name: '原地左转奔跑', facing: 'right' }),
}))
await p.waitForTimeout(3000)
const c1 = await camX()
const facing = await p.evaluate(() => document.querySelector('.pet-layer')?.dataset.facing)
console.log(`1) 向右跑: camX ${c0} → ${c1} (${c1 > c0 ? '✅ 背景右移' : '❌ 没动'})  facing=${facing}`)

// ── 3. 面板点完收起 ──
await p.click('.panel-toggle')
await p.waitForTimeout(400)
const openedBefore = await p.locator('.panel').count()
await p.locator('.chips button').first().click()
await p.waitForTimeout(500)
const openedAfter = await p.locator('.panel').count()
console.log(`3) 面板: 点击前 open=${openedBefore} 点击后 open=${openedAfter} ${openedAfter === 0 ? '✅ 已收起' : '❌ 还开着'}`)

// ── 2. 表情包只发图 ──
await p.click('.panel-toggle')
await p.waitForTimeout(400)
await p.locator('.panel-tabs button', { hasText: '表情' }).click()
await p.waitForTimeout(400)
await p.locator('.meme').first().click()
await p.waitForTimeout(1500)
const bubble = await p.evaluate(() => {
  const w = document.querySelector('.bubble-wrap')
  if (!w) return null
  const t = w.querySelector('.bubble-text')
  const img = w.querySelector('.bubble-img')
  return {
    text: t ? t.textContent : null,
    hasImg: !!img,
    imgClass: img ? img.className : null,
    imgW: img ? Math.round(img.getBoundingClientRect().width) : 0,
  }
})
console.log(`2) 表情包: ${JSON.stringify(bubble)} ${bubble && bubble.hasImg && !bubble.text ? '✅ 只有图' : '❌ 还有文字'}`)
console.log('页面错误:', errs.length ? errs : '无')
await p.screenshot({ path: '../../work/web-check/fix3-mobile.png' })
await b.close()
