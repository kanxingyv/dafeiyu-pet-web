import type { SceneInfo } from '../engine/types'

/**
 * 背景图预加载 / 预解码。
 *
 * 为什么需要：
 * PetStage 里背景是 `<img src={scene.image}>`，换房间时 day / night / rain / snow
 * 四张图的 src 同时变。每张 3400×1440 的 webp 解码后约 19 MB，浏览器要把四张
 * 全部解出来才能出首帧 —— 主线程被解码占住，观感就是「动作做完了，画面卡一下才切」。
 *
 * 提前 `decode()` 之后，换 src 那一下只是把已经在缓存里的位图贴上去，
 * 不再有解码阻塞。注意 onload 只代表下载完，`img.decode()` 才代表可以直接绘制。
 */

export const bgUrl = (file: string) => `./assets/bg/${file}`

/** 已经解码完成的 URL */
const decoded = new Set<string>()
/** 正在解码的 URL —— 多个入口同时要同一张图时复用同一个 Promise */
const inflight = new Map<string, Promise<void>>()

function decodeOne(file: string): Promise<void> {
  const url = bgUrl(file)
  if (decoded.has(url)) return Promise.resolve()
  const running = inflight.get(url)
  if (running) return running

  const p = new Promise<void>((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    const settle = () => {
      const d = img.decode?.()
      if (d) d.then(() => resolve()).catch(() => resolve())
      else resolve()
    }
    img.onload = settle
    // 加载失败也要 resolve：卡在 await 上比少一张图更糟
    img.onerror = () => resolve()
    img.src = url
  }).then(() => {
    decoded.add(url)
    inflight.delete(url)
  })

  inflight.set(url, p)
  return p
}

/** 一个房间会用到的全部背景图 */
export function sceneFiles(scene: SceneInfo): string[] {
  return [scene.image, scene.nightImage, scene.rainImage, scene.snowImage].filter(
    Boolean,
  ) as string[]
}

/** 预加载一个房间的全部背景图，并等到解码完成 */
export function preloadScene(scene: SceneInfo): Promise<void> {
  return Promise.all(sceneFiles(scene).map(decodeOne)).then(() => undefined)
}

/** 预加载单张背景图 */
export function preloadFile(file: string): Promise<void> {
  return decodeOne(file)
}

/**
 * 这个房间此刻**真正显示**的是哪一张。
 * 必须和 PetStage 里 showDay / showNight / showRain / showSnow 的判断顺序一致，
 * 否则会出现「预加载了夜景、实际显示白天」这种白等。
 *
 * 为什么只预加载这一张：切房间时四张 img 的 src 都会变，但只有一张 opacity=1。
 * 不可见的三张解码慢不影响首帧，等它们只会让遮罩多盖几百毫秒。
 */
export function visibleBgFile(
  scene: SceneInfo,
  phase: 'day' | 'night',
  weather: 'clear' | 'rain' | 'snow',
): string {
  if (weather === 'rain' && scene.rainImage) return scene.rainImage
  if (weather === 'snow' && scene.snowImage) return scene.snowImage
  if (phase === 'night' && scene.nightImage) return scene.nightImage
  return scene.image
}

/** 已经解码过的房间（供调试/断言用） */
export function isSceneReady(scene: SceneInfo): boolean {
  return sceneFiles(scene).every((f) => decoded.has(bgUrl(f)))
}
