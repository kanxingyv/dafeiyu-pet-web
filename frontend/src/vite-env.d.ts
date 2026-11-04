/// <reference types="vite/client" />

/** 构建时由 vite.config.ts 注入：构建时间（版本水印） */
declare const __BUILD_STAMP__: string

/** 农历库（无官方类型声明，这里给最小可用声明） */
declare module 'lunar-javascript' {
  export interface LunarDate {
    getYear(): number
    getMonth(): number
    getDay(): number
    getMonthInChinese(): string
    getDayInChinese(): string
    getSolar(): { getYear(): number; getMonth(): number; getDay(): number }
  }
  export const Solar: {
    fromYmd(y: number, m: number, d: number): LunarDate & { getLunar(): LunarDate }
    fromDate(d: Date): LunarDate & { getLunar(): LunarDate }
  }
  export const Lunar: {
    fromYmd(y: number, m: number, d: number): LunarDate
    fromDate(d: Date): LunarDate
  }
}
