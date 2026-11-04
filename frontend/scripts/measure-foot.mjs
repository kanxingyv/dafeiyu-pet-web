/**
 * 量素材里「角色脚底」在视频画布中的位置（占高度比例）。
 * 做法：抽若干帧画到 canvas，找最底部不透明像素的行号，取各帧最大值。
 * 这个值决定角色该往下压多少才踩得到地面线。
 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const b = await chromium.launch({ executablePath: exe })
const p = await b.newPage({ viewport: { width: 800, height: 600 } })
await p.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)

const names = ['待机呼吸休闲', '东张西望', '原地左转奔跑', '点击回应-开心跃动', '吃白饭', '超大伸懒腰']
const res = await p.evaluate(async (list) => {
  const out = []
  for (const n of list) {
    const v = document.createElement('video')
    v.muted = true; v.playsInline = true; v.preload = 'auto'
    v.src = `./assets/anim/${encodeURIComponent(n)}.webm`
    await new Promise((r) => { v.onloadeddata = r; v.onerror = r })
    const c = document.createElement('canvas')
    c.width = v.videoWidth; c.height = v.videoHeight
    const ctx = c.getContext('2d')
    let lowest = 0
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      v.currentTime = (v.duration || 2) * t
      await new Promise((r) => { v.onseeked = r; setTimeout(r, 400) })
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.drawImage(v, 0, 0)
      const { data } = ctx.getImageData(0, 0, c.width, c.height)
      for (let y = c.height - 1; y >= 0; y--) {
        let hit = false
        for (let x = 0; x < c.width; x += 2) {
          if (data[(y * c.width + x) * 4 + 3] > 16) { hit = true; break }
        }
        if (hit) { if (y > lowest) lowest = y; break }
      }
    }
    out.push({ name: n, h: v.videoHeight, footY: lowest, ratio: +(lowest / v.videoHeight).toFixed(3) })
  }
  return out
}, names)

for (const r of res) console.log(`${r.name.padEnd(14)} 画布高 ${r.h}  脚底 y=${r.footY}  (${(r.ratio * 100).toFixed(1)}%)`)
const idle = res.find((r) => r.name === '待机呼吸休闲')
console.log('\n建议 FOOT_IN_VIDEO =', idle ? idle.ratio : '?')
await b.close()
