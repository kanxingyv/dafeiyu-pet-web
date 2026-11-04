/**
 * 验「动作面板」两件事：
 *  1. 打开时不再从左边闪一下再归位（入场动画不该有水平位移）
 *  2. 搜索框能按名字/分类/用途描述筛动作与表情，空结果有提示
 *
 * 断言的自我校验：脚本会先注入旧样式（复用 bubble-in）复现 bug，
 * 确认断言在那个版本上确实 FAIL —— 否则「PASS」可能只是断言写松了。
 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = process.argv[2] ?? 'http://127.0.0.1:5199'
const outDir = path.resolve(process.argv[3] ?? '../../work/web-check')
fs.mkdirSync(outDir, { recursive: true })

const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
let fails = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '✅' : '❌'} ${msg}`)
  if (!cond) fails++
}

/** 采样面板出现后 700ms 内每一帧的位置 */
async function sampleOpen(p) {
  await p.evaluate(() => {
    window.__s = []
    const t0 = performance.now()
    const tick = () => {
      const el = document.querySelector('.panel')
      if (el) {
        const r = el.getBoundingClientRect()
        window.__s.push({ t: Math.round(performance.now() - t0), left: r.left, right: r.right, w: r.width })
      }
      if (performance.now() - t0 < 700) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await p.click('.panel-toggle')
  await p.waitForTimeout(900)
  return p.evaluate(() => window.__s)
}

/** 水平漂移：right 边不该动，left 只因缩放小幅内收 */
function drift(samples) {
  const last = samples[samples.length - 1]
  return {
    frames: samples.length,
    right: Math.max(...samples.map((s) => Math.abs(s.right - last.right))),
    left: Math.max(...samples.map((s) => Math.abs(s.left - last.left))),
    w: last.w,
  }
}

for (const [label, vp] of [
  ['桌面 1280×800', { width: 1280, height: 800 }],
  ['手机 390×844', { width: 390, height: 844 }],
]) {
  const p = await b.newPage({ viewport: vp })
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2200)

  console.log(`\n──── ${label} ────`)

  // ── 对照组：注入旧动画，断言应当 FAIL ──
  await p.evaluate(() => {
    const st = document.createElement('style')
    st.id = 'legacy-anim'
    st.textContent =
      '.panel{animation:bubble-in .2s cubic-bezier(.34,1.56,.64,1) !important;transform-origin:50% 50% !important}'
    document.head.appendChild(st)
  })
  const dLegacy = drift(await sampleOpen(p))
  console.log(
    `   对照组(旧动画): ${dLegacy.frames} 帧, right 漂移 ${dLegacy.right.toFixed(1)}px, left 漂移 ${dLegacy.left.toFixed(1)}px (宽 ${dLegacy.w.toFixed(0)}px)`,
  )
  ok(dLegacy.left > dLegacy.w * 0.2, '对照组确实复现了「左移半身位」（说明断言能抓到真 bug）')
  await p.click('.panel-toggle')
  await p.waitForTimeout(200)
  await p.evaluate(() => document.getElementById('legacy-anim')?.remove())

  // ── 正式：新动画 ──
  const d = drift(await sampleOpen(p))
  console.log(
    `   正式(新动画): ${d.frames} 帧, right 漂移 ${d.right.toFixed(1)}px, left 漂移 ${d.left.toFixed(1)}px (宽 ${d.w.toFixed(0)}px)`,
  )
  ok(d.frames >= 5, `采样到动画中间帧（${d.frames} 帧）`)
  ok(d.right <= 2, `right 边全程不动（漂移 ${d.right.toFixed(1)}px ≤ 2px）`)
  ok(d.left <= d.w * 0.06 + 2, `left 只有缩放的微量内收（${d.left.toFixed(1)}px ≤ ${(d.w * 0.06 + 2).toFixed(1)}px）`)

  await p.screenshot({ path: path.join(outDir, `panel-open-${vp.width}.png`) })

  // ── 搜索：动作 ──
  const totalChips = await p.locator('.chips button').count()
  await p.fill('.panel-search input', '奔跑')
  await p.waitForTimeout(200)
  const hitChips = await p.locator('.chips button').count()
  const chipTexts = await p.locator('.chips button').allInnerTexts()
  ok(hitChips > 0 && hitChips < totalChips, `搜「奔跑」：${totalChips} → ${hitChips} 个动作`)
  ok(chipTexts.every((t) => t.includes('奔跑')), `结果全部含「奔跑」：${chipTexts.join(' / ')}`)

  // 按分类搜：玩耍是分类名，不在动作名里
  await p.fill('.panel-search input', '玩耍')
  await p.waitForTimeout(200)
  const catHit = await p.locator('.chips button').count()
  ok(catHit >= 20, `按分类搜「玩耍」命中 ${catHit} 个（分类名也参与匹配）`)

  // 空结果
  await p.fill('.panel-search input', 'zzzzzz')
  await p.waitForTimeout(200)
  ok((await p.locator('.panel-empty').count()) === 1, '无结果时给出提示而不是空白')
  await p.screenshot({ path: path.join(outDir, `panel-search-empty-${vp.width}.png`) })

  // 清空按钮
  await p.click('.panel-search-clear')
  await p.waitForTimeout(200)
  ok((await p.locator('.chips button').count()) === totalChips, `点 × 恢复全部 ${totalChips} 个动作`)

  // ── 搜索：表情 ──
  await p.click('.panel-tabs button:nth-child(2)')
  await p.waitForTimeout(200)
  const allMemes = await p.locator('.meme').count()
  await p.fill('.panel-search input', '生气')
  await p.waitForTimeout(200)
  const hitMemes = await p.locator('.meme').count()
  ok(hitMemes > 0 && hitMemes < allMemes, `搜「生气」：表情 ${allMemes} → ${hitMemes} 个`)
  await p.screenshot({ path: path.join(outDir, `panel-search-meme-${vp.width}.png`) })

  // 房间 tab 不该出现搜索框
  await p.click('.panel-tabs button:nth-child(3)')
  await p.waitForTimeout(200)
  ok((await p.locator('.panel-search').count()) === 0, '房间 tab 不显示搜索框（房间本来只有 4 个）')

  // 点动作仍然自动收起
  await p.click('.panel-tabs button:nth-child(1)')
  await p.fill('.panel-search input', '礼仪')
  await p.waitForTimeout(200)
  await p.locator('.chips button').first().click()
  await p.waitForTimeout(300)
  ok((await p.locator('.panel').count()) === 0, '点完动作面板自动收起（老行为没坏）')

  ok(errs.length === 0, `页面无 JS 报错${errs.length ? '：' + errs.join(' | ') : ''}`)
  await p.close()
}

await b.close()
console.log(`\n${fails === 0 ? '✅ 全部通过' : `❌ ${fails} 项失败`}  截图目录：${outDir}`)
process.exit(fails === 0 ? 0 : 1)
