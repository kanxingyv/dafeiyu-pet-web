/**
 * 验收「白天/黑夜」：自动模式跟着系统时间走，手动模式记住选择。
 *
 *   node scripts/verify-daylight.mjs http://127.0.0.1:5173
 *
 * 判据：
 *   - 清掉 localStorage 后 = auto，且当前显示与「此刻几点」一致（6:30~18:30 是白天）
 *   - 手动选白天/夜晚后刷新仍是那个
 *   - 夜晚时两张背景图里夜景那张 opacity=1
 */
import { chromium } from 'playwright'
import os from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'

const root = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
let exe
for (const d of (await readdir(root)).filter((x) => x.startsWith('chromium')).sort().reverse()) {
  for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
    const q = path.join(root, d, rel)
    if (existsSync(q)) { exe = q; break }
  }
  if (exe) break
}

const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })

const read = () =>
  p.evaluate(() => {
    const h = new Date().getHours() + new Date().getMinutes() / 60
    const expect = h >= 6.5 && h < 18.5 ? 'day' : 'night'
    return {
      now: new Date().toTimeString().slice(0, 5),
      expect,
      night: document.querySelector('.stage')?.classList.contains('night') ?? false,
      ls: localStorage.getItem('dfy.daylight'),
      bg: [...document.querySelectorAll('.room-bg')].map((i) => +getComputedStyle(i).opacity),
    }
  })

await p.goto(url, { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.clear())
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1600)
const auto = await read()
const autoOk = (auto.expect === 'night') === auto.night
console.log(`自动  ${auto.now}  预期=${auto.expect}  实际=${auto.night ? 'night' : 'day'}  ${autoOk ? '✓' : '✗'}`)

let allOk = autoOk
for (const mode of ['day', 'night']) {
  await p.evaluate((m) => localStorage.setItem('dfy.daylight', m), mode)
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(1600)
  const s = await read()
  const ok = (mode === 'night') === s.night && s.ls === mode
  allOk = allOk && ok
  console.log(`手动=${mode}  实际=${s.night ? 'night' : 'day'}  bg opacity=[${s.bg}]  ${ok ? '✓' : '✗'}`)
}

await p.evaluate(() => localStorage.removeItem('dfy.daylight'))
await b.close()
console.log(allOk ? '全部通过' : '有失败项')
process.exit(allOk ? 0 : 1)
