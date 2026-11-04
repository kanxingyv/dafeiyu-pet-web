/** 动作元信息（来自 manifest.json，由 dsh-pet 的 config.jsonc 生成） */
export interface AnimMeta {
  /** 视频文件名（相对 assets/anim/） */
  file: string
  /** 所属池子：idle / turn / drag / clicks / move / 分类名 / event:xxx */
  category: string
  /** 是否允许镜像（带文字的动画面向右时会被强制朝左） */
  mirror: boolean
}

export interface MoveAction {
  name: string
  params?: { minDist?: number; maxDist?: number; margin?: number; leadSec?: number; tailSec?: number }
}

export interface Category {
  id: string
  weight: number
  actions: string[]
  noMirror?: boolean
}

export interface Manifest {
  version: number
  generator: string
  source: { package: string; license: string; copyright: string; homepage: string }
  /** 素材基准宽度（px），所有位移/字号按 实际宽 / baseWidth 等比缩放 */
  baseWidth: number
  animations: Record<string, AnimMeta>
  pools: {
    idle: string[]
    turn: string[]
    drag: string[]
    clicks: string[]
    moves: { default?: Record<string, number>; actions: MoveAction[] }
    categories: Category[]
    events: Record<string, (string | string[])[]>
  }
  weights: { idle: number; turn: number; move: number }
  /** 中文标签 → 一句说明（面板上的 title） */
  memes: Record<string, string>
  /** 中文标签 → 实际文件名（m001.png…），由 filename-map.json 提供；老包可能没有 */
  memeFiles?: Record<string, string>
  workStatusTexts: string[]
}

/** 朝向：left = 素材原样，right = CSS scaleX(-1) */
export type Facing = 'left' | 'right'

/** 宠物当前在做什么 */
export type PetMode = 'idle' | 'work' | 'sleep' | 'manual'

/** 选片结果 */
export interface PickResult {
  name: string
  kind: 'idle' | 'turn' | 'move' | 'category'
  /** kind === 'move' 时的行进距离（以基准宽 462px 计，渲染端再等比缩放） */
  dist?: number
  categoryId?: string
}

/** 气泡内容 */
export interface BubbleContent {
  text: string
  /** 表情包名（memes 的键），可选 */
  image?: string
  /** 停留毫秒；不填按字数估算 */
  holdMs?: number
  /** 说话时播放的语音地址（阶段 5），有值时气泡显示波形 */
  voice?: string
}

/**
 * 场景配置（assets/bg/scene.json，由 scripts/analyze_room.py 从背景图分析出来）。
 * 它决定了「哪里是地板、哪里能走」。
 */
/** 房间之间的门：角色走到 x 附近会浮出「去xx」按钮 */
export interface SceneExit {
  /** 门在画面上的横向位置（占图宽比例） */
  x: number
  /** 目标场景 id */
  to: string
  /** 按钮文案 */
  label: string
  /** 按钮图标（emoji） */
  icon?: string
}

export interface SceneInfo {
  /** 场景 id（living / study / bedroom / lawn） */
  id: string
  /** 显示名（客厅 / 书房 / 卧室 / 草坪） */
  name: string
  image: string
  /** 夜晚版本（同一个房间、同一套构图，只是光照不同）。没有就退回 CSS 调色 */
  nightImage?: string
  /** 雨天版本（窗外阴雨、玻璃有水痕、室内无直射光）。没有就退回滤镜压暗 */
  rainImage?: string
  /** 雪天版本（灰白雪天、窗外积雪、室内柔光）。没有就退回滤镜 */
  snowImage?: string
  imageWidth: number
  imageHeight: number
  /** 墙脚线（占图高比例），角色不该越过它往上 */
  wallY: number
  /** 角色脚底踩的那条线（占图高比例） */
  standY: number
  /** 可走动范围（占图宽比例） */
  walkableX: [number, number]
  /** 这个房间通往别处的门 */
  exits?: SceneExit[]
  /**
   * 下雨时的作画区域。
   * 室内只该在窗玻璃上下雨 —— 屋里有雨一眼假，所以窗户坐标必须逐间标。
   * 户外（院子）就是整屏。
   */
  rain?: SceneRain
  /**
   * 可以站上去的家具平面（地面之外的）。
   * 拖到桌子/椅子/床上松手，她就落在这些面上，而不是一路掉回地板。
   * y = 脚底踩在该面上的位置（占图高比例，和 standY 同一套坐标）；
   * x = 该面的横向范围（占图宽比例），走出范围就掉回地面。
   */
  surfaces?: SceneSurface[]
}

export interface SceneSurface {
  y: number
  x: [number, number]
  /** 给人看/排错用，不参与逻辑 */
  name?: string
}

export interface SceneRain {
  /** 每块玻璃占画面的比例 [x, y, w, h] */
  windows: Array<[number, number, number, number]>
  /** 地面线（比例高）。有值才在地面画雨点涟漪，室内不填 */
  ground?: number
}

/** scenes.json 的整体结构 */
export interface ScenesFile {
  version: number
  default: string
  scenes: SceneInfo[]
}
