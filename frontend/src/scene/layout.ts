/**
 * 场景几何：把「一张房间图」变成一个可以走动的世界。
 *
 * 核心概念：
 *   - **世界（world）**：背景图按比例放大后的坐标系，比视口大
 *   - **摄像机（camX）**：世界里的一个横向窗口，决定看到哪一段
 *   - **角色（petX）**：角色在世界坐标里的位置，脚踩在 standY 这条线上
 *
 * 这样她跑起来是"房间在动"，而不是"贴在屏幕上滑"——
 * 也就不会出现跑出画面被切掉一半的问题。
 */
import type { SceneInfo } from '../engine/types'

/**
 * 角色身高 = 世界高 × 这个比例。
 *
 * ⚠️ 只能用世界尺寸算，**不能掺视口尺寸**。
 * 之前写成 min(vh*0.44, worldH*0.46)，宽屏时 worldH 被放大（1238 vs 视口 900），
 * 取到 vh*0.44 就等于「相对房间只有 32%」—— 换个屏幕比例，人和房间的比例就变了。
 */
const ROLE_OF_WORLD = 0.42

/**
 * 素材视频是 640×360（16:9），角色在画布里占高约 75%、宽约 34%（四周留白给动作幅度）。
 * 下面两个数字是 scripts/measure-foot.mjs 实测出来的，不是估的：
 *   - 角色从画布 16.7% 处开始，到 91.5% 处结束（脚底）
 * 用来把「想要的角色视觉高度」换算成视频容器尺寸，并让她正好踩在地面线上。
 */
const VIDEO_ASPECT = 16 / 9
export const ROLE_TOP_IN_VIDEO = 0.167
export const FOOT_IN_VIDEO = 0.915
const ROLE_IN_VIDEO_H = FOOT_IN_VIDEO - ROLE_TOP_IN_VIDEO

/**
 * 命中区（.pet-hit）占视频容器的比例。
 *
 * 角色本体在画布里只有横向 33.3%~66.7%、纵向 16.7%~91.5%（上面的实测数字），
 * 其余全是留给动作幅度的透明留白。之前 .pet-hit 用 inset:0 铺满整个容器，
 * 等于让她身边一大圈「空气」也能点能拖：鼠标明明停在旁边的门上，光标却是 grab；
 * 在空地按住拖一下，人就被隔空拖走。
 *
 * 这里收到角色本体，四边各留一点余量 —— 头发尾巴会甩出去，手指也点不准：
 * 横向 ±3.3%（和可走范围收边 0.17→0.2 同一思路），纵向头顶/脚下各留 ~3.5%。
 */
export const PET_HIT = {
  left: 0.3, // 0.333 − 0.033
  right: 0.7, // 0.667 + 0.033
  top: 0.13, // 0.167 − 0.037
  bottom: 0.95, // 0.915 + 0.035
} as const

export interface Layout {
  /** 背景图缩放比 */
  scale: number
  worldW: number
  worldH: number
  /** 世界在视口里的垂直偏移（底部对齐，房间地板贴住屏幕底） */
  worldY: number
  /** 视频容器尺寸 */
  boxW: number
  boxH: number
  /** 角色脚底在世界里的 y */
  groundY: number
  /** 可走范围（世界坐标） */
  walkMin: number
  walkMax: number
}

export function computeLayout(scene: SceneInfo, vw: number, vh: number): Layout {
  const { imageWidth: iw, imageHeight: ih } = scene
  /*
   * 缩放取「铺满高度」和「铺满宽度」的较大者，保证房间总能盖住视口。
   *
   * 关键不在 scale 怎么算，而在**角色尺寸只跟世界尺寸挂钩**（见下面 roleH）。
   * 只要 roleH = worldH × 0.42，无论屏幕多宽多窄，「人 : 房间」永远一样。
   * 之前出错是因为 roleH 掺了 vh —— 宽屏时世界被放大到 1238 而视口只有 900，
   * 角色却按视口算，于是相对房间缩水成 32%。
   */
  const scale = Math.max(vh / ih, vw / iw)
  const worldW = iw * scale
  const worldH = ih * scale

  const roleH = worldH * ROLE_OF_WORLD
  const boxH = roleH / ROLE_IN_VIDEO_H
  const boxW = boxH * VIDEO_ASPECT

  const groundY = scene.standY * worldH
  const [wx0, wx1] = scene.walkableX

  /*
   * 可走范围直接放到房间两端。
   * 之前收在 [vw/2, worldW-vw/2] 是为了让摄像机永远跟得动，但代价是
   * 桌面端可走范围只剩 0.31~0.69 —— 门在 0.18 / 0.9 的位置根本走不到，
   * 「到门口没触发回家」就是这么来的。
   * 现在改由 cameraFollow 的**死区**来平衡：角色在屏幕中间一小段内自由走，
   * 摄像机不动；走出死区才跟随。两头走到极限时摄像机停住，她在屏幕上滑。
   */
  /*
   * 可走范围按「角色半宽」收边。
   *
   * 实测（canvas 逐像素扫 alpha，待机/走路/跑步 5 个动作平均）：角色在 640×360
   * 画布里横向占 33.3%~66.7%，正好居中，半宽 = 容器宽的 0.17。
   * 这里取 0.2，多留 3% 呼吸位 —— 贴边时头发和尾巴会甩出去，卡在 0.17 上
   * 就是「头被切掉一半」。
   *
   * 之前写成 boxW*0.34（把全宽当半宽）是反的：既白留一倍空隙，又挡不住摄像机
   * 死区把她推出屏幕（手机竖屏最明显）。
   */
  const halfW = boxW * 0.2
  const walkMin = Math.max(halfW, wx0 * worldW)
  const walkMax = Math.max(walkMin, Math.min(worldW - halfW, wx1 * worldW))

  return {
    scale,
    worldW,
    worldH,
    worldY: Math.min(0, vh - worldH),
    boxW,
    boxH,
    groundY,
    walkMin,
    walkMax,
  }
}

/** 死区：角色在屏幕中间这段范围内走动时，摄像机不动（避免背景一直抖） */
const DEAD_ZONE = 0.14

/**
 * 摄像机跟随（带死区）。
 * @param camX 当前摄像机位置（需要状态，所以不能是纯函数）
 */
export function cameraFollow(petX: number, camX: number, layout: Layout, vw: number): number {
  const max = Math.max(0, layout.worldW - vw)
  const dead = vw * DEAD_ZONE
  const center = camX + vw / 2
  let target = camX
  if (petX > center + dead) target = petX - vw / 2 - dead
  else if (petX < center - dead) target = petX - vw / 2 + dead

  /*
   * 兜底：死区是「别让背景一直抖」，不是「允许把人推出屏幕」。
   * 角色贴到房间最左/最右时，死区会把她停在「出画 dead 像素」的位置 ——
   * 桌面端被 camX 的 0 下界挡住了看不出，手机竖屏（人几乎占满屏宽）就露馅：头没了。
   */
  const halfW = layout.boxW * 0.2
  const visibleMin = petX - halfW // camX 超过它，左边缘出画
  const visibleMax = petX + halfW - vw // camX 小于它，右边缘出画
  if (visibleMax > visibleMin) {
    // 角色比视口还宽：左右都保不住，只能居中
    target = (visibleMin + visibleMax) / 2
  } else {
    if (target > visibleMin) target = visibleMin
    if (target < visibleMax) target = visibleMax
  }

  return Math.min(max, Math.max(0, target))
}

/** 让摄像机直接对准角色（切房间 / 首次加载用） */
export function cameraCenter(petX: number, layout: Layout, vw: number): number {
  const max = Math.max(0, layout.worldW - vw)
  return Math.min(max, Math.max(0, petX - vw / 2))
}

/** 缓入缓出，走起来不那么机械 */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}
