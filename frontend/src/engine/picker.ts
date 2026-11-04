import type { Manifest, PickResult } from './types'

/**
 * 选片：按 dsh-pet 的权重口径抽下一个动作。
 *
 * 口径（来自 config.jsonc 的 animationWeights + categories[].weight）：
 *   顶层 = idle 10 / turn 5 / move 5 / 随机分类 80（余量）
 *   抽到「随机分类」后再按各分类 weight 二次抽签，分类内等概率。
 *
 * 设计成纯函数：不碰 DOM、不碰配置对象本身，方便单测与以后换权重来源。
 */

/** 避免连续重复：连续抽到同一个动作时最多重抽几次 */
const MAX_RETRY = 6

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0)
}

/** 按权重抽一个下标；权重全 0 或非法时返回 -1 */
export function weightedIndex(weights: number[], rnd: () => number = Math.random): number {
  const total = sum(weights.filter((w) => Number.isFinite(w) && w > 0))
  if (total <= 0) return -1
  let r = rnd() * total
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]
    if (!Number.isFinite(w) || w <= 0) continue
    r -= w
    if (r <= 0) return i
  }
  // 浮点误差兜底：取最后一个有效项
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i
  return -1
}

function pickOne<T>(arr: T[], rnd: () => number): T | undefined {
  if (arr.length === 0) return undefined
  return arr[Math.floor(rnd() * arr.length) % arr.length]
}

/** 把 moves.actions 里的参数与 default 合并 */
function moveDist(
  m: Manifest,
  name: string,
  rnd: () => number,
): number {
  const def = m.pools.moves?.default ?? {}
  const act = (m.pools.moves?.actions ?? []).find((a) => a.name === name)
  const min = act?.params?.minDist ?? def.minDist ?? 60
  const max = act?.params?.maxDist ?? def.maxDist ?? 240
  return Math.round(min + rnd() * Math.max(0, max - min))
}

/**
 * 抽下一个动作。
 * @param last 上一个播的动作名，用于避免立刻重复
 */
export function pickNext(m: Manifest, last: string | null, rnd: () => number = Math.random): PickResult | null {
  const { idle, turn, move } = m.weights
  const cats = m.pools.categories ?? []
  const catTotal = sum(cats.map((c) => c.weight))

  // 顶层签筒：idle / turn / move / 随机分类（余量）
  const slots: Array<'idle' | 'turn' | 'move' | 'category'> = ['idle', 'turn', 'move', 'category']
  const slotWeights = [idle, turn, move, catTotal]

  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const i = weightedIndex(slotWeights, rnd)
    if (i < 0) return null
    const kind = slots[i]

    if (kind === 'idle') {
      const name = pickOne(m.pools.idle ?? [], rnd)
      if (name && name !== last) return { name, kind: 'idle' }
      if (name) return { name, kind: 'idle' } // 只有一段待机时允许重复
      continue
    }

    if (kind === 'turn') {
      const name = pickOne(m.pools.turn ?? [], rnd)
      if (name && name !== last) return { name, kind: 'turn' }
      continue
    }

    if (kind === 'move') {
      const acts = (m.pools.moves?.actions ?? []).map((a) => a.name)
      const name = pickOne(acts, rnd)
      if (name && name !== last) return { name, kind: 'move', dist: moveDist(m, name, rnd) }
      continue
    }

    // 随机分类：先抽分类，再抽分类内的动作
    const ci = weightedIndex(cats.map((c) => c.weight), rnd)
    if (ci < 0) continue
    const cat = cats[ci]
    const name = pickOne(cat.actions, rnd)
    if (!name) continue
    if (name === last) continue
    return { name, kind: 'category', categoryId: cat.id }
  }

  // 兜底：给第一段待机，宁可重复也别停住
  const fallback = (m.pools.idle ?? [])[0]
  return fallback ? { name: fallback, kind: 'idle' } : null
}

/** 从点击回应池里抽一个（点宠物时用），尽量不重复 */
export function pickClick(m: Manifest, last: string | null, rnd: () => number = Math.random): string | null {
  const pool = (m.pools.clicks ?? []).filter((n) => n !== last)
  const use = pool.length > 0 ? pool : m.pools.clicks ?? []
  return pickOne(use, rnd) ?? null
}

/** 按工作状态档位取动画（阶段 5 接 QQ 机器人状态用） */
export function pickWorkStatus(m: Manifest, index: number, rnd: () => number = Math.random): string | null {
  const slots = m.pools.events?.workStatus
  if (!Array.isArray(slots) || slots.length === 0) return null
  const slot = slots[Math.min(Math.max(index, 0), slots.length - 1)]
  if (typeof slot === 'string') return slot || null
  if (Array.isArray(slot)) return pickOne(slot.filter((s): s is string => typeof s === 'string'), rnd) ?? null
  return null
}
