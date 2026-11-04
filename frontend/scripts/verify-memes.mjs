/**
 * 一次性验收：表情包改成编号文件名（mNNN.png）后，前端是否真的还能出图。
 *
 *   node scripts/verify-memes.mjs http://127.0.0.1:5173
 *
 * 判据（区分「产品真错」和「我断言写错」）：
 *  - 面板里每个 .meme img 的 naturalWidth > 0（404 时是 0）
 *  - 点第一个表情包后，气泡里的图 naturalWidth > 0，且 src 指向 mNNN.png
 *  - 页面无 4xx/5xx 的图片请求
 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
const p = await b.newPage({ viewport: { width: 390, height: 844 } })

const bad = []
p.on('response', (r) => {
  const u = r.url()
  if (/\/assets\/(memes|anim|anim-mov)\//.test(u) && r.status() >= 400) bad.push(`${r.status()} ${u}`)
})

await p.goto(url, { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.click('.panel-toggle')
await p.waitForTimeout(500)
await p.locator('.panel-tabs button', { hasText: '表情' }).click()
await p.waitForTimeout(600)

/*
 * 面板里的图是 loading="lazy"：不在视口就不下载，直接数 naturalWidth 会把
 * 「还没滚到」误判成 404。先把 .panel-body 从头滚到尾触发下载，再等全部 complete。
 */
await p.evaluate(async () => {
  const box = document.querySelector('.panel-body')
  if (!box) return
  for (let y = 0; y <= box.scrollHeight; y += 160) {
    box.scrollTop = y
    await new Promise((r) => setTimeout(r, 50))
  }
  box.scrollTop = 0
})
await p
  .waitForFunction(() => [...document.querySelectorAll('.meme img')].every((i) => i.complete && i.naturalWidth > 0), null, {
    timeout: 15000,
  })
  .catch(() => {})

const panel = await p.evaluate(() =>
  [...document.querySelectorAll('.meme img')].map((i) => ({
    src: i.getAttribute('src'),
    w: i.naturalWidth,
  })),
)
const broken = panel.filter((x) => !x.w)
console.log(`面板表情 ${panel.length} 张，加载失败 ${broken.length}`)
if (broken.length) console.log('  失败:', broken.slice(0, 5))
console.log('  样例:', panel.slice(0, 3).map((x) => `${x.src}(${x.w}px)`).join(' '))

await p.locator('.meme').first().click()
await p.waitForTimeout(1500)
const bubble = await p.evaluate(() => {
  const img = document.querySelector('.bubble-img')
  return img ? { src: img.getAttribute('src'), w: img.naturalWidth } : null
})
console.log('气泡图:', bubble)

const ok =
  panel.length > 0 && broken.length === 0 && bubble && bubble.w > 0 && /m\d{3}\.png$/.test(bubble.src) && bad.length === 0
console.log('资源 4xx/5xx:', bad.length, bad.slice(0, 5))
console.log(ok ? '✅ 表情包全部正常' : '❌ 有表情包加载不出来')
await b.close()
process.exit(ok ? 0 : 1)
