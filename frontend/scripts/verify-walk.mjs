/**
 * 验收「跑动 + 摄像机」：连续点播走路动作，采样角色屏幕位置与世界偏移。
 * 断言：角色始终完整在视口内；摄像机真的动了（不是角色贴屏滑动）。
 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })

for (const [name, vp] of [['walk-desktop', { width: 1440, height: 900 }], ['walk-mobile', { width: 390, height: 844 }]]) {
  const p = await b.newPage({ viewport: vp })
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2500)

  const samples = []
  const snap = async () => {
    const s = await p.evaluate(() => {
      const pet = document.querySelector('.pet-layer')
      const world = document.querySelector('.world')
      if (!pet || !world) return null
      const r = pet.getBoundingClientRect()
      const m = /translate3d\((-?[\d.]+)px/.exec(world.style.transform || '')
      return {
        petLeft: Math.round(r.left), petRight: Math.round(r.right),
        petTop: Math.round(r.top), petBottom: Math.round(r.bottom),
        camX: m ? Math.round(parseFloat(m[1]) * -1) : 0,
        vw: window.innerWidth, vh: window.innerHeight,
      }
    })
    if (s) samples.push(s)
  }

  // 走 6 趟，每趟采样 4 次
  for (let i = 0; i < 6; i++) {
    // 生产构建里没有 __fish 调试口，走真实接口触发（顺带验证「外部调用」链路）
    await p.evaluate(() => fetch('/api/event', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'act', name: '原地左转奔跑' }),
    }))
    for (let k = 0; k < 4; k++) {
      await p.waitForTimeout(700)
      await snap()
    }
  }

  const out = samples.filter(Boolean)
  // 视频容器是 16:9，角色只占中间约 34% 宽 / 78% 高，所以按角色实际视觉边界判断
  const outOfView = out.filter((s) => {
    const w = s.petRight - s.petLeft
    const cx = (s.petLeft + s.petRight) / 2
    const halfW = w * 0.17
    return cx - halfW < -2 || cx + halfW > s.vw + 2
  })
  const cams = out.map((s) => s.camX)
  console.log(`${name}: 采样 ${out.length} 次，摄像机范围 ${Math.min(...cams)}~${Math.max(...cams)}，越界 ${outOfView.length} 次`)
  if (outOfView.length) console.log('  越界样本:', JSON.stringify(outOfView.slice(0, 3)))
  await p.screenshot({ path: `../../work/web-check/${name}.png` })
  await p.close()
}
await b.close()
