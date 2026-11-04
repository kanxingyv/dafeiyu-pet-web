/**
 * 验收「脚动了才走」：触发走动动作后按 200ms 采样角色位置，
 * 前 leadSec 秒应该几乎不动，之后才开始平移。
 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
const p = await b.newPage({ viewport: { width: 1200, height: 800 } })
const failed = []
p.on('requestfailed', (r) => { if (r.url().includes('/assets/anim')) failed.push(decodeURIComponent(r.url().split('/').pop())) })

// 目标地址从命令行传（默认本地），不写死线上 IP
await p.goto(process.argv[2] ?? 'http://127.0.0.1:5173', { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)

await p.evaluate(() => fetch('/api/event', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'act', name: '原地左转奔跑' }),
}))

const track = []
for (let i = 0; i < 40; i++) {
  const x = await p.evaluate(() => {
    const el = document.querySelector('.pet-layer')
    return el ? Math.round(parseFloat(el.style.left || '0')) : null
  })
  track.push({ t: +(i * 0.2).toFixed(1), x })
  await p.waitForTimeout(200)
}

const first = track[0].x
const movedAt = track.find((s) => Math.abs(s.x - first) > 6)
console.log('起始 x =', first)
console.log('开始移动的时刻 ≈', movedAt ? `${movedAt.t}s` : '未移动')
console.log('轨迹(每秒):', track.filter((_, i) => i % 5 === 0).map((s) => `${s.t}s:${s.x}`).join(' '))
console.log('失败请求:', failed.length ? failed : '无')
await b.close()
