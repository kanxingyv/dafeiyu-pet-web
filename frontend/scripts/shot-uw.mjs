/** 四个房间 × 三种屏幕比例截图，验收超宽素材的实际观感 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const out = process.argv[3] ?? 'D:/dafeiyu/work/uw-shots'

const sizes = [
  ['1080p', 1920, 1080],
  ['1440p', 2560, 1440],
  ['21x9', 2560, 1080],
]
const rooms = ['living', 'bedroom', 'study', 'lawn']

const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })

for (const [tag, w, h] of sizes) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2200)
  for (const r of rooms) {
    await p.evaluate((id) => {
      localStorage.setItem('dfy.scene', id)
    }, r)
    await p.reload({ waitUntil: 'networkidle' })
    await p.waitForTimeout(1800)
    await p.screenshot({ path: `${out}/${tag}-${r}.png` })
  }
  console.log(`${tag}: 错误 ${errs.length}`)
  await p.close()
}
await b.close()
console.log('done')
