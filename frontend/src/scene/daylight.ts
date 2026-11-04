/**
 * 昼夜：白天 / 黑夜。
 *
 * 为什么按「当前时间」算而不是靠定时器累加：
 * 这个页面会当壁纸连开好几天，中间电脑休眠、锁屏、显示器关掉都会让
 * setTimeout/setInterval 停摆或漂移。每次都对一次系统时钟，永远不会错。
 */

export type DayPhase = 'day' | 'night'
/** auto = 跟随现实时间；day / night = 手动锁死 */
export type DayMode = 'auto' | 'day' | 'night'

/** 几点算天亮 / 天黑（本地时间，允许小数：6.5 = 06:30） */
export const SUNRISE = 6.5
export const SUNSET = 18.5

/** 这一刻算白天还是黑夜 */
export function phaseAt(date: Date, sunrise = SUNRISE, sunset = SUNSET): DayPhase {
  const h = date.getHours() + date.getMinutes() / 60
  return h >= sunrise && h < sunset ? 'day' : 'night'
}

/** 把「模式」解析成当前应该显示的画面 */
export function resolvePhase(mode: DayMode, date = new Date()): DayPhase {
  if (mode === 'day' || mode === 'night') return mode
  return phaseAt(date)
}

/** 距离下一次由时间触发的切换还有多久（毫秒）—— 用来决定多久对一次表 */
export function msToNextFlip(date: Date, sunrise = SUNRISE, sunset = SUNSET): number {
  const h = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
  const next = h < sunrise ? sunrise : h < sunset ? sunset : sunrise + 24
  return Math.max(1_000, (next - h) * 3600_000)
}

/** 「几点天亮 / 几点天黑」的人话描述，给面板提示用 */
export function scheduleText(sunrise = SUNRISE, sunset = SUNSET): string {
  const fmt = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`
  return `${fmt(sunrise)} 天亮 · ${fmt(sunset)} 天黑`
}
