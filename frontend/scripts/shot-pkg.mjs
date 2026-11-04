/** 验收打包产物：直接用静态服务打开 wallpaper-pkg，截图看是否正常渲染 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'
const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = process.argv[2] ?? 'http://127.0.0.1:8899'
const out = process.argv[3] ?? 'D:/dafeiyu/work/uw-shots/pkg.png'
const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
p.on('response', (r) => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url()}`) })
await p.goto(url, { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
const info = await p.evaluate(() => {
  const img = document.querySelector('.room-bg')
  return { src: img?.getAttribute('src'), ok: img ? img.complete && img.naturalWidth : 0, w: img?.naturalWidth, h: img?.naturalHeight }
})
console.log(JSON.stringify(info))
console.log('错误:', errs.length ? errs.slice(0, 5) : '无')
await p.screenshot({ path: out })
await b.close()
