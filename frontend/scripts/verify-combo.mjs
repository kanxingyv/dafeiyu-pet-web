/**
 * 验收「编排动作」：新动作有没有出现在面板、点了能不能播、播放时长对不对。
 *
 * 用法（先 `npm run dev`）：
 *   node ../scripts/verify-combo.mjs http://127.0.0.1:5173 ../../work/web-check
 *
 * 为什么要单独一个脚本：
 *   加动作这条链上有三个地方会静默失败 ——
 *   ① 配置里写了名字但 webm 没放好 → 面板有按钮、点了 404（gen_manifest 会 warn，但没人看）
 *   ② webm 编码时漏了 yuva420p → 画面能播，但四周一圈黑底
 *   ③ 分类 weight 写错 → 她会在随机链里突然演完 30 秒，看起来像卡住
 *   这三条 typecheck 都抓不到，只能真浏览器跑一遍。
 */
import { chromium, devices } from 'playwright'
import { mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const outDir = path.resolve(process.argv[3] ?? '../../work/web-check')
await mkdir(outDir, { recursive: true })

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

const browser = await chromium.launch({ executablePath })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 控件平时是隐形的（opacity:0 + pointer-events:none），先点一下屏幕左上角把它叫醒。
// 别点画面中间 —— 那里可能是宠物本体，会触发点击回应，干扰后面的判断。
await page.mouse.click(8, 8)
await page.waitForTimeout(400)
await page.click('.panel-toggle')
await page.waitForTimeout(500)

// 面板里的分组顺序：第一个应该是「编排」
const groups = await page.$$eval('.panel section h4', (els) =>
  els.map((e) => (e.textContent ?? '').replace(/\s*\d+$/, '').trim()),
)
console.log('分组顺序:', groups.join(' / '))

const hasCombo = await page.locator('.panel button:has-text("午后打盹")').count()
console.log('「午后打盹」按钮存在:', hasCombo > 0)

await page.screenshot({ path: path.join(outDir, 'panel.png') })

if (hasCombo > 0) {
  await page.click('.panel button:has-text("午后打盹")')
  // 面板点完自动收起；等 2.5 秒，此时应该已经播到第一段中后段
  await page.waitForTimeout(2500)
  const probe = await page.evaluate(() => {
    const vs = [...document.querySelectorAll('video')]
    const playing = vs.find((v) => !v.paused && v.readyState >= 2)
    return {
      videoCount: vs.length,
      src: playing ? (playing.currentSrc || '').split('/').slice(-1)[0] : null,
      currentTime: playing ? Number(playing.currentTime.toFixed(2)) : null,
      duration: playing ? Number((playing.duration || 0).toFixed(2)) : null,
    }
  })
  console.log('播放探针:', JSON.stringify(probe))

  const expectedDur = 30.1
  const durOk = probe.duration !== null && Math.abs(probe.duration - expectedDur) < 1.0
  const srcOk = (probe.src ?? '').includes('午后打盹') || decodeURIComponent(probe.src ?? '').includes('午后打盹')
  console.log('时长对得上 30.1s:', durOk)
  console.log('播的是新文件:', srcOk)
  if (!durOk || !srcOk) process.exitCode = 1

  await page.screenshot({ path: path.join(outDir, 'combo-playing.png') })

  // 再等 1 秒取一帧，确认它是在播而不是停在第一帧
  await page.waitForTimeout(1000)
  const t2 = await page.evaluate(() => {
    const v = [...document.querySelectorAll('video')].find((x) => !x.paused)
    return v ? Number(v.currentTime.toFixed(2)) : null
  })
  console.log('1 秒后进度:', t2, '(应比上一值大约多 1)')
}

await browser.close()

if (errors.length) {
  console.log('\nERRORS:')
  for (const e of [...new Set(errors)]) console.log(' -', e)
} else {
  console.log('\nno console errors')
}
