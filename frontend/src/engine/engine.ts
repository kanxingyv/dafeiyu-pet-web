import type { PetPlayer } from './player'
import { pickClick, pickNext, pickWorkStatus } from './picker'
import {
  DEFAULT_BEHAVIOR,
  nextByBehavior,
  pickClickWeighted,
  type BehaviorConfig,
} from './behavior'
import type { BubbleContent, Facing, Manifest, PetMode, PickResult } from './types'

/**
 * 宠物状态机。
 *
 * 一条永不停的链：播完一段 → 按权重抽下一段 → 播。
 * 外部随时可以插队（点播动作 / 冒气泡 / 切状态），插队播完自动回链。
 *
 * 刻意不碰 React：这里全是命令式时序（await 播放结束、抢占、取消），
 * 放进 React 的渲染周期只会打架。React 只订阅回调来更新 DOM。
 */

export interface EngineHooks {
  /** 一段动画开始播（React 据此更新位置、朝向） */
  onAnimStart?: (name: string, pick: PickResult) => void
  /** 一段动画播完（自然结束，不含被打断） */
  onAnimEnd?: (name: string) => void
  /** 要冒一个气泡 */
  onBubble?: (content: BubbleContent) => void
  /** 状态变化 */
  onModeChange?: (mode: PetMode) => void
}

export class PetEngine {
  private running = false
  private paused = false
  /** 拖拽是最高优先级：旧点击动作收尾时也不能解除这个状态 */
  private dragging = false
  private lastName: string | null = null
  private lastClick: string | null = null
  private facing: Facing = 'left'
  private mode: PetMode = 'idle'
  /**
   * 行为节奏配置（外部可通过 setBehavior 调整）：
   * eventInterval = 多久做一件「日常小事件」（默认 40s，30s~5min）
   * meals = 三餐时间，前后一小时更常端出吃的
   */
  private behavior: BehaviorConfig = { ...DEFAULT_BEHAVIOR }
  /** 上一次「日常事件」的时间戳（ms）：用来控制事件间隔 */
  private lastEventAt = 0
  /** 外部点播的队列：播完最后一个才回自动链 */
  private manualQueue: Array<{ name: string; facing?: Facing }> = []
  /** 当前是否在播外部点播的动作 */
  private inManual = false
  /** 上一轮预抽、并且已经预载好的下一个动作（loop 下一轮直接用，避免预载白下） */
  private nextPick: PickResult | null = null
  /** 自动溜达的定时器 */
  private strollTimer: number | null = null

  constructor(
    private readonly manifest: Manifest,
    private readonly player: PetPlayer,
    private readonly hooks: EngineHooks = {},
  ) {}

  get currentMode(): PetMode {
    return this.mode
  }

  get currentFacing(): Facing {
    return this.facing
  }

  get currentAnim(): string | null {
    return this.player.current
  }

  /** 启动自动链（可重复调用，幂等） */
  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
    this.scheduleStroll()
  }

  /** 停住（页面隐藏 / 组件卸载） */
  stop(): void {
    this.running = false
    if (this.strollTimer !== null) {
      clearTimeout(this.strollTimer)
      this.strollTimer = null
    }
    this.player.stop()
  }

  /**
   * 自动溜达：每 25–45 秒主动走一趟。
   *
   * 为什么不靠权重抽：move 在 dsh-pet 里只占 5%，平均 200 秒才走一次，
   * 网页端看着就像"一直站着"。这里单独给她一个溜达节奏，家里才有人气。
   */
  private scheduleStroll(): void {
    if (this.strollTimer !== null) clearTimeout(this.strollTimer)
    const wait = 25_000 + Math.random() * 20_000
    this.strollTimer = setTimeout(() => {
      this.strollTimer = null
      if (!this.running) return
      if (this.mode === 'idle' && !this.paused && !this.inManual) {
        const acts = this.manifest.pools.moves?.actions ?? []
        if (acts.length > 0) {
          const act = acts[Math.floor(Math.random() * acts.length)]
          void this.act(act.name)
        }
      }
      this.scheduleStroll()
    }, wait) as unknown as number
  }

  /** 暂停自动链（比如切到工作状态由外部驱动） */
  pause(): void {
    this.paused = true
  }

  resume(): void {
    if (this.dragging || !this.paused) return
    this.paused = false
    if (this.running) void this.loop()
  }

  /**
   * 点播一个动作（外部 API / 动作选择器 / 右键菜单）。
   * **立即打断当前动画**，不等它播完 —— 用户点了没反应是最糟的体验。
   * 连点多个时只有最后一个生效（后来的覆盖前面的）。
   */
  async act(name: string, opts: { facing?: Facing } = {}): Promise<void> {
    if (!this.manifest.animations[name]) {
      throw new Error(`unknown animation: ${name}`)
    }
    // 拖拽期间自动链、点击和外部点播都不能抢回播放器。
    if (this.dragging) return
    // 覆盖队列：点播是"我现在就要看这个"，不是排队
    this.manualQueue = [{ name, facing: opts.facing }]
    // 只打断等待，旧画面继续播到新动作首帧就绪，避免点击时先冻结一截。
    this.player.interrupt()
    if (!this.inManual) void this.flushManual()
  }

  /** 冒一个气泡（不打断当前动画） */
  say(content: BubbleContent): void {
    this.hooks.onBubble?.(content)
  }

  /** 用户点了宠物 */
  /** 调整行为节奏（事件间隔 / 三餐时间），立即生效 */
  setBehavior(cfg: Partial<BehaviorConfig>): void {
    this.behavior = { ...this.behavior, ...cfg }
  }

  get behaviorConfig(): BehaviorConfig {
    return { ...this.behavior }
  }

  /**
   * 点击回应：按稀有度加权 —— 元气挥手最常见，挠痒/被吓一跳要多点几次才遇到。
   * 权重表缺失时退回 picker 的等概率逻辑。
   */
  poke(): void {
    const name = pickClickWeighted(this.manifest, this.lastClick) ?? pickClick(this.manifest, this.lastClick)
    if (!name) return
    this.lastClick = name
    void this.act(name)
  }

  /** 切换状态：idle / work / sleep / manual */
  setMode(mode: PetMode, opts: { workIndex?: number } = {}): void {
    if (this.mode === mode) return
    this.mode = mode
    this.hooks.onModeChange?.(mode)

    if (mode === 'sleep') {
      const name = this.manifest.pools.idle?.[0]
      if (name) void this.act(name)
      return
    }
    if (mode === 'work') {
      const name = pickWorkStatus(this.manifest, opts.workIndex ?? 2)
      if (name) void this.act(name)
      return
    }
    // idle：恢复自动链
    this.resume()
  }

  private async flushManual(): Promise<void> {
    if (this.inManual || this.dragging) return
    this.inManual = true
    this.paused = true
    try {
      while (this.manualQueue.length > 0 && !this.dragging) {
        const item = this.manualQueue.shift()!
        const meta = this.manifest.animations[item.name]
        if (!meta) continue
        if (item.facing) this.facing = item.facing
        this.hooks.onAnimStart?.(item.name, { name: item.name, kind: 'category' })
        // 朝向必须在 onAnimStart **之后**取：走动动作会在那里判断撞墙翻面，
        // 提前算的话，翻面后播的还是旧朝向 —— 表现就是「朝左却向右移」的倒着跑。
        const facing: Facing = meta.mirror ? this.facing : 'left'
        const result = await this.player.play(meta.file, facing)
        if (result === 'ended') this.hooks.onAnimEnd?.(item.name)
      }
    } finally {
      this.inManual = false
      // 点击动作被拖拽打断后也会进 finally；绝不能在这里解除拖拽暂停。
      if (!this.dragging) this.paused = false
    }
    if (this.dragging) return
    // 退出后再看一眼：播的这段时间里可能又有人点播了，别把那次丢掉
    if (this.manualQueue.length > 0) {
      void this.flushManual()
      return
    }
    if (this.running) void this.loop()
  }

  /**
   * 决定下一个自动动作：安静待机 / 日常事件（按行为配置与当前时间）。
   * 事件触发时刷新 lastEventAt，让下一次事件至少间隔 eventInterval。
   */
  private decideNext(last?: string): PickResult | null {
    const res = nextByBehavior(
      this.manifest,
      last ?? this.lastName,
      { lastEventAt: this.lastEventAt },
      new Date(),
      this.behavior,
    )
    if (!res) return pickNext(this.manifest, last ?? this.lastName)
    if (res.isEvent) this.lastEventAt = Date.now()
    return res.pick
  }

  private async loop(): Promise<void> {
    while (this.running) {
      if (this.paused || this.inManual || this.dragging) {
        // 被抢占：让出，等 flushManual / resume / endDrag 重新拉起
        return
      }
      // 优先用上一轮预抽的那一个：预载的是它，真正播的也必须是它，
      // 否则每次预载都白下（浏览器里表现为一次 net::ERR_ABORTED）
      const pick = this.nextPick ?? this.decideNext()
      this.nextPick = null
      if (!pick) {
        this.running = false
        return
      }
      const meta = this.manifest.animations[pick.name]
      if (!meta) {
        this.lastName = pick.name
        continue
      }

      this.lastName = pick.name
      this.hooks.onAnimStart?.(pick.name, pick)

      // 预抽下一段并预载：抽签结果留到下一轮直接用
      this.nextPick = this.decideNext(pick.name)
      if (this.nextPick) {
        const peekMeta = this.manifest.animations[this.nextPick.name]
        if (peekMeta) this.player.preload(peekMeta.file)
      }

      const facing: Facing = meta.mirror ? this.facing : 'left'
      const result = await this.player.play(meta.file, facing)
      if (result === 'ended') this.hooks.onAnimEnd?.(pick.name)
      if (this.paused || this.inManual || this.dragging) return
    }
  }

  /** 换朝向（走到场景另一侧时翻面） */
  turn(facing: Facing): void {
    this.facing = facing
  }

  /**
   * 开始被拖拽：停掉自动链，播「被拎起来悬空」的姿势。
   * 位置由 PetStage 那边跟手更新，这里只管姿态。
   */
  beginDrag(): void {
    this.dragging = true
    this.paused = true
    // 清掉点击/点播残留；旧 flushManual 的 finally 会看到 dragging，不会恢复自动链。
    this.manualQueue = []
    this.nextPick = null
    this.player.interrupt()
    const name = (this.manifest.pools.drag ?? [])[0]
    if (!name) return
    const meta = this.manifest.animations[name]
    if (!meta) return
    this.hooks.onAnimStart?.(name, { name, kind: 'category' })
    void this.player.play(meta.file, meta.mirror ? this.facing : 'left')
  }

  /**
   * 播一个「过渡动作」（进门时的礼让），播 ms 毫秒后自动恢复自动链。
   * 不 await 播完：素材每段 10 秒，等完太久，切房间会卡住。
   */
  playTransition(name: string, ms = 2400): void {
    if (this.dragging) return
    const meta = this.manifest.animations[name]
    if (!meta) return
    this.paused = true
    this.player.interrupt()
    const facing: Facing = meta.mirror ? this.facing : 'left'
    this.hooks.onAnimStart?.(name, { name, kind: 'category' })
    void this.player.play(meta.file, facing)
    window.setTimeout(() => {
      this.paused = false
      if (this.running) void this.loop()
    }, ms)
  }

  /** 松手：恢复自动链，回到待机 */
  endDrag(): void {
    this.dragging = false
    // 若旧点击动作还没完成收尾，让它的 finally 负责恢复；否则立即回自动链。
    this.paused = this.inManual
    this.lastName = null // 别让下一轮因为「避免重复」被卡住
    if (this.running) void this.loop()
  }
}
