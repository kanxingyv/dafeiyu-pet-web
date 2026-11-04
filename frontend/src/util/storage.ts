/**
 * localStorage 的安全封装。
 *
 * 为什么要包：这个页面要当桌面壁纸跑，Wallpaper Engine 用 `wp://` 自定义协议
 * 加载本地文件，Chromium 可能把它当成「不透明源」，直接访问 localStorage 会抛
 * SecurityError。之前 App.tsx 里裸调 `localStorage.getItem`，一旦抛错就掉进
 * Promise 的 catch → setError → 整页「场景加载失败」。
 *
 * 策略：写入同时存一份到内存，读写失败就退回内存 —— 本次会话内行为不变，
 * 只是下次打开记不住。
 */

const mem = new Map<string, string>()

export function readLS(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return mem.get(key) ?? null
  }
}

export function writeLS(key: string, value: string): void {
  mem.set(key, value)
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* 无痕模式 / wp:// / 存储配额满 —— 本次会话内还能用，记不住就算了 */
  }
}
