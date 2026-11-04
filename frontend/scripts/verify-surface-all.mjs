/**
 * 遍历 scenes.json 里所有 surfaces，逐个验证「拖上去能站住」。
 *
 * 为什么要遍历：客厅两把椅子一开始标错了 x 范围（左椅偏左 4%、右椅偏右 2.5%），
 * 肉眼看截图看不出来，只有真拖一次才知道站不上去。
 *
 * 判据：松手后角色容器 top ≈ surface.y * worldH + boxH*(1-FOOT) + sink。
 */
import { chromium } from 'playwright'
import path from 'node:path'
import os from 'node:os'

const exe = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const url = process.argv[2] ?? 'http://127.0.0.1:5173'
const FOOT = 0.915
const SINK = 0.012

const b = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server'] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))

const scenes = await (async () => {
  await p.goto(url, { waitUntil: 'networkidle' })
  return p.evaluate(() => fetch('./assets/bg/scenes.json').then((r) => r.json()))
})()

async function setScene(id) {
  await p.evaluate((r) => {
    localStorage.setItem('dfy.scene', r)
    localStorage.setItem('dfy.weather', 'clear')
    localStorage.setItem('dfy.daylight', 'day')
  }, id)
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(2200)
}

const geo = () =>
  p.evaluate(() => {
    const layer = document.querySelector('.pet-layer')
    const world = document.querySelector('.world')
    return {
      petX: parseFloat(layer.style.left),
      top: parseFloat(layer.style.top),
      boxH: parseFloat(layer.style.height),
      worldW: parseFloat(world.style.width),
      worldH: parseFloat(world.style.height),
    }
  })

let pass = 0
let fail = 0
for (const room of scenes.scenes) {
  if (!room.surfaces?.length) continue
  for (const s of room.surfaces) {
    await setScene(room.id)
    const g = await geo()
    const targetX = ((s.x[0] + s.x[1]) / 2) * g.worldW
    const dx = targetX - g.petX
    // 拖到该面之上 30px，保证 tol 判定能命中这一面
    const dy = -((room.standY - s.y) * g.worldH + 30)

    const bx = await p.locator('.pet-layer').boundingBox()
    const cx = bx.x + bx.width / 2
    const cy = bx.y + bx.height / 2
    await p.mouse.move(cx, cy)
    await p.mouse.down()
    for (let i = 1; i <= 14; i++) {
      await p.mouse.move(cx + (dx * i) / 14, cy + (dy * i) / 14)
      await p.waitForTimeout(16)
    }
    await p.waitForTimeout(350)
    await p.mouse.up()
    await p.waitForTimeout(1500)

    const after = await geo()
    const expect = s.y * g.worldH + g.boxH * (1 - FOOT) + g.boxH * SINK
    const diff = Math.abs(after.top - expect)
    const ok = diff < 14
    if (ok) pass++
    else fail++
    console.log(
      `${ok ? '✅' : '❌'} ${room.name}/${s.name ?? ''}  top=${after.top.toFixed(0)} 期望=${expect.toFixed(0)} 差 ${diff.toFixed(0)}px`,
    )
  }
}

console.log(`\n通过 ${pass} / 失败 ${fail}`)
console.log(`页面错误 ${errs.length ? errs.join(' / ') : '无'}`)
await b.close()
process.exit(fail ? 1 : 0)
