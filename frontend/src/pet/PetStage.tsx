import { useCallback, useEffect, useRef, useState } from 'react'
import { PetEngine } from '../engine/engine'
import { PetPlayer } from '../engine/player'
import type { BubbleContent, Facing, Manifest, PickResult, SceneExit, SceneInfo } from '../engine/types'
import type { DayPhase } from '../scene/daylight'
import { WeatherLayer } from '../weather/WeatherLayer'
import type { Weather } from '../weather/rain'
import { Bubble } from '../bubble/Bubble'
import {
  cameraCenter,
  cameraFollow,
  computeLayout,
  easeInOut,
  FOOT_IN_VIDEO,
  PET_HIT,
  ROLE_TOP_IN_VIDEO,
  type Layout,
} from '../scene/layout'

/** 拖拽边缘滚动：指针进入屏幕左右这个比例的区域，摄像机开始滚 */
const EDGE_ZONE_RATIO = 0.12
/** 边缘滚动最大速度（px/s）。3410px 宽的客厅约 2.4 秒滚完 */
const EDGE_SCROLL_MAX = 1400

interface Props {
  manifest: Manifest
  scene: SceneInfo
  /** 白天 / 黑夜。有 nightImage 的房间会叠一张夜景图淡入淡出 */
  phase: DayPhase
  /** 晴 / 雨 / 雪。粒子只出现在窗玻璃和户外，室内不淋雨也不飘雪 */
  weather: Weather
  onReady?: (engine: PetEngine | null) => void
  /**
   * 走到门附近时回调（离开门口传空数组）。
   * 按钮的显示与定位都在外层：位置按门的世界比例固定，不跟随角色/摄像机。
   */
  onExitChange?: (exits: SceneExit[]) => void
  /** 她自己溜达到门口了，要换房间。外层负责播礼让动作 + 切场景 */
  onVisit?: (exit: SceneExit) => void
}

/** 素材里的走动动作统一约 10 秒（三段式：原地准备 → 跑 → 收尾站定） */
const CLIP_SEC = 10

/**
 * 走动速度：每秒走几个「角色身高」。
 *
 * 为什么不用 manifest 里的 minDist/maxDist：那是 dsh-pet 给 462px 小画布写的口径，
 * 换算到大屏上只剩 0.1 身高/秒 —— 脚在原地跑，人却在慢慢挪，看着像滑冰。
 * 真人走路约 0.9 身高/秒，卡通小人取一半多就够了（悠闲感），跑起来给到 1.15。
 *
 * 距离 = 速度 × 角色身高 × 动作可跑时长，所以「小碎步」和「奔跑」的差别
 * 是速度差出来的，不是配出来的 —— 动作是什么样，人就走成什么样。
 */
const MOVE_SPEED: Record<string, number> = {
  原地漂浮踏步: 0.18, // 小碎步：只挪一小段，像在屋里踱步
  螃蟹走路: 0.5, // 正常溜达
  /*
   * 「原地左转奔跑」名字骗人：实测第 0.4 秒还站着，第 5 秒整个人趴在地上爬
   * （dsh-pet 的搞怪素材）。给太快的速度会变成「趴着在地板上高速滑行」，
   * 所以按它真实的姿态给中速，比走路快一点就够。
   */
  原地左转奔跑: 0.62,
}
const DEFAULT_MOVE_SPEED = 0.5
/** 单趟最多占用可走范围的多少：留出余量，别每次都撞到墙上翻面 */
const MAX_TAKE = 0.8

export function PetStage({ manifest, scene, phase, weather, onReady, onExitChange, onVisit }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const petRef = useRef<HTMLDivElement>(null)
  const shadowRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const vaRef = useRef<HTMLVideoElement>(null)
  const vbRef = useRef<HTMLVideoElement>(null)

  const layoutRef = useRef<Layout | null>(null)
  const petXRef = useRef(0)
  /** 脚底的世界 y。默认 = groundY，拖拽时可以抬起来（垂直跟手），松手再落回去 */
  const petYRef = useRef(0)
  const camXRef = useRef(0)
  const facingRef = useRef<Facing>('left')
  const rafRef = useRef<number | null>(null)
  /** 角色命中区元素：拖拽事件改挂 window 后，命中区矩形/指针捕获仍要它 */
  const hitRef = useRef<HTMLDivElement | null>(null)
  const walkTimer = useRef<number | null>(null)
  /**
   * 拖拽：**钉子模式** —— 角色屏幕位置钉在指针上（保持按下时的抓取偏移），
   * 指针进入屏幕左右边缘区时摄像机自行滚动，世界坐标随之推进。
   * 这样鼠标和人永远不分离：想走远就把指针推到屏幕边缘，地图带着她走。
   */
  const dragRef = useRef<{
    pointerId: number
    lastX: number
    lastY: number
    startX: number
    startY: number
    active: boolean
    /** 指针当前屏幕位置（相对 stage 左上角） */
    pointerX: number
    pointerY: number
    /** 按下瞬间：角色屏幕位置 − 指针位置。抓哪儿就是哪儿，不跳到指针中心 */
    grabDX: number
    grabDY: number
  } | null>(null)
  /** 松手后落回地面的缓动句柄 */
  const dropRafRef = useRef<number | null>(null)
  const engineRef = useRef<PetEngine | null>(null)
  const playerRef = useRef<PetPlayer | null>(null)
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  const visitCbRef = useRef(onVisit)
  visitCbRef.current = onVisit
  /**
   * 自己串门进行中。串门的每一段都会 engine.act(走路动作)，而 act 会触发
   * onMove → walkBy —— 两套位移（autoVisit 的 walkTo 和引擎的 walkBy）
   * 会互相 cancelAnimationFrame 抢 petX，她就在原地抽搐。
   * 这个标志立起来之后，引擎的位移让路，串门结束（切场景重建）才放下。
   */
  const visitingRef = useRef(false)
  /**
   * 门口读条：**按钮出现就开始读**。
   *
   * 她站在门口（按钮出现）→ 头顶进度条自动填 1 秒 → 自动进对应房间。
   * 不需要按住鼠标、不需要松手；离开门口 / 被拖走 / 正在串门 → 取消。
   *
   * 这样设计的原因：读条不依赖任何指针事件，WE 的 CEF 指针兼容差异影响不到它；
   * 同时与拖拽彻底解耦 —— 拖拽只管 6px 跟手，不再被读条状态干扰。
   */
  const [waking, setWaking] = useState(false)
  const [wakeReady, setWakeReady] = useState(false)
  const wakeTimer = useRef<number | null>(null)
  /** waking / wakeReady 的同步影子（pointerup 要立刻判断，不能等 re-render） */
  const wakingRef = useRef(false)
  const wakeReadyRef = useRef(false)
  /** 读条触发后的冷却：防止切场景途中被重复触发 */
  const wakeCooldownRef = useRef(0)
  /** paint() 每帧维护：此刻站在哪个门口（唤醒跳转的目标 = nearExitRef.current[0]） */
  const nearExitRef = useRef<SceneExit[]>([])
  const exitCbRef = useRef(onExitChange)
  exitCbRef.current = onExitChange
  /** 上一次「站在哪个门口」，只在变化时回调，避免每帧 setState */
  const lastExitRef = useRef<string | null>(null)
  /** 上一次的场景 id：切房间时把角色放回中间 */
  const sceneIdRef = useRef<string | null>(null)

  const isNight = phase === 'night'
  /**
   * 有对应天气的素材就用它；没有就继续显示晴天图，由 CSS 压暗兜底。
   * 雨夜/雪夜也走对应天气的素材（再压成夜色）—— 用夜景图会出现
   * 「星空下着雨」「星空下着雪」，而且单出夜雨夜雪素材不划算。
   */
  const showRain = weather === 'rain' && !!scene.rainImage
  const showSnow = weather === 'snow' && !!scene.snowImage
  const showDay = !isNight && !showRain && !showSnow
  const showNight = isNight && !showRain && !showSnow

  const [bubble, setBubble] = useState<BubbleContent | null>(null)
  const [current, setCurrent] = useState('')
  const [facing, setFacing] = useState<Facing>('left')

  /** 把世界/角色/摄像机的位置写进 DOM（每帧直接改 style，不经过 React） */
  const paint = useCallback(() => {
    const L = layoutRef.current
    if (!L) return
    if (worldRef.current) {
      worldRef.current.style.width = `${L.worldW}px`
      worldRef.current.style.height = `${L.worldH}px`
      worldRef.current.style.transform = `translate3d(${-camXRef.current}px, ${L.worldY}px, 0)`
    }
    // 走到门附近 → 通知外层显示该门的按钮（离开门口即消失）
    const exits = scene.exits ?? []
    if (exits.length > 0) {
      const ratio = petXRef.current / L.worldW
      const atRightEnd = petXRef.current >= L.walkMax - L.worldW * 0.02
      const atLeftEnd = petXRef.current <= L.walkMin + L.worldW * 0.02
      // 兜底阈值按出口实际位置收紧，避免走到最右时把 0.755 的门也捞进来
      let near: SceneExit[] = exits.filter((e) => Math.abs(ratio - e.x) < 0.07)
      if (!near.length && atRightEnd) near = exits.filter((e) => e.x >= 0.85)
      if (!near.length && atLeftEnd) near = exits.filter((e) => e.x <= 0.2)
      const key = near.map((e) => e.to).join('|')
      nearExitRef.current = near
      if (key !== lastExitRef.current) {
        lastExitRef.current = key
        exitCbRef.current?.(near)
      }
    }


    if (petRef.current) {
      petRef.current.style.left = `${petXRef.current}px`
      // 容器底边在脚底下方的留白处，往下压这么多，脚才真正踩在 standY 线上。
      // 再多压 1.2% 是故意的：让她「陷」进地面一点点，配合阴影才有踩实的重量感。
      const sink = L.boxH * 0.012
      petRef.current.style.top = `${petYRef.current + L.boxH * (1 - FOOT_IN_VIDEO) + sink}px`
      if (shadowRef.current) {
        /*
         * 被拎起来时影子要留在地面：底边按悬空高度往下补，同时缩小、变淡。
         * 不然影子跟着人一起飞，「踩实」的重量感就没了。
         */
        const lift = Math.max(0, L.groundY - petYRef.current)
        const base = (1 - FOOT_IN_VIDEO) * 100 - 1.2
        const k = Math.max(0.42, 1 - lift / (L.boxH * 0.55))
        shadowRef.current.style.bottom = `${base - (lift / L.boxH) * 100}%`
        shadowRef.current.style.setProperty('--shadow-scale', k.toFixed(3))
        shadowRef.current.style.opacity = lift > 1 ? `${Math.max(0.28, k * 0.9)}` : ''
      }
      petRef.current.style.width = `${L.boxW}px`
      petRef.current.style.height = `${L.boxH}px`
    }
  }, [scene])

  /** 重新算布局（窗口尺寸变了 / 首次挂载） */
  const relayout = useCallback(() => {
    const el = stageRef.current
    if (!el) return
    const vw = el.clientWidth
    const vh = el.clientHeight
    const prev = layoutRef.current
    const next = computeLayout(scene, vw, vh)

    const sameScene = sceneIdRef.current === scene.id
    sceneIdRef.current = scene.id
    if (prev && sameScene) {
      // 只是转屏/改窗口：位置按世界比例保持，别把她瞬移到墙角
      const ratio = next.worldW / prev.worldW
      petXRef.current = Math.min(next.walkMax, Math.max(next.walkMin, petXRef.current * ratio))
      // 垂直：在地面上就贴回新的地面线；被拖在半空就按世界高比例缩放
      const onGround = Math.abs(petYRef.current - prev.groundY) < 2
      petYRef.current = onGround
        ? next.groundY
        : petYRef.current * (next.worldH / prev.worldH)
    } else {
      // 刚进这个房间（或第一次加载）：站在中间。
      // 但中间要是正好压在门口，会一进门就弹「去xx」——往旁边挪开一点
      let start = (next.walkMin + next.walkMax) / 2
      const exits = scene.exits ?? []
      const hitDoor = exits.some((e) => Math.abs(start / next.worldW - e.x) < 0.07)
      if (hitDoor) {
        const shift = next.worldW * 0.14
        start = Math.min(next.walkMax, Math.max(next.walkMin, start + shift))
      }
      petXRef.current = start
      // 进新房间一律踩回地面（上一条命被拖在半空的话别带到新房间去）
      petYRef.current = next.groundY
      lastExitRef.current = null
      exitCbRef.current?.([])
    }
    camXRef.current = cameraCenter(petXRef.current, next, vw)
    layoutRef.current = next
    paint()
  }, [scene, paint])

  useEffect(() => {
    relayout()
    const ro = new ResizeObserver(() => relayout())
    if (stageRef.current) ro.observe(stageRef.current)
    return () => ro.disconnect()
  }, [relayout])

  /**
   * 走一段：先等 delayMs（动画开头那几秒她还在原地准备），再在 durationMs 内移动。
   * 这样「脚开始动」和「人开始走」是同一时刻，不会出现脚没动人在滑。
   */
  /**
   * 松手时该落在哪个面上。
   *
   * 候选 = 地面 + 当前横向位置覆盖到的家具顶面（scenes.json 的 surfaces）。
   * 取「不高于脚底太多」的最高那个：拖到桌面上方松手 → 落桌面；
   * 站在桌面往边缘拖出去 → 该处没有家具 → 落回地面。
   */
  const landingY = useCallback(
    (L: Layout, x: number, y: number, tolRatio = 0.03): number => {
      const wx = x / L.worldW
      const tol = L.worldH * tolRatio
      let best = L.groundY
      for (const s of scene.surfaces ?? []) {
        if (wx < s.x[0] || wx > s.x[1]) continue
        const sy = s.y * L.worldH
        // sy >= y - tol：面在脚底下方（或刚好齐平），不能「落」到头顶上的面去
        if (sy >= y - tol && sy < best) best = sy
      }
      return best
    },
    [scene],
  )

  /**
   * 松手后缓动落到支撑面（地面或家具）。
   * 素材全是「脚踩地板」的站立动作，悬在半空会露馅。
   */
  const dropToGround = useCallback(() => {
    const L = layoutRef.current
    if (!L) return
    if (dropRafRef.current !== null) {
      cancelAnimationFrame(dropRafRef.current)
      dropRafRef.current = null
    }
    /*
     * 拖拽松手用宽松容差（0.22 个世界高 ≈ 半个身高）：
     * 玩家把指针放在柜面/桌面「上」，抓取偏移会让她的脚已经沉到台面下方一截 ——
     * 用走路的严格 3% 判定会落空掉回地面，看起来就是「这里放不上去」。
     */
    const target = landingY(L, petXRef.current, petYRef.current, 0.22)
    if (Math.abs(petYRef.current - target) < 1) {
      petYRef.current = target
      paint()
      return
    }
    const step = () => {
      const d = target - petYRef.current
      if (Math.abs(d) < 1.5) {
        petYRef.current = target
        paint()
        dropRafRef.current = null
        return
      }
      // 0.12/帧 ≈ 600ms 落完，是「缓降」不是「瞬移」
      petYRef.current += Math.max(d * 0.07, d > 0 ? 1.2 : -1.2)
      paint()
      dropRafRef.current = requestAnimationFrame(step)
    }
    dropRafRef.current = requestAnimationFrame(step)
  }, [paint, landingY])

  const walkTo = useCallback(
    (targetX: number, delayMs: number, durationMs: number) => {
      const L = layoutRef.current
      const stage = stageRef.current
      if (!L || !stage) return
      const vw = stage.clientWidth

      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (walkTimer.current) clearTimeout(walkTimer.current)

      const begin = () => {
        const start = petXRef.current
        const t0 = performance.now()
        const step = (now: number) => {
          const k = Math.min(1, (now - t0) / durationMs)
          petXRef.current = start + (targetX - start) * easeInOut(k)
          /*
           * 边走边落：从椅子/桌子上走下来时，脚下的支撑面会变。
           * 只在起步时算一次是不够的 —— 那一刻 petX 还在家具范围内，
           * 目标仍是家具面，于是她会踩着空气一路走到房间另一头（老板报的「跑完不回地面」）。
           */
          const want = landingY(L, petXRef.current, petYRef.current)
          if (want > petYRef.current + 0.5) {
            const d = want - petYRef.current
            // 0.08/帧 + 2px 下限：从椅子高度落下来约 500~600ms，是「缓缓飘下」不是「啪一下掉地上」
            petYRef.current += Math.min(d, Math.max(2, d * 0.045))
          }
          camXRef.current = cameraFollow(petXRef.current, camXRef.current, L, vw)
          paint()
          if (k < 1) {
            rafRef.current = requestAnimationFrame(step)
          } else {
            rafRef.current = null
            // 走完了还没落干净（走的时间比落地短）→ 交给缓降收尾，别停在半空
            if (landingY(L, petXRef.current, petYRef.current) > petYRef.current + 1) dropToGround()
          }
        }
        rafRef.current = requestAnimationFrame(step)
      }

      if (delayMs > 0) walkTimer.current = window.setTimeout(begin, delayMs)
      else begin()
    },
    [paint, landingY, dropToGround],
  )

  /** 走一段相对距离；撞到边界就翻面 */
  const walkBy = useCallback(
    (distPx: number, delayMs: number, durationMs: number) => {
      const L = layoutRef.current
      if (!L) return
      // 站在家具上开始溜达不用在这里处理：walkTo 每帧会按脚下的支撑面往下落
      const dir = facingRef.current === 'right' ? 1 : -1
      let target = petXRef.current + dir * distPx

      if (target < L.walkMin || target > L.walkMax) {
        // 撞到可走边界：翻面，并且**朝反方向继续走一段**。
        // 只 clamp 的话她会贴在边上原地踏步，看着像卡住了。
        const next: Facing = facingRef.current === 'right' ? 'left' : 'right'
        facingRef.current = next
        setFacing(next)
        playerRef.current?.setFacing(next)
        engineRef.current?.turn(next)
        const back = next === 'right' ? 1 : -1
        target = Math.min(L.walkMax, Math.max(L.walkMin, petXRef.current + back * distPx))
      }
      walkTo(target, delayMs, durationMs)
    },
    [walkTo],
  )

  /**
   * 自己串门：一段段走到门口，到了再交回外层切场景。
   *
   * 为什么要分段：走动动作一段只有约 6 秒可跑（lead 2s + tail 2s），
   * 从房间一头走到另一头根本走不完 —— 一次 walkTo 走 2000px 会变成「滑行」。
   * 所以每段最多 650px，走完接下一个动作，看起来就是「走两步、看看、再走」。
   */
  const autoVisit = useCallback(() => {
    const exits = scene.exits ?? []
    const L = layoutRef.current
    const engine = engineRef.current
    if (!exits.length || !L || !engine) return
    if (dragRef.current || document.hidden) return

    const moves = manifest.pools.moves?.actions ?? []
    if (!moves.length) return

    const exit = exits[Math.floor(Math.random() * exits.length)]
    const targetX = Math.min(L.walkMax - 2, Math.max(L.walkMin + 2, exit.x * L.worldW))
    const roleH = L.boxH * (FOOT_IN_VIDEO - ROLE_TOP_IN_VIDEO)
    const speed = 0.55 * roleH // px/s，和 MOVE_SPEED 里「正常溜达」一档对齐

    visitingRef.current = true
    const step = (guard: number) => {
      if (guard > 8) {
        visitingRef.current = false // 没走到门口（极端情况），把位移还给引擎
        return
      }
      const cur = petXRef.current
      const dx = targetX - cur
      if (Math.abs(dx) < 46) {
        // 到门口了：外层会播礼让动作再切房间
        window.setTimeout(() => visitCbRef.current?.(exit), 140)
        return
      }

      const seg = Math.sign(dx) * Math.min(650, Math.abs(dx))
      const act = moves[Math.floor(Math.random() * moves.length)]
      const dir: Facing = seg > 0 ? 'right' : 'left'

      facingRef.current = dir
      setFacing(dir)
      playerRef.current?.setFacing(dir)
      engine.turn(dir)
      void engine.act(act.name)

      const dur = Math.max(900, Math.min(5200, (Math.abs(seg) / speed) * 1000))
      walkTo(cur + seg, 420, dur)
      window.setTimeout(() => step(guard + 1), dur + 480)
    }

    step(0)
  }, [scene, manifest, walkTo])

  /*
   * 串门节奏：70~140 秒掷一次骰子，只有 34% 会真的出门。
   * 算下来平均三五分钟换一个房间 —— 太勤会显得她坐不住，太懒又看不到。
   */
  useEffect(() => {
    if (!scene.exits?.length) return
    let alive = true
    let timer = 0
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (!alive) return
        if (Math.random() < 0.34) autoVisit()
        schedule()
      }, 70_000 + Math.random() * 70_000)
    }
    schedule()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [scene, autoVisit])

  /**
   * 垂直可拖范围。
   * 头顶别飞出画面上沿，脚底别掉出下沿，也不比地面低太多（否则看起来像陷进地板）。
   *
   * 下限从 0.95 放宽到 0.72：院子的屋顶(0.33)、树冠(0.32)
   * 都在旧限制之上——不放宽就永远拖不上去（松手会落回地面）。代价是站这些
   * 高处时头顶会出画一点点，属于 2D 立绘 + 高平台的物理必然。
   */
  const clampPetY = useCallback((y: number, L: Layout): number => {
    const vh = stageRef.current?.clientHeight ?? L.worldH
    const visibleTop = -L.worldY
    const roleH = L.boxH * (FOOT_IN_VIDEO - ROLE_TOP_IN_VIDEO)
    const minY = visibleTop + roleH * 0.72
    const maxY = Math.min(visibleTop + vh, L.groundY + L.boxH * 0.06)
    return Math.min(maxY, Math.max(minY, y))
  }, [])

  /**
   * 拖拽主循环（钉子模式，拖拽期间常驻，不自我停止）。
   *
   * 每帧做三件事：
   * ① 角色屏幕位置 = 指针 + 抓取偏移（钳在可视区内）—— 鼠标和人永远不分离
   * ② 指针靠近屏幕左右边缘 → 摄像机按二次曲线滚动（越靠边越快）；
   *    滚动上限与角色世界边界联动，只滚到「她还能钉在指针上」为止
   * ③ 世界坐标 = 屏幕位置 + 摄像机 —— 背景滚动时她随世界一起被带着走
   *
   * 为什么必须常驻循环而不是 pointermove 驱动：指针停在边缘不动时，
   * 地图仍需持续滚动，而 pointermove 在指针静止时不会触发。
   */
  const dragLoop = useCallback(() => {
    if (rafRef.current !== null) return
    const stage = stageRef.current
    if (!stage) return
    let last = performance.now()
    const step = (now: number) => {
      const d = dragRef.current
      const L = layoutRef.current
      if (!d || !d.active || !L || !stage) {
        rafRef.current = null
        return
      }
      const vw = stage.clientWidth
      // 长帧（切后台 / 卡顿）钳到 50ms，避免地图一下跳很远
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now

      // ① 屏幕目标位置：钉在指针上，留边防止被推出画面
      const margin = L.boxW * 0.12
      const sx = Math.min(vw - margin, Math.max(margin, d.pointerX + d.grabDX))
      const sy = clampPetY(d.pointerY + d.grabDY, L)

      // ② 边缘滚动：越靠边越快（二次曲线，进区时缓慢起滚不突兀）
      const zone = Math.max(48, vw * EDGE_ZONE_RATIO)
      let scroll = 0
      if (d.pointerX < zone) {
        const k = (zone - d.pointerX) / zone
        scroll = -EDGE_SCROLL_MAX * k * k
      } else if (d.pointerX > vw - zone) {
        const k = (d.pointerX - (vw - zone)) / zone
        scroll = EDGE_SCROLL_MAX * k * k
      }
      if (scroll !== 0) {
        const pad = L.boxW * 0.16
        const camMax = Math.max(0, L.worldW - vw)
        // 使 petX = sx + camX 留在 [pad, worldW-pad] 内的 camX 可行区间。
        // 只滚到这里为止 —— 世界尽头和指针位置合力决定能滚多远，人鼠始终不分离。
        const camLo = Math.max(0, pad - sx)
        const camHi = Math.min(camMax, L.worldW - pad - sx)
        if (camHi >= camLo) {
          camXRef.current = Math.min(camHi, Math.max(camLo, camXRef.current + scroll * dt))
        }
      }

      // ③ 世界坐标 = 屏幕位置 + 摄像机
      const pad = L.boxW * 0.16
      petXRef.current = Math.min(L.worldW - pad, Math.max(pad, sx + camXRef.current))
      petYRef.current = sy
      paint()
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }, [paint, clampPetY])

  /** 松手后把摄像机平滑追到「她居中」的位置 */
  const settleCamera = useCallback(() => {
    const L = layoutRef.current
    const stage = stageRef.current
    if (!L || !stage) return
    const vw = stage.clientWidth
    const target = cameraCenter(petXRef.current, L, vw)
    const step = () => {
      const dx = target - camXRef.current
      if (Math.abs(dx) < 0.8) {
        camXRef.current = target
        paint()
        return
      }
      camXRef.current += dx * 0.18
      paint()
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [paint])

  /** 取消唤醒（拖走了 / 松手了 / 切场景） */
  const cancelWake = useCallback(() => {
    if (wakeTimer.current !== null) {
      window.clearTimeout(wakeTimer.current)
      wakeTimer.current = null
    }
    wakingRef.current = false
    wakeReadyRef.current = false
    setWaking(false)
    setWakeReady(false)
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 先停掉尚未起步的走动；正在播的位置帧留到真正进入拖拽时再取消，
    // 避免普通点击在 pointerdown 时先掐掉一帧，造成门口点击「卡一下」。
    if (walkTimer.current) {
      clearTimeout(walkTimer.current)
      walkTimer.current = null
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const stage = stageRef.current
    const rect = stage?.getBoundingClientRect()
    const px = rect ? e.clientX - rect.left : e.clientX
    const py = rect ? e.clientY - rect.top : e.clientY
    /*
     * 抓取偏移：按下瞬间「角色屏幕位置 − 指针位置」。
     * 之后每一帧她都被钉在指针 + 这个偏移上 —— 抓头发就是抓头发，抓脚就是抓脚，
     * 不会像吸附到指针中心那样瞬移一下。
     */
    const grabDX = petXRef.current - camXRef.current - px
    dragRef.current = {
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      pointerX: px,
      pointerY: py,
      grabDX,
      grabDY: petYRef.current - py,
    }
    // 读条不在这里启动：统一由下方「按住 + 门口 + 静止」的状态机管理，
    // 这样拖到门口停住也能自动开始读条（不需要重新按一次）。
    // 上一把还在下落就掐掉，交给手指接管
    if (dropRafRef.current !== null) {
      cancelAnimationFrame(dropRafRef.current)
      dropRafRef.current = null
    }
  }

  /*
   * 拖拽的 move/up 不绑在角色元素上，而是挂到 window（见下方 effect）：
   * WE 的 CEF 里 setPointerCapture 可能失效，一旦指针移出角色矩形就收不到
   * pointermove —— 表现就是「拖起来后中途断掉」。挂 window 后不依赖捕获。
   */
  const onPointerMove = (e: { pointerId: number; clientX: number; clientY: number }) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const stage = stageRef.current
    if (!stage) return

    // 指针屏幕位置（相对 stage）—— dragLoop 每帧读它，不需要在这里算位移
    const rect = stage.getBoundingClientRect()
    d.pointerX = e.clientX - rect.left
    d.pointerY = e.clientY - rect.top


    if (!d.active) {
      /*
       * 拖拽 > 读条 > 点击：
       * - 普通状态位移达到 6px 就进入拖拽，点击动作不得提高这个阈值。
       * - 读条期间不看固定像素距离，而看指针是否离开角色命中区；
       *   在身上画圈继续读条，真正拖出身体才取消并立即接管为拖拽。
       */
      /*
       * 拖拽永远优先：任何 6px 的移动都立即接管，读条不阻挡拖拽。
       * （之前这里判「指针是否离开角色命中区」，导致在门口想拖她必须拖出
       *   300px 才动 —— 手感像卡住。读条与拖拽改为并行状态：一移动就拖拽，
       *   拖到门口停住 200ms 后读条自动恢复，见下方 holding effect。）
       */
      /*
       * 拖拽只管跟手：6px 就是点击 / 拖拽分界，不受读条状态影响。
       * 读条是独立状态（见下方状态机），拖走 → 离开门口 → 读条自动取消。
       */
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) {
        return
      }

      d.active = true
      cancelWake()
      innerRef.current?.classList.remove('squash')
      if (walkTimer.current) {
        clearTimeout(walkTimer.current)
        walkTimer.current = null
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      engineRef.current?.beginDrag()
      dragLoop()
    }
  }

  const onPointerUp = (e: { pointerId: number }) => {
    const d = dragRef.current
    dragRef.current = null
    try {
      hitRef.current?.releasePointerCapture?.(e.pointerId)
    } catch {
      /* 指针已经释放，忽略 */
    }
    /*
     * 拖到门口读满后松手：进对应房间（与点门口按钮同一条路径）。
     * 读满前就松手 / 已经拖走 → 走普通松手流程（落回地面或家具）。
     */
    const wasWake = wakeReadyRef.current
    cancelWake()
    if (wasWake) {
      const exit = nearExitRef.current[0]
      if (exit && d?.active) {
        visitCbRef.current?.(exit)
        return
      }
    }
    if (d?.active) {
      engineRef.current?.endDrag()
      /*
       * 先停掉拖拽循环再下落。
       * 不然它每帧把 petY 钉回指针位置，和 dropToGround 的回落互相覆盖 ——
       * 快速拖拽 + 快速松手就会停在半空。
       */
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      settleCamera()
      // 松手落回地面（或落到家具上）
      dropToGround()
    } else {
      // 没拖动 = 点了一下
      doSquash()
      engineRef.current?.poke()
    }
  }

  const doSquash = useCallback(() => {
    const el = innerRef.current
    if (!el) return
    el.classList.remove('squash')
    void el.offsetWidth
    el.classList.add('squash')
  }, [])

  useEffect(() => {
    const a = vaRef.current
    const b = vbRef.current
    if (!a || !b) return

    const player = new PetPlayer()
    player.attach(a, b)
    playerRef.current = player

    visitingRef.current = false // 换了场景，位移管理还给引擎
    const engine = new PetEngine(manifest, player, {
      onAnimStart: (name: string, pick: PickResult) => {
        setCurrent(name)
        // 朝向以引擎为准：外部指令可能刚指定了 facing（比如 API 传 facing:right），
        // 这里不同步的话，走动方向还是按旧朝向走 —— 表现为「让她向右跑却向左走」。
        const ef = engineRef.current?.currentFacing
        if (ef && ef !== facingRef.current) {
          facingRef.current = ef
          setFacing(ef)
          player.setFacing(ef)
        }
        if (pick.kind === 'turn') {
          const next: Facing = facingRef.current === 'right' ? 'left' : 'right'
          facingRef.current = next
          setFacing(next)
          player.setFacing(next)
          engine.turn(next)
        }
        // 是不是「走动」类动作？自动链靠 pick.kind，手动点播要靠动作名反查
        const moveList = manifest.pools.moves?.actions ?? []
        const moveAct = moveList.find((a) => a.name === name)
        if (pick.kind === 'move' || moveAct) {
          const L = layoutRef.current
          if (!L) return

          const roleH = L.boxH * (FOOT_IN_VIDEO - ROLE_TOP_IN_VIDEO)

          // 动画是「原地准备 → 跑 → 收尾站定」三段式，时序取自 dsh-pet 的配置
          const def = manifest.pools.moves?.default ?? {}
          const lead = moveAct?.params?.leadSec ?? def.leadSec ?? 2
          const tail = moveAct?.params?.tailSec ?? def.tailSec ?? 2
          const run = Math.max(1.2, CLIP_SEC - lead - tail)

          /*
           * 位移由「速度 × 身高 × 可跑时长」算出来，而不是从配置里抽一个像素数。
           * 这样小碎步真的只挪一小段、奔跑真的能横穿过去 —— 脚上的动作就是脚下的距离。
           * 最后再按可走范围收一刀，免得每次都撞墙翻面。
           */
          const speed = MOVE_SPEED[name] ?? DEFAULT_MOVE_SPEED
          const room = L.walkMax - L.walkMin
          const dist = Math.min(speed * roleH * run, room * MAX_TAKE)

          if (visitingRef.current) return // 串门中：位移由 autoVisit 负责，引擎别抢
          if (visitingRef.current) return // 串门中：位移由 autoVisit 负责，引擎别抢
          walkBy(dist, lead * 1000, run * 1000)
        }
      },
      onBubble: (content: BubbleContent) => setBubble(content),
    })

    engineRef.current = engine
    readyRef.current?.(engine)
    engine.start()

    const onVis = () => {
      if (document.hidden) engine.pause()
      else engine.resume()
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      if (dropRafRef.current !== null) cancelAnimationFrame(dropRafRef.current)
      dropRafRef.current = null
      if (walkTimer.current) clearTimeout(walkTimer.current)
      engine.stop()
      engineRef.current = null
      readyRef.current?.(null)
    }
  }, [manifest, walkBy])

  /*
   * 拖拽的 move/up 挂到 window，而不是绑在角色元素上。
   *
   * 原因：WE 的 CEF 里 setPointerCapture 可能失效，一旦捕获失效、指针移出
   * 角色矩形，元素上的 pointermove 就收不到 —— 手感就是「拖着拖着断了」。
   * 挂 window 后不依赖捕获，指针在窗口任何位置都能继续拖。
   *
   * 常驻监听、靠 dragRef 判空过滤，非拖拽时的开销可忽略。
   */
  const moveHandlerRef = useRef(onPointerMove)
  moveHandlerRef.current = onPointerMove
  const upHandlerRef = useRef(onPointerUp)
  upHandlerRef.current = onPointerUp

  /*
   * 读条状态机（**拖拽到门口才读条**，用户定稿）：
   *   鼠标拖着她到达门口（按钮出现的那一瞬）→ 头顶进度条开始填 1 秒
   *   → 读满后**松手**就进对应房间。
   *
   *   拖走（离开门口）/ 松手时还没读满 → 取消，不进门。
   *   她自己走到门口（没在拖拽）→ 只有按钮，不读条。
   *
   * 读条不依赖 pointermove 的位置计算：WE 的 CEF 指针兼容差异影响不到它。
   */
  useEffect(() => {
    const id = window.setInterval(() => {
      const near = nearExitRef.current.length > 0
      const dragging = !!dragRef.current?.active
      const canWake =
        near &&
        dragging &&
        !visitingRef.current &&
        performance.now() > wakeCooldownRef.current
      if (canWake && !wakingRef.current) {
        wakingRef.current = true
        setWaking(true)
        if (wakeTimer.current !== null) window.clearTimeout(wakeTimer.current)
        wakeTimer.current = window.setTimeout(() => {
          wakeTimer.current = null
          // 读满：进度条变金色，等松手进门（onPointerUp 处理）
          wakeReadyRef.current = true
          setWakeReady(true)
        }, 1000)
      } else if (!canWake && wakingRef.current) {
        cancelWake()
      }
    }, 120)
    return () => {
      window.clearInterval(id)
      if (wakeTimer.current !== null) window.clearTimeout(wakeTimer.current)
    }
  }, [cancelWake])

  /* 换房间后冷却 2.5s：她刚落到新房间门口时不至于立刻又被读条带走 */
  useEffect(() => {
    wakeCooldownRef.current = performance.now() + 2500
    cancelWake()
  }, [scene.id, cancelWake])

  useEffect(() => {
    const handleMove = (e: PointerEvent) => moveHandlerRef.current(e)
    const handleUp = (e: PointerEvent) => upHandlerRef.current(e)
    window.addEventListener('pointermove', handleMove, { passive: true })
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [])

  return (
    <div className="stage" ref={stageRef}>
      <div className="world" ref={worldRef}>
        {/*
          三套图叠着，只改 opacity 交叉淡入（0.9s），绝不换 src：
          换 src 会经历「卸载 → 重新解码 → 首帧」，中间必然黑一下。
          晴天 / 雨天 / 夜晚 —— 雨夜没有单独素材，用夜景图 + 雨层顶上。
        */}
        <img
          className="room-bg room-bg--day"
          src={`./assets/bg/${scene.image}`}
          alt=""
          draggable={false}
          style={{ opacity: showDay ? 1 : 0 }}
        />
        {scene.rainImage && (
          <img
            className="room-bg room-bg--rain"
            src={`./assets/bg/${scene.rainImage}`}
            alt=""
            draggable={false}
            style={{ opacity: showRain ? 1 : 0 }}
          />
        )}
        {scene.snowImage && (
          <img
            className="room-bg room-bg--snow"
            src={`./assets/bg/${scene.snowImage}`}
            alt=""
            draggable={false}
            style={{ opacity: showSnow ? 1 : 0 }}
          />
        )}
        {scene.nightImage && (
          <img
            className="room-bg room-bg--night"
            src={`./assets/bg/${scene.nightImage}`}
            alt=""
            draggable={false}
            style={{ opacity: showNight ? 1 : 0 }}
          />
        )}

        {/*
          动态雨层只做「动」，不做「像」——
          阴天、乌云、玻璃水痕、地面积水全在素材里，代码再糊一层只会变脏。
        */}
        {(weather === 'rain' || weather === 'snow') && scene.rain && (
          <WeatherLayer
            weather={weather}
            sceneId={scene.id}
            options={{
              rects: scene.rain.windows.map(([x, y, w, h]) => ({ x, y, w, h })),
              ground: scene.rain.ground ?? null,
              intensity: 0.9,
            }}
          />
        )}
        <div className="pet-layer" ref={petRef} data-facing={facing}>
          {bubble && <Bubble content={bubble} onDismiss={() => setBubble(null)} />}
          {/* 常驻 DOM，只切 class：1 秒填满，满格变暖色 = 松手进门 */}
          <div
            className={`wake-bar${waking ? ' active' : ''}${wakeReady ? ' ready' : ''}`}
            aria-hidden
          >
            <i />
          </div>
          <div className="pet-shadow" ref={shadowRef} style={{ bottom: `${(1 - FOOT_IN_VIDEO) * 100}%` }} />
          <div className="pet-inner" ref={innerRef}>
            <video className="pet-video" ref={vaRef} muted playsInline preload="auto" />
            <video className="pet-video" ref={vbRef} muted playsInline preload="auto" style={{ opacity: 0 }} />
          </div>
          <div
            className="pet-hit"
            ref={hitRef}
            style={{
              // 命中区贴角色本体，不铺满整个容器（容器四边是留给动作幅度的透明留白）
              left: `${PET_HIT.left * 100}%`,
              top: `${PET_HIT.top * 100}%`,
              width: `${(PET_HIT.right - PET_HIT.left) * 100}%`,
              height: `${(PET_HIT.bottom - PET_HIT.top) * 100}%`,
            }}
            // 只有按下绑在这里；move/up 挂在 window 上（见上方 effect）
            onPointerDown={onPointerDown}
            role="button"
            aria-label="戳一下大肥鱼（按住可以拖动）"
          />
        </div>
      </div>
      {import.meta.env.DEV && <div className="hud">{current || '…'}</div>}
    </div>
  )
}
