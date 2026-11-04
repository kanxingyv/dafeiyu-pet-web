/**
 * 雨：动态层。
 *
 * ⚠️ 这一层只负责「动」，不负责「像」。
 * 素材已经是阴雨天（乌云、玻璃水痕、地面积水都是画好的），
 * 再往上糊一层全屏模糊 / 雨幕，只会把画面弄脏 —— 之前那版就是这么翻车的。
 *
 * 玻璃上的水，**不是一颗颗圆球**。
 * 真实雨窗上是三层叠起来的：
 *   1. 水痕：顺着玻璃往下爬的细流，蜿蜒、上细下粗、头部有个水头
 *   2. 水膜：整块玻璃的湿润反光（素材里已经有）
 *   3. 极少数水珠：卡在划痕里不动的（这里省略，加了反而像贴纸）
 * 所以室内只画「水痕」，画成曲线 + 渐变，不画圆。
 */

export type Weather = 'clear' | 'rain' | 'snow'

export interface RainRect {
  /** 窗户/户外区域，占整幅画面的比例 [x, y, w, h] */
  x: number
  y: number
  w: number
  h: number
}

export interface RainOptions {
  /** 允许出现雨痕/雨滴的区域。室内传窗户矩形，院子传整屏 */
  rects: RainRect[]
  /** 地面线（比例高）。有值 = 户外，才会画砸在地上的水花 */
  ground: number | null
  /** 0.35~1，雨量 */
  intensity: number
}

/** 近景雨线（户外） */
interface Drop {
  r: number
  x: number
  y: number
  len: number
  speed: number
  alpha: number
  width: number
}

/**
 * 玻璃上的一条水痕。
 * 用「已流下的长度 len」而不是「一个点」—— 水痕是长出来的，不是滑动的圆球。
 */
interface Streak {
  r: number
  /** 起点 x（归一化，相对玻璃宽） */
  x: number
  /** 头部 y（归一化，相对玻璃高） */
  y: number
  /** 已经流下的长度（归一化） */
  len: number
  /** 目标长度，流到这里就慢慢停住 */
  maxLen: number
  width: number
  speed: number
  /** 左右蜿蜒的幅度 */
  wobble: number
  phase: number
  alpha: number
  /** 流到头之后停留的时间，用来淡出重生 */
  rest: number
}

/** 雨点砸在地上的小水花（户外） */
interface Splash {
  x: number
  y: number
  life: number
  max: number
}

export interface RainField {
  drops: Drop[]
  streaks: Streak[]
  splashes: Splash[]
  wind: number
}

const rnd = (a: number, b = 0) => b + Math.random() * (a - b)

export function createRain(opts: RainOptions): RainField {
  const { rects, intensity, ground } = opts
  const k = Math.max(0.35, Math.min(1, intensity))
  const outdoor = ground !== null

  const area = rects.reduce((s, r) => s + r.w * r.h, 0)
  const pickRect = () => {
    let t = Math.random() * area
    for (let i = 0; i < rects.length; i++) {
      t -= rects[i].w * rects[i].h
      if (t <= 0) return i
    }
    return rects.length - 1
  }

  // 户外：素材已经有远景雨幕，这里补的是「贴着镜头」的那层，负责速度感
  const drops: Drop[] = []
  if (outdoor) {
    const n = Math.round(Math.min(180, Math.max(50, area * 900)) * k)
    for (let i = 0; i < n; i++) {
      drops.push({
        r: pickRect(),
        x: Math.random(),
        y: Math.random(),
        len: rnd(0.085, 0.035),
        speed: rnd(3.4, 1.9),
        alpha: rnd(0.42, 0.14),
        width: rnd(2.4, 1.1),
      })
    }
  }

  // 室内：玻璃上的水痕。长的慢、短的快，混在一起才像「雨一直在下」
  const streaks: Streak[] = []
  if (!outdoor) {
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]
      const longCount = Math.round(Math.max(4, Math.min(12, r.w * r.h * 1200 * k)))
      const shortCount = Math.round(Math.max(8, Math.min(22, r.w * r.h * 2400 * k)))

      for (let j = 0; j < longCount; j++) {
        streaks.push({
          r: i,
          x: Math.random(),
          y: rnd(0.5, 0.02),
          len: 0,
          maxLen: rnd(0.8, 0.32),
          width: rnd(3.2, 1.7),
          speed: rnd(0.05, 0.02),
          wobble: rnd(0.026, 0.009),
          phase: rnd(Math.PI * 2, 0),
          alpha: rnd(0.34, 0.17),
          rest: 0,
        })
      }
      for (let j = 0; j < shortCount; j++) {
        streaks.push({
          r: i,
          x: Math.random(),
          y: Math.random(),
          len: 0,
          maxLen: rnd(0.22, 0.07),
          width: rnd(2.1, 1),
          speed: rnd(0.12, 0.045),
          wobble: rnd(0.018, 0.005),
          phase: rnd(Math.PI * 2, 0),
          alpha: rnd(0.28, 0.11),
          rest: 0,
        })
      }
    }
  }

  const splashes: Splash[] = []
  if (outdoor) {
    const n = Math.round(16 * k)
    for (let i = 0; i < n; i++) {
      splashes.push({ x: Math.random(), y: rnd(0.09, 0.01), life: rnd(1, 0), max: rnd(1, 0.5) })
    }
  }

  return { drops, streaks, splashes, wind: -0.14 }
}

export function stepRain(f: RainField, dt: number, opts: RainOptions): void {
  const outdoor = opts.ground !== null

  if (outdoor) {
    for (const d of f.drops) {
      d.y += d.speed * dt
      d.x += f.wind * dt * d.speed
      if (d.y > 1.05) {
        d.y = rnd(0, 0.15) - 0.15
        d.x = Math.random()
      }
      if (d.x < -0.1) d.x += 1.1
    }

    for (const s of f.splashes) {
      s.life += dt
      if (s.life > s.max) {
        s.life = 0
        s.max = rnd(1.1, 0.5)
        s.x = Math.random()
        s.y = rnd(0.09, 0.01)
      }
    }
    return
  }

  for (const s of f.streaks) {
    if (s.rest > 0) {
      // 流到头就停住慢慢变淡，然后从上面重新长一条
      s.rest -= dt
      if (s.rest <= 0) {
        s.y = rnd(0.35, 0.02)
        s.len = 0
        s.x = Math.random()
        s.maxLen = rnd(s.maxLen > 0.3 ? 0.62 : 0.16, s.maxLen > 0.3 ? 0.2 : 0.05)
        s.phase = rnd(Math.PI * 2, 0)
      }
      continue
    }

    // 头部下移，尾巴跟着长（长度追头部，不是整体平移）
    s.y += s.speed * dt
    s.len = Math.min(s.maxLen, s.len + s.speed * dt)

    if (s.len >= s.maxLen) s.rest = rnd(2.6, 0.8)
    if (s.y > 1.02) s.rest = 0.01
  }
}

function px(r: RainRect, x: number, y: number, w: number, h: number): [number, number] {
  return [r.x * w + x * r.w * w, r.y * h + y * r.h * h]
}

export function drawRain(
  ctx: CanvasRenderingContext2D,
  f: RainField,
  opts: RainOptions,
  w: number,
  h: number,
): void {
  const { rects, ground } = opts
  const outdoor = ground !== null
  ctx.clearRect(0, 0, w, h)

  if (outdoor) {
    const r = rects[0] ?? { x: 0, y: 0, w: 1, h: 1 }
    ctx.lineCap = 'round'
    for (const d of f.drops) {
      const x = r.x * w + d.x * r.w * w
      const y = r.y * h + d.y * r.h * h
      const len = d.len * r.h * h
      const dx = f.wind * len * 2.4

      // 头亮尾淡：一条均匀的线是「划痕」，有渐变才像水滴
      const g = ctx.createLinearGradient(x, y, x + dx, y + len)
      g.addColorStop(0, 'rgba(232,242,255,0)')
      g.addColorStop(0.22, `rgba(232,242,255,${d.alpha})`)
      g.addColorStop(1, `rgba(248,252,255,${d.alpha * 0.45})`)
      ctx.strokeStyle = g
      ctx.lineWidth = d.width
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + dx, y + len)
      ctx.stroke()
    }

    // 砸在地上的水花：很扁的椭圆，越扩越淡
    const gy = ground * h
    for (const s of f.splashes) {
      const t = s.life / s.max
      const a = (1 - t) * 0.42
      if (a <= 0) continue
      const cx = s.x * w
      const cy = gy + s.y * h
      const rad = 2 + t * 7
      ctx.strokeStyle = `rgba(226,240,255,${a})`
      ctx.lineWidth = 1.1
      ctx.beginPath()
      ctx.ellipse(cx, cy, rad, rad * 0.3, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    return
  }

  /*
   * 室内：玻璃上的水痕。
   * 画法要点：
   *   - 一条水痕 = 一条会轻微左右摆的曲线，不是一个圆
   *   - 用「头部亮、尾部淡」的渐变，尾部要透明（水膜越来越薄）
   *   - 头部再加一小段加粗的「水头」，那是水积聚的地方
   */
  ctx.lineCap = 'round'
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    const rw = r.w * w
    const rh = r.h * h

    for (const s of f.streaks) {
      if (s.r !== i) continue
      // 停留阶段整体淡出，别突然消失
      const fade = s.rest > 0 ? Math.max(0, Math.min(1, s.rest / 1.2)) : 1
      if (fade <= 0.02) continue

      const [bx, headY] = px(r, s.x, s.y, w, h)
      const tailY = headY - s.len * rh
      // 蜿蜒：头尾各一个相位偏移，中间用二次曲线连起来
      const w1 = Math.sin(s.phase) * s.wobble * rw
      const w2 = Math.sin(s.phase + 1.15) * s.wobble * rw
      const mx = bx + (w1 + w2) * 0.5

      const g = ctx.createLinearGradient(bx, tailY, bx, headY)
      g.addColorStop(0, 'rgba(214,232,255,0)')
      g.addColorStop(0.5, `rgba(220,236,255,${s.alpha * 0.55 * fade})`)
      g.addColorStop(0.92, `rgba(232,244,255,${s.alpha * fade})`)
      g.addColorStop(1, `rgba(240,249,255,${s.alpha * 0.9 * fade})`)

      ctx.strokeStyle = g
      ctx.lineWidth = s.width
      ctx.beginPath()
      ctx.moveTo(bx + w1, tailY)
      ctx.quadraticCurveTo(mx, (tailY + headY) / 2, bx + w2, headY)
      ctx.stroke()

      // 水头：比水痕稍粗的一小段，不是圆点
      ctx.strokeStyle = `rgba(242,250,255,${s.alpha * 1.3 * fade})`
      ctx.lineWidth = s.width * 1.3
      ctx.beginPath()
      ctx.moveTo(bx + w2, headY - s.width * 1.1)
      ctx.lineTo(bx + w2, headY)
      ctx.stroke()
    }
  }
}
