/**
 * 验收切房间：预加载有没有生效、换图那一下卡不卡。
 *
 * 判据不是「切换耗时」——新版有 170ms 遮罩，故意慢一点更好看。
 * 真正要看的是**帧间隔**：换 src 时浏览器要解码 4 张 3400×1440 的 webp，
 * 主线程被占住就会掉帧。>50ms 的帧肉眼可见地顿一下。
 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const target = process.argv[3] ?? 'study'

const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))

await p.goto(url, { waitUntil: 'networkidle' })
await p.waitForTimeout(2600)

// 逐帧记录间隔
await p.evaluate(() => {
  window.__frames = []
  let last = performance.now()
  const loop = (t) => {
    window.__frames.push(t - last)
    last = t
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
})

await p.click('.panel-toggle')
await p.waitForTimeout(320)
await p.locator('.panel-tabs button', { hasText: '房间' }).click()
await p.waitForTimeout(420)

const t0 = Date.now()
await p.locator('.scene-item').nth(['living', 'bedroom', 'study', 'lawn'].indexOf(target)).click()
await p.waitForFunction(
  (id) => document.querySelector('.room-bg--day')?.src.includes(`${id}.webp`),
  target,
  { timeout: 10_000 },
)
const switchMs = Date.now() - t0
await p.waitForTimeout(1400)

const frames = await p.evaluate(() => window.__frames.slice(-260))
const gaps = frames.slice(1)
const maxGap = Math.max(...gaps)
const long = gaps.filter((f) => f > 50).length
const over100 = gaps.filter((f) => f > 100).length

console.log(`切到 ${target}：点击→背景 src 变更 ${switchMs} ms`)
console.log(`帧间隔 最大 ${maxGap.toFixed(1)} ms ｜ >50ms ${long} 帧 ｜ >100ms ${over100} 帧`)
console.log(`页面错误 ${errs.length ? errs.join(' / ') : '无'}`)
await b.close()
