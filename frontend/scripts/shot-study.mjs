import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'
const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const out = 'D:/dafeiyu/work/uw-shots'
const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
for (const [tag, w, h] of [['1080p', 1920, 1080], ['21x9', 2560, 1080]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
  await p.evaluate(() => localStorage.setItem('dfy.scene', 'study'))
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(2000)
  await p.screenshot({ path: `${out}/study-crop-${tag}.png` })
  await p.close()
}
await b.close(); console.log('done')
