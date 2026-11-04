/** 打开动作选择器截图（验证面板布局与滚动区域） */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const out = path.resolve(process.argv[3] ?? '../../work/web-check')

for (const [name, vp] of [['panel-desktop', { width: 1440, height: 900 }], ['panel-mobile', { width: 390, height: 844 }]]) {
  const b = await chromium.launch({ executablePath: exe })
  const p = await b.newPage({ viewport: vp })
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2500)
  await p.click('.panel-toggle')
  await p.waitForTimeout(900)
  const info = await p.evaluate(() => {
    const el = document.querySelector('.panel')
    const body = document.querySelector('.panel-body')
    const r = el?.getBoundingClientRect()
    return {
      panel: r && { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
      scrollable: body ? body.scrollHeight > body.clientHeight : null,
      chips: document.querySelectorAll('.chips button').length,
    }
  })
  console.log(name, JSON.stringify(info))
  await p.screenshot({ path: path.join(out, `${name}.png`) })
  await b.close()
}
