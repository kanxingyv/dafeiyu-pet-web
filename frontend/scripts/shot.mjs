/**
 * 视觉验收脚本：开真实浏览器截桌面 + 手机两张图，并收集 console 错误。
 *
 * 用法（先 `npm run dev` 或 `npm run preview` 起服务）：
 *   node ../scripts/shot.mjs http://127.0.0.1:5173 ../../work/web-check
 *
 * 为什么要它：这个页面 90% 的问题（视频黑底、定位跑偏、气泡被裁、手机溢出）
 * 只有真机/真浏览器截图才看得出来，typecheck 和 build 都抓不到。
 */
import { chromium, devices } from 'playwright'
import { mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const outDir = path.resolve(process.argv[3] ?? '../../work/web-check')
await mkdir(outDir, { recursive: true })

/**
 * 本机可能已经装了别的 playwright 版本的 chromium（版本号对不上就报 "Executable doesn't exist"）。
 * 这里主动去 ms-playwright 目录里找现成的可执行文件，避免为一个截图再下一遍浏览器。
 */
async function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM && existsSync(process.env.PLAYWRIGHT_CHROMIUM)) {
    return process.env.PLAYWRIGHT_CHROMIUM
  }
  const root = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
  if (!existsSync(root)) return undefined
  const dirs = (await readdir(root)).filter((d) => d.startsWith('chromium')).sort().reverse()
  for (const d of dirs) {
    for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const p = path.join(root, d, rel)
      if (existsSync(p)) return p
    }
  }
  return undefined
}

const executablePath = await findChromium()

const errors = []

async function shoot(name, contextOpts, viewport) {
  const browser = await chromium.launch({ executablePath })
  const ctx = await browser.newContext({ ...contextOpts, viewport })
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)

  // 可选：截图前先调一次后端接口，验证「外部程序 → 网页」这条链路真的通
  const evRaw = process.env.SHOT_EVENT
  if (evRaw) {
    const sent = await page.evaluate(async (body) => {
      try {
        const r = await fetch('/api/event', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        })
        return r.status
      } catch (e) {
        return String(e)
      }
    }, evRaw)
    console.log(`[${name}] POST /api/event -> ${sent}`)
    await page.waitForTimeout(1800) // 等气泡打字 + 动画起播
  }
  await page.waitForTimeout(2000)

  // 探针：视频到底有没有在播、alpha 是否正常（读不到像素，但能确认 readyState）
  const probe = await page.evaluate(() => {
    const vs = [...document.querySelectorAll('video')]
    return {
      videos: vs.length,
      states: vs.map((v) => ({
        ready: v.readyState,
        paused: v.paused,
        opacity: getComputedStyle(v).opacity,
        src: (v.currentSrc || '').split('/').slice(-2).join('/'),
      })),
      bubble: !!document.querySelector('.bubble'),
      petLeft: document.querySelector('.pet-layer')?.style.left ?? null,
      petW: document.querySelector('.pet-layer')?.getBoundingClientRect().width ?? 0,
      scrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
    }
  })
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false })
  await browser.close()
  return probe
}

const desktop = await shoot('desktop', {}, { width: 1440, height: 900 })
const mobile = await shoot('mobile', devices['iPhone 13'], { width: 390, height: 844 })

console.log('desktop', JSON.stringify(desktop, null, 2))
console.log('mobile', JSON.stringify(mobile, null, 2))
if (errors.length) {
  console.log('\nERRORS:')
  for (const e of errors) console.log(' -', e)
  process.exitCode = 1
} else {
  console.log('\nno console errors')
}
