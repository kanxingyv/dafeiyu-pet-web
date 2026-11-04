/**
 * 验收「走动幅度」：按世界坐标 petX 量每个走动动作的真实位移，并检查角色有没有被
 * 摄像机推出屏幕。不依赖后端（走 dev 模式暴露的 __fish），起个 dev server 就能跑。
 *
 *   node scripts/verify-move.mjs http://127.0.0.1:5173
 *
 * 判据（1440×900）：
 *   - 三个动作的位移要拉开档次（小碎步 << 走路 < 奔跑）
 *   - 任何时刻屏幕内 = 是（角色整只都在画面里）
 *   - 自动溜达 35 秒要真的挪窝，不是原地站着
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
await p.goto(url, { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('dfy.scene', 'study'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(3000)

const petX = () =>
  p.evaluate(() => {
    const pet = document.querySelector('.pet-layer')
    const rect = pet.getBoundingClientRect()
    const half = rect.width * 0.17
    return {
      worldX: parseFloat(pet.style.left || '0'),
      screenLeft: Math.round(rect.left + rect.width / 2 - half),
      screenRight: Math.round(rect.left + rect.width / 2 + half),
      vw: innerWidth,
      boxW: Math.round(rect.width),
    }
  })

const L = await petX()
console.log(`viewport=1440x900  容器宽=${L.boxW}  角色宽=${Math.round(L.boxW * 0.34)}`)

for (const name of ['原地漂浮踏步', '螃蟹走路', '原地左转奔跑']) {
  const a = await petX()
  await p.evaluate((n) => window.__fish?.act(n), name)
  let minL = a.screenLeft
  let maxR = a.screenRight
  const t0 = Date.now()
  while (Date.now() - t0 < 10000) {
    const s = await petX()
    minL = Math.min(minL, s.screenLeft)
    maxR = Math.max(maxR, s.screenRight)
    await p.waitForTimeout(120)
  }
  const e = await petX()
  const travel = Math.abs(e.worldX - a.worldX)
  console.log(
    `${name.padEnd(7, '　')} 世界位移=${String(Math.round(travel)).padStart(5)}px  ` +
      `占屏=${((travel / 1440) * 100).toFixed(0).padStart(3)}%  ` +
      `屏幕内=${minL >= -2 && maxR <= 1442 ? '是' : `否(${minL},${maxR})`}`,
  )
  await p.waitForTimeout(1200)
}

// 自动溜达：不干预 35 秒，看她自己走的最大活动范围
const auto = []
const t0 = Date.now()
while (Date.now() - t0 < 35000) {
  const s = await petX()
  auto.push(s.worldX)
  await p.waitForTimeout(250)
}
console.log(
  `自动溜达 35s：活动范围=${Math.round(Math.max(...auto) - Math.min(...auto))}px  ` +
    `(${(((Math.max(...auto) - Math.min(...auto)) / 1440) * 100).toFixed(0)}% 屏宽)`,
)

await b.close()
