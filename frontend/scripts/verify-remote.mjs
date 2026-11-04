/** 公网端到端验收：真浏览器打开线上地址，验证动作/气泡/WS/静态资源 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
// 目标地址必须显式传入：这里不写死任何线上域名/IP，免得仓库里带着别人的服务器地址
const url = process.argv[2] ?? 'http://127.0.0.1:8765'
const out = path.resolve(process.argv[3] ?? '../../work/web-check')
const errors = []

const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
for (const [name, vp] of [['remote-desktop', { width: 1440, height: 900 }], ['remote-mobile', { width: 390, height: 844 }]]) {
  const p = await b.newPage({ viewport: vp })
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`) })
  p.on('pageerror', (e) => errors.push(`[${name}] pageerror ${e.message}`))
  await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
  await p.waitForTimeout(3000)
  // 通过后端接口触发一次说话，验证「外部 → 网页」链路
  const status = await p.evaluate(async () => {
    const r = await fetch('/api/event', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'say', text: '主人回来啦～', image: '可爱', holdMs: 20000 }),
    })
    return r.status
  })
  await p.waitForTimeout(1800)
  const probe = await p.evaluate(() => ({
    videos: [...document.querySelectorAll('video')].map((v) => ({ ready: v.readyState, paused: v.paused, src: decodeURIComponent((v.currentSrc || '').split('/').slice(-1)[0]) })),
    bubble: !!document.querySelector('.bubble'),
    panel: !!document.querySelector('.panel-toggle'),
  }))
  console.log(name, 'POST', status, JSON.stringify(probe))
  await p.screenshot({ path: path.join(out, `${name}.png`) })
  await p.close()
}
await b.close()
console.log(errors.length ? 'ERRORS:/n' + errors.join('\n') : 'no console errors')
