import type { Facing } from './types'

/**
 * 双缓冲视频播放器。
 *
 * 为什么不是「一个 video 换 src」：换 src 会经历 卸载 → 重新解码 → 首帧绘制，
 * 中间必然掉几帧黑屏，观感是「鱼在抽搐」。这里用两个 <video> 叠放，
 * 下一段在隐藏的那个里**先 ready 再切**，切换只是改 opacity，肉眼看不到断点。
 *
 * 另一件事：iOS Safari 不认 VP9 webm 的 alpha（渲染成黑底），要 HEVC .mov。
 * 素材没到位时自动回落到 webm —— 会黑底但动作正常，不会白屏。
 */

type PlayResult = 'ended' | 'cancelled'

/**
 * 这台设备能不能播 HEVC（也就是我们的 .mov 透明素材）。
 *
 * 为什么不用 UA 判断：Chromium 内核（包括套 iPhone UA 的调试环境、以及部分安卓 WebView）
 * 能解析 quicktime 容器、readyState 也能到 HAVE_CURRENT_DATA，但**解不了 HEVC**，
 * 于是「看起来加载成功、实际播不出来」，然后每次回落 webm 又把 mov 的请求打断。
 * 直接问解码能力最靠谱：只有真正支持 hvc1 的（Safari / WKWebView）才返回非空。
 */
function canPlayHevc(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const v = document.createElement('video')
    return v.canPlayType('video/quicktime; codecs="hvc1"') !== ''
  } catch {
    return false
  }
}

function once(el: HTMLElement, ev: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const fire = () => {
      if (done) return
      done = true
      el.removeEventListener(ev, fire)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(fire, timeoutMs) // 超时兜底：宁可播得不完美，也别卡死
    el.addEventListener(ev, fire, { once: true })
  })
}

export class PetPlayer {
  private bufs: HTMLVideoElement[] = []
  private active = 0
  private token = 0
  private currentName: string | null = null
  private useMov = false
  /** .mov 已经被证实播不了（这台设备/这份素材），之后一律走 webm，不再重试 */
  private movBroken = false
  /** 当前 play() 的「结束等待」句柄：stop() 调它，让 await 立刻返回，不用干等超时 */
  private pendingEnd: (() => void) | null = null

  constructor() {
    this.useMov = canPlayHevc()
  }

  /** 挂载两个 video 元素（React ref 传入，顺序固定） */
  attach(a: HTMLVideoElement, b: HTMLVideoElement): void {
    this.bufs = [a, b]
    for (const [i, v] of this.bufs.entries()) {
      v.muted = true
      v.playsInline = true
      v.setAttribute('playsinline', '')
      v.setAttribute('webkit-playsinline', '')
      v.preload = 'auto'
      v.style.opacity = i === 0 ? '1' : '0'
    }
    this.active = 0
  }

  /** 当前是否在用 .mov（iOS） */
  get usingMov(): boolean {
    return this.useMov
  }

  /** 素材地址（相对部署根）。iOS 用 anim-mov/*.mov（HEVC+alpha），其余用 anim/*.webm */
  private url(file: string, mov = this.useMov): string {
    const ext = mov ? 'mov' : 'webm'
    const dir = mov ? 'anim-mov' : 'anim'
    const stem = file.replace(/\.webm$/i, '')
    return `./assets/${dir}/${encodeURIComponent(stem)}.${ext}`
  }

  /**
   * 把 file 装进 el 并等到首帧可用。
   *
   * iOS 上先试 .mov（HEVC+alpha，Safari 才认透明），拿不到就回落 webm
   * （黑底但动作正常，总比一片空白强）。
   *
   * ⚠️ 关键：mov 失败一次就**永久记住**（movBroken），不再逐个动作重试。
   * 之前每次 play 都先请求 mov、等 5 秒超时、再回落 webm ——
   * 回落时换 src 把 mov 的请求 abort 掉，Network 面板里每个动作都挂一条红色。
   */
  private async ensureLoaded(el: HTMLVideoElement, file: string): Promise<boolean> {
    if (this.useMov && !this.movBroken) {
      const ok = await this.tryLoad(el, this.url(file, true), 2600)
      if (ok) return true
      this.movBroken = true
      this.useMov = false
    }
    return this.tryLoad(el, this.url(file, false), 6000)
  }

  /** 装一个 url 并等首帧；同一个 url 已经就绪就直接返回 */
  private async tryLoad(el: HTMLVideoElement, url: string, timeoutMs: number): Promise<boolean> {
    if (el.dataset.url !== url) {
      el.dataset.url = url
      el.src = url
      el.load()
    }
    if (el.readyState < 2) await once(el, 'loadeddata', timeoutMs)
    return el.readyState >= 2
  }

  /** 预载下一段（在非活动缓冲里静默 load，不播） */
  preload(file: string): void {
    if (this.bufs.length < 2) return
    const idle = this.bufs[1 - this.active]
    const url = this.url(file)
    if (idle.dataset.url === url) return
    idle.dataset.url = url
    idle.src = url
    idle.load()
  }

  /**
   * 播一段，等它播完。
   * 被新的 play() 抢占时立刻返回 'cancelled'，调用方据此决定是否继续链。
   */
  async play(file: string, facing: Facing = 'left'): Promise<PlayResult> {
    if (this.bufs.length < 2) return 'cancelled'
    const myToken = ++this.token

    const prev = this.bufs[this.active]
    const next = this.bufs[1 - this.active]

    // 等首帧可用再切，否则切过去是一块透明
    const loaded = await this.ensureLoaded(next, file)
    if (myToken !== this.token) return 'cancelled'
    if (!loaded) return 'cancelled'

    this.applyFacing(next, facing)
    try {
      next.currentTime = 0
      await next.play()
    } catch {
      // 自动播放被拦（首次未交互）：静默失败，等用户点一下再恢复
      return 'cancelled'
    }
    if (myToken !== this.token) {
      next.pause()
      return 'cancelled'
    }

    // 切换：新的淡入、旧的淡出。用 opacity 而非 display，避免重排
    next.style.opacity = '1'
    prev.style.opacity = '0'
    this.active = 1 - this.active
    this.currentName = file

    // 旧缓冲暂停但要留在原地当缓存；延迟到切换动画结束后再暂停，防止闪现
    setTimeout(() => {
      if (myToken === this.token) prev.pause()
    }, 320)

    // 等这一段播完。stop() 会调 pendingEnd 让这里立刻返回，不必干等超时 ——
    // 否则点播新动作时，得等当前这段 10 秒放完才有反应。
    const ended = new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        next.removeEventListener('ended', finish)
        clearTimeout(timer)
        if (this.pendingEnd === finish) this.pendingEnd = null
        resolve()
      }
      const timer = setTimeout(finish, 60_000)
      next.addEventListener('ended', finish)
      this.pendingEnd = finish
    })
    await ended

    if (myToken !== this.token) return 'cancelled'
    return 'ended'
  }

  private applyFacing(el: HTMLVideoElement, facing: Facing): void {
    el.style.transform = facing === 'right' ? 'scaleX(-1)' : 'scaleX(1)'
  }

  /** 外部改朝向（走到墙边翻面时用）：两个缓冲一起改，切换时不会突然掉头 */
  setFacing(facing: Facing): void {
    for (const v of this.bufs) this.applyFacing(v, facing)
  }

  /**
   * 打断当前等待，但让旧画面继续播到新动作首帧就绪。
   *
   * 点播/拖拽不能用 stop()：stop 会先 pause 旧视频，新视频又要等解码，
   * 中间这 100~300ms 就是肉眼可见的「卡一下」。这里只作废旧 await，
   * 真正的旧视频暂停仍由 play() 切换成功后的延迟回调负责。
   */
  interrupt(): void {
    this.token++
    this.pendingEnd?.()
  }

  /** 立刻停住（页面隐藏 / 组件卸载时用） */
  stop(): void {
    this.interrupt()
    for (const v of this.bufs) v.pause()
    this.currentName = null
  }

  /** 当前动作名 */
  get current(): string | null {
    return this.currentName
  }

  /** 当前这段的时长（秒）；还没加载好时返回 0 */
  get duration(): number {
    const v = this.bufs[this.active]
    return v && Number.isFinite(v.duration) ? v.duration : 0
  }
}
