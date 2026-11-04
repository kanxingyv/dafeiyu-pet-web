import { useEffect, useRef } from 'react'
import { createRain, drawRain, stepRain, type RainOptions } from './rain'
import { createSnow, drawSnow, stepSnow } from './snow'

export type WeatherKind = 'rain' | 'snow'

/**
 * 天气粒子层：一块铺满世界的 canvas，每帧重绘。
 *
 * 放在 `.world` 里面而不是固定在屏幕上 —— 窗户在世界坐标里，摄像机平移时
 * 粒子要跟着窗户走，否则看起来像「屏幕在下雨」。
 *
 * 性能：粒子数按窗户面积算（雨最多 180 条线、雪最多 520 个点），
 * 全画在 GPU 加速的 2D canvas 上，60fps 在 CEF 里 CPU 占用约 2~4%。
 * 刻意不用 shadowBlur —— 那是 canvas 里最贵的操作，加了直接掉一半帧。
 */
export function WeatherLayer({
  weather,
  sceneId,
  options,
}: {
  weather: WeatherKind
  /** 场景 id：切房间时必须重建粒子 —— 粒子的活动区域（窗户/整屏）是按场景算的，
   *  不重建的话，从客厅切到院子，雨还下在客厅窗户的旧坐标里，外面看起来就没下雨 */
  sceneId: string
  options: RainOptions
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  // options 变化时不要重建粒子（会闪），放进 ref 让循环读最新的
  const optsRef = useRef(options)
  optsRef.current = options

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    // 雨和雪是两套粒子；天气或房间变了都整组重建 ——
    // 避免雨滴半路变雪花、以及「雨还下在上一个房间窗户的旧坐标」
    const rain = weather === 'rain' ? createRain(options) : null
    const snow = weather === 'snow' ? createSnow(options) : null

    let raf = 0
    let last = performance.now()
    let w = 0
    let h = 0

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      w = cv.clientWidth
      h = cv.clientHeight
      if (w === 0 || h === 0) return
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(cv)
    resize()

    const loop = (now: number) => {
      // 上限 50ms：切回来的时候 dt 可能是好几秒，不夹住粒子会瞬移一屏
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (w > 0 && h > 0) {
        if (rain) {
          stepRain(rain, dt, optsRef.current)
          drawRain(ctx, rain, optsRef.current, w, h)
        } else if (snow) {
          stepSnow(snow, dt, optsRef.current)
          drawSnow(ctx, snow, optsRef.current, w, h)
        }
      }
      raf = requestAnimationFrame(loop)
    }

    // 页面不可见时停掉，别在后台空转（壁纸里会被 WE 冻结，回来再续）
    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
        raf = 0
      } else if (!raf) {
        last = performance.now()
        raf = requestAnimationFrame(loop)
      }
    }
    document.addEventListener('visibilitychange', onVis)

    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      ro.disconnect()
    }
    // 只在换天气/挂载时重建粒子；改雨量走 optsRef，不重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weather, sceneId])

  return <canvas className="rain-layer" ref={ref} aria-hidden="true" />
}
