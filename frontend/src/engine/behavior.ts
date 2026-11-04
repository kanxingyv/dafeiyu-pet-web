import { Lunar } from 'lunar-javascript'
import type { Manifest, PickResult } from './types'

/**
 * 行为调度：把「待机安静动作」和「定时小事件」分开，并按时间/节日/季节/三餐加权。
 *
 * 设计原则：
 * 1. 纯函数 + 显式传入 now：方便单测，也让「模拟不同日期」变得简单；
 * 2. 动作按名字分组，manifest 里不存在的自动跳过（换 pack / 删动作不会崩）；
 * 3. 权重叠加而不是硬切换：节日/三餐/季节都是「更常见」，不是「只出现」。
 */

export interface BehaviorConfig {
  /** 日常事件间隔（秒），30 ~ 300，默认 40 */
  eventInterval: number
  /** 三餐时间（小时 0-23），默认早 8 / 午 12 / 晚 18 */
  meals: [number, number, number]
}

export const DEFAULT_BEHAVIOR: BehaviorConfig = {
  eventInterval: 40,
  meals: [8, 12, 18],
}

// ────────────────────────────── 时段 / 季节 ──────────────────────────────

export type DayPart = 'night' | 'morning' | 'noon' | 'afternoon' | 'evening'

/** 23:00 - 08:00 算夜里（犯困打盹），6-10 点算早晨（容易打哈欠） */
export function dayPart(now: Date): DayPart {
  const h = now.getHours()
  if (h >= 23 || h < 8) return 'night'
  if (h < 10) return 'morning'
  if (h < 13) return 'noon'
  if (h < 18) return 'afternoon'
  return 'evening'
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export function season(now: Date): Season {
  const m = now.getMonth() + 1
  if (m === 12 || m <= 2) return 'winter'
  if (m <= 5) return 'spring'
  if (m <= 8) return 'summer'
  return 'autumn'
}

// ────────────────────────────── 动作分组 ──────────────────────────────

/** 安静待机：呼吸、哼歌这类「不打扰主人」的动作，轮换着播 */
const QUIET = [
  '待机呼吸休闲',
  '悠闲哼歌',
  '东张西望',
  '超大伸懒腰',
  '照镜子',
  '原地敲击桌面互动',
  '小幅度原地360度旋转展示',
  '轻快记录',
]

/** 夜里犯困：打盹为主，偶尔被自己惊醒 */
const SLEEPY = ['原地小憩沉眠', '午后打盹', '打瞌睡被惊醒', '哈欠连天']

/** 早上容易打哈欠 */
const MORNING = ['哈欠连天', '晨间刷牙', '超大伸懒腰']

/** 23 点后有空会刷一次牙 */
const NIGHT_ROUTINE = ['晨间刷牙']

/** 日常事件池：跳舞、吹泡泡、敲小电脑……（玩耍 + 有意思的小动作） */
const EVENT = [
  '可爱宅舞',
  '优雅女仆舞',
  '轻快摇摆舞',
  '鲸鱼吐泡泡特效',
  '蓝鲸现世',
  '写代码',
  '吹气球',
  '原地专心玩魔方',
  '原地蹲下玩玩具汽车',
  '玩游戏气急败坏',
  '玩水枪',
  '小提琴演奏',
  '吹笛子',
  '三球抛接',
  '踢毽子',
  '荡秋千',
  '下五子棋',
  '撸猫',
  '凭空生花',
  '动物环绕',
  '蝴蝶蜜蜂环绕头顶开花',
  '变鸽子',
  '扑克魔术',
  '抽陀螺',
  '放风筝',
  '骑木马',
  '拆礼物',
  '用鲸鱼尾巴拍打地面',
  '原地跳跃抓碎头顶物品',
  '原地重力下蹲压缩',
  '整体换装试色',
  '偷吃零食被抓住',
  '玩游戏气急败坏',
  '原地左转奔跑',
  '螃蟹走路',
  '被吓一跳',
]

/** 吃什么：三餐与零食 */
const MEAL = [
  '吃早餐',
  '吃午餐',
  '吃晚餐',
  '吃白饭',
  '吃饺子',
  '吃汤圆',
  '吃年糕',
  '吃粽子',
  '吃青团',
  '吃重阳糕',
  '吃腊八粥',
  '吃长寿面',
  '吃大闸蟹',
  '涮火锅',
  '吃糖葫芦',
  '吃冰淇淋',
  '吃西瓜',
  '大口吃零食',
  '吃早餐',
]

/** 季节限定：夏天消暑、秋天落叶、冬天堆雪人、春天花与风筝 */
const SEASONAL: Record<Season, string[]> = {
  spring: ['蝴蝶蜜蜂环绕头顶开花', '放风筝', '凭空生花'],
  summer: ['摇扇纳凉', '吃西瓜', '玩水枪'],
  autumn: ['被落叶淹没', '插茱萸赏菊'],
  winter: ['堆雪人', '装点圣诞树'],
}

// ────────────────────────────── 节日 ──────────────────────────────

interface Holiday {
  id: string
  name: string
  /** 农历节日（春节/元宵/端午/七夕/中秋/重阳/腊八） */
  lunar: boolean
  month: number
  day: number
  /** 节日专属动作 */
  actions: string[]
  /** 节日应景食物 */
  foods: string[]
  /** 提前几天开始密集出现 */
  leadDays: number
}

const HOLIDAYS: Holiday[] = [
  { id: 'spring', name: '春节', lunar: true, month: 1, day: 1, actions: ['写福字', '放烟花', '舞狮头', '放孔明灯', '收红包', '吃年糕'], foods: ['吃饺子', '吃年糕', '吃汤圆'], leadDays: 7 },
  { id: 'lantern', name: '元宵', lunar: true, month: 1, day: 15, actions: ['吃汤圆', '放河灯'], foods: ['吃汤圆'], leadDays: 3 },
  { id: 'valentine', name: '情人节', lunar: false, month: 2, day: 14, actions: ['凭空生花', '拆礼物'], foods: ['吃冰淇淋', '吃糖葫芦'], leadDays: 2 },
  { id: '520', name: '520', lunar: false, month: 5, day: 20, actions: ['凭空生花', '收红包'], foods: ['吃冰淇淋'], leadDays: 2 },
  { id: 'dragon', name: '端午', lunar: true, month: 5, day: 5, actions: ['吃粽子', '放河灯'], foods: ['吃粽子'], leadDays: 3 },
  { id: 'qixi', name: '七夕', lunar: true, month: 7, day: 7, actions: ['穿针乞巧', '放河灯', '凭空生花'], foods: ['吃糖葫芦'], leadDays: 2 },
  { id: 'midautumn', name: '中秋', lunar: true, month: 8, day: 15, actions: ['中秋赏月吃月饼', '放孔明灯'], foods: ['中秋赏月吃月饼'], leadDays: 3 },
  { id: 'chongyang', name: '重阳', lunar: true, month: 9, day: 9, actions: ['插茱萸赏菊', '吃重阳糕'], foods: ['吃重阳糕'], leadDays: 2 },
  { id: 'laba', name: '腊八', lunar: true, month: 12, day: 8, actions: ['吃腊八粥'], foods: ['吃腊八粥'], leadDays: 2 },
  { id: 'halloween', name: '万圣节', lunar: false, month: 10, day: 31, actions: ['讨糖南瓜灯'], foods: ['吃糖葫芦'], leadDays: 3 },
  { id: 'christmas', name: '圣诞', lunar: false, month: 12, day: 25, actions: ['装点圣诞树', '拆礼物'], foods: ['吃冰淇淋'], leadDays: 4 },
]

/** 两个日期相差几天（按自然日算，忽略时分秒） */
function dayDiff(a: Date, b: Date): number {
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((db - da) / 86400000)
}

/** 节日当天的公历日期（农历节日按当年农历换算，闰月由库处理） */
function holidayDate(h: Holiday, year: number): Date | null {
  if (!h.lunar) return new Date(year, h.month - 1, h.day)
  // 农历节日：Lunar.fromYmd 换算成公历（闰月由库内部处理）
  try {
    const lunar = Lunar.fromYmd(year, h.month, h.day)
    const s = lunar.getSolar()
    return new Date(s.getYear(), s.getMonth() - 1, s.getDay())
  } catch {
    return null
  }
}

export interface ActiveHoliday {
  holiday: Holiday
  /** 距离节日还有几天（0 = 当天，负数 = 已过） */
  daysAway: number
  /** 强度 0~1：当天最高，越远越低；过了节日 rapid 衰减 */
  intensity: number
}

/** 当前处于哪个节日的「氛围窗口」里（含前后的 leadDays 天） */
export function activeHoliday(now: Date): ActiveHoliday | null {
  let best: ActiveHoliday | null = null
  const years = [now.getFullYear(), now.getFullYear() + 1]
  for (const h of HOLIDAYS) {
    for (const y of years) {
      const date = holidayDate(h, y)
      if (!date) continue
      const diff = dayDiff(now, date) // 正数 = 还没到
      const window = h.leadDays + 1
      if (diff > window || diff < -1) continue
      // 强度：当天 1；提前 1 天 0.7；提前 2 天 0.45；再往前 0.25；节后一天 0.3
      const intensity =
        diff === 0 ? 1 : diff === -1 ? 0.3 : diff === 1 ? 0.7 : diff === 2 ? 0.45 : 0.25
      if (!best || intensity > best.intensity) best = { holiday: h, daysAway: diff, intensity }
    }
  }
  return best
}

// ────────────────────────────── 选动作 ──────────────────────────────

type Pool = Array<{ name: string; weight: number }>

/** 按名字从 manifest 里筛出真实存在的动作，并去重 */
function collect(manifest: Manifest, names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    if (seen.has(n)) continue
    if (!manifest.animations[n]) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

function push(pool: Pool, names: string[], weight: number): void {
  for (const n of names) pool.push({ name: n, weight })
}

/** 是否在某一餐前后一小时 */
function nearMeal(now: Date, meals: [number, number, number]): boolean {
  const h = now.getHours() + now.getMinutes() / 60
  return meals.some((m) => Math.abs(h - m) <= 1)
}

/** 当前最接近哪一餐（0 早 / 1 午 / 2 晚）；不在饭点附近返回 -1 */
function nearestMeal(now: Date, meals: [number, number, number]): number {
  const h = now.getHours() + now.getMinutes() / 60
  let best = -1
  let bestD = 1.01
  meals.forEach((m, i) => {
    const d = Math.abs(h - m)
    if (d <= 1 && d < bestD) {
      best = i
      bestD = d
    }
  })
  return best
}

/** 三餐对应动作：饭点时对应那一餐权重更高，其他时段也说得出「现在能吃什么」 */
const MEAL_BY_INDEX = [
  ['吃早餐', '晨间刷牙', '吃年糕'],
  ['吃午餐', '吃白饭', '涮火锅'],
  ['吃晚餐', '吃晚餐', '涮火锅'],
]

/**
 * 生成「安静待机」候选池。
 */
export function quietPool(manifest: Manifest, now: Date): Pool {
  const part = dayPart(now)
  const pool: Pool = []
  if (part === 'night') {
    push(pool, collect(manifest, SLEEPY), 5)
    push(pool, collect(manifest, QUIET), 1)
    // 23 点后有空会刷一次牙
    if (now.getHours() === 23) push(pool, collect(manifest, NIGHT_ROUTINE), 2)
  } else if (part === 'morning') {
    push(pool, collect(manifest, MORNING), 3)
    push(pool, collect(manifest, QUIET), 2)
  } else {
    push(pool, collect(manifest, QUIET), 1)
  }
  return pool
}

/**
 * 生成「日常事件」候选池，按时间/三餐/节日/季节加权。
 */
export function eventPool(
  manifest: Manifest,
  now: Date,
  config: BehaviorConfig,
): { pool: Pool; holiday: ActiveHoliday | null; inMeal: boolean } {
  const pool: Pool = []
  const part = dayPart(now)
  const h = activeHoliday(now)
  const inMeal = nearMeal(now, config.meals)

  // 基础日常：夜里压得很低（该睡了），白天正常
  push(pool, collect(manifest, EVENT), part === 'night' ? 3 : 10)

  // 夜里：睡眠类动作用力加权，深夜还在跳舞不合适
  if (part === 'night') push(pool, collect(manifest, SLEEPY), 14)

  // 季节：冬天堆雪人、秋天落叶，存在感要够（高于普通日常）
  push(pool, collect(manifest, SEASONAL[season(now)]), part === 'night' ? 3 : 12)

  // 三餐前后一小时：食物整体加权，当前那一餐的动作再高一档
  if (inMeal) {
    push(pool, collect(manifest, MEAL), part === 'night' ? 5 : 11)
    const idx = nearestMeal(now, config.meals)
    if (idx >= 0) push(pool, collect(manifest, MEAL_BY_INDEX[idx]), 9)
  }

  // 节日：专属动作 + 应景食物，按强度加权
  if (h) {
    const w = Math.round(6 + h.intensity * 22)
    push(pool, collect(manifest, h.holiday.actions), w)
    if (inMeal) push(pool, collect(manifest, h.holiday.foods), 18)
  }

  return { pool, holiday: h, inMeal }
}

/** 按权重抽一个 */
export function pickWeighted(pool: Pool, rnd: () => number = Math.random): string | null {
  const total = pool.reduce((s, p) => s + Math.max(0, p.weight), 0)
  if (total <= 0) return null
  let r = rnd() * total
  for (const p of pool) {
    r -= Math.max(0, p.weight)
    if (r <= 0) return p.name
  }
  return pool[pool.length - 1]?.name ?? null
}

export interface BehaviorState {
  /** 上一次「日常事件」的时间戳（ms） */
  lastEventAt: number
}

export interface BehaviorPick {
  pick: PickResult
  /** 这次是「日常事件」还是「安静待机」 */
  isEvent: boolean
  /** 命中的节日（仅事件时可能非空） */
  holidayName?: string
}

/**
 * 决定下一个自动动作。
 *
 * 节奏：
 * - 距上次事件超过 eventInterval → 抽一个「日常事件」，并刷新 lastEventAt
 * - 否则 → 抽一个「安静待机」，让呼吸/哼歌这样的动作轮换
 */
export function nextByBehavior(
  manifest: Manifest,
  last: string | null,
  state: BehaviorState,
  now: Date,
  config: BehaviorConfig,
  rnd: () => number = Math.random,
): BehaviorPick | null {
  const due = Date.now() - state.lastEventAt >= config.eventInterval * 1000

  const choose = (pool: Pool): string | null => {
    // 避免连续重复：最多重抽 4 次
    for (let i = 0; i < 4; i++) {
      const name = pickWeighted(pool, rnd)
      if (!name) return null
      if (name !== last) return name
    }
    return pickWeighted(pool, rnd)
  }

  if (due) {
    const ev = eventPool(manifest, now, config)
    const name = choose(ev.pool)
    if (name) {
      return { pick: { name, kind: 'idle' }, isEvent: true, holidayName: ev.holiday?.holiday.name }
    }
    // 事件池空了就退回安静池
  }

  const name = choose(quietPool(manifest, now))
  if (!name) return null
  return { pick: { name, kind: 'idle' }, isEvent: false }
}

// ────────────────────────────── 点击回应（带稀有度）──────────────────────────────

/**
 * 点击回应：常见动作权重高，稀有的要「多点几次才遇到」。
 * manifest 里没有的自动跳过。
 */
const CLICK_WEIGHTS: Array<[string, number]> = [
  ['点击回应-元气挥手', 32],
  ['点击回应-开心跃动', 26],
  ['点击回应-害羞惊讶', 18],
  ['点击回应-傲娇生气', 13],
  ['点击回应-挠痒咯咯笑', 7],
  ['被吓一跳', 3],
  ['原地跳跃抓碎头顶物品', 1],
]

export function pickClickWeighted(
  manifest: Manifest,
  last: string | null,
  rnd: () => number = Math.random,
): string | null {
  const pool: Pool = CLICK_WEIGHTS.filter(([n]) => !!manifest.animations[n]).map(([name, weight]) => ({
    name,
    weight,
  }))
  // 兜底：manifest 的 clicks 池里有、但权重表没覆盖的，给 5 的默认权重
  for (const n of manifest.pools.clicks ?? []) {
    if (!pool.some((p) => p.name === n) && manifest.animations[n]) pool.push({ name: n, weight: 5 })
  }
  for (let i = 0; i < 4; i++) {
    const name = pickWeighted(pool, rnd)
    if (name && name !== last) return name
    if (name) return name
  }
  return null
}

/** 给外部展示：当前节日名 / 季节名（面板上可以显示「今天想吃粽子」之类） */
export function describeMoment(now: Date): { part: string; season: string; holiday: string | null } {
  const partText: Record<DayPart, string> = {
    night: '深夜',
    morning: '清晨',
    noon: '中午',
    afternoon: '下午',
    evening: '傍晚',
  }
  const seasonText: Record<Season, string> = {
    spring: '春',
    summer: '夏',
    autumn: '秋',
    winter: '冬',
  }
  const h = activeHoliday(now)
  return { part: partText[dayPart(now)], season: seasonText[season(now)], holiday: h?.holiday.name ?? null }
}
