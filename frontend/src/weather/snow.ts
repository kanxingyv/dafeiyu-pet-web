/**
 * 雪：动态层。
 *
 * 和雨一样，只负责「动」——灰白雪天、窗外积雪、地面厚雪都在素材里。
 * 但雪的物理和雨完全不同，所以单独一套：
 *   - 慢：正常下落速度只有雨的 1/20
 *   - 飘：每片有自己的正弦摆动，不是一条直线
 *   - 大小分层：近处大而糊、远处小而实
 *   - 落地就没了（不堆积，堆积交给素材）
 */

import type { RainOptions, RainRect } from './rain'

interface Flake {
  r: number
  x: number
  y: number
  radius: number
  vy: number
  vx: number
  /** 摆动相位，让每片雪花飘得不一样 */
  phase: number
  swing: number
  alpha: number
}

export interface SnowField {
  flakes: Flake[]
  wind: number
  /** 累计时间，用来算正弦 */
  t: number
}

const rnd = (a: number, b = 0) => b + Math.random() * (a - b)

export function createSnow(opts: RainOptions): SnowField {
  const { rects, intensity } = opts
  const k = Math.max(0.35, Math.min(1, intensity))
  const area = rects.reduce((s, r) => s + r.w * r.h, 0)

  const pickRect = () => {
    let t = Math.random() * area
    for (let i = 0; i < rects.length; i++) {
      t -= rects[i].w * rects[i].h
      if (t <= 0) return i
    }
    return rects.length - 1
  }

  // 雪比雨密，但别堆成暴风雪：实测每 1% 画面面积约 12 片刚好，
  // 之前用 26 片，窗户小的时候会糊成一片白噪点
  const n = Math.round(Math.min(320, Math.max(90, area * 1200)) * k)
  const flakes: Flake[] = []
  for (let i = 0; i < n; i++) {
    const near = Math.random() < 0.25
    flakes.push({
      r: pickRect(),
      x: Math.random(),
      y: Math.random(),
      radius: near ? rnd(2.6, 1.7) : rnd(1.6, 0.7),
      // 近处的落得快一点（视差）
      vy: near ? rnd(0.085, 0.05) : rnd(0.055, 0.022),
      vx: rnd(0.006, -0.014),
      phase: rnd(Math.PI * 2, 0),
      swing: rnd(0.018, 0.004),
      alpha: near ? rnd(0.8, 0.45) : rnd(0.55, 0.22),
    })
  }

  return { flakes, wind: -0.008, t: 0 }
}

export function stepSnow(f: SnowField, dt: number, opts: RainOptions): void {
  f.t += dt
  const outdoor = opts.ground !== null

  for (const s of f.flakes) {
    s.y += s.vy * dt
    // 正弦摆动 + 一点整体风
    s.x += (Math.sin(f.t * 0.9 + s.phase) * s.swing + f.wind + s.vx) * dt
    if (s.y > 1.04) {
      s.y = rnd(0, 0.12) - 0.12
      s.x = Math.random()
    }
    if (s.x < -0.05) s.x += 1.05
    if (s.x > 1.05) s.x -= 1.05

    // 户外的雪落到地面就化掉（贴地时淡出），室内的雪只在窗外飘
    if (outdoor && opts.ground !== null && s.y > opts.ground) {
      s.y = rnd(0, 0.12) - 0.12
      s.x = Math.random()
    }
  }
}

export function drawSnow(
  ctx: CanvasRenderingContext2D,
  f: SnowField,
  opts: RainOptions,
  w: number,
  h: number,
): void {
  const { rects } = opts
  ctx.clearRect(0, 0, w, h)

  for (const s of f.flakes) {
    const r: RainRect | undefined = rects[s.r]
    if (!r) continue
    const x = r.x * w + s.x * r.w * w
    const y = r.y * h + s.y * r.h * h

    // 大的加一圈很淡的光晕，小的直接一个点 —— 逐个建渐变太贵
    if (s.radius > 2.1) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, s.radius * 2.2)
      g.addColorStop(0, `rgba(255,255,255,${s.alpha})`)
      g.addColorStop(0.45, `rgba(255,255,255,${s.alpha * 0.5})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, s.radius * 2.2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = `rgba(255,255,255,${s.alpha})`
      ctx.beginPath()
      ctx.arc(x, y, s.radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
