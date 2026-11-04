import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'
const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = 'http://127.0.0.1:5173'
const out = 'D:/dafeiyu/work/uw-shots'
const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
for (const room of ['living','bedroom','study','lawn']) {
  for (const w of ['rain','snow']) {
    await p.goto(url, { waitUntil: 'networkidle' })
    await p.evaluate(([r,we]) => { localStorage.setItem('dfy.scene', r); localStorage.setItem('dfy.weather', we) }, [room, w])
    await p.reload({ waitUntil: 'networkidle' })
    await p.waitForTimeout(2500)
    await p.screenshot({ path: `${out}/w-${room}-${w}.png` })
  }
}
await b.close(); console.log('done')
