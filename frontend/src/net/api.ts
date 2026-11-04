/** 与后端通信的极薄封装：出错不抛，返回 {ok, data}，页面不会因为接口挂了白屏 */

export interface ServerEvent {
  type: 'act' | 'say' | 'state' | 'poke' | 'reload'
  name?: string
  facing?: 'left' | 'right'
  content?: { text: string; image?: string; holdMs?: number; voice?: string }
  mode?: 'idle' | 'work' | 'sleep'
  workIndex?: number
}

export async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** 开发/调试用：不带 token 也能调（后端按配置决定是否校验） */
export async function postEvent(ev: ServerEvent, token?: string): Promise<boolean> {
  try {
    const qs = token ? `?k=${encodeURIComponent(token)}` : ''
    const res = await fetch(`/api/event${qs}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ev),
    })
    return res.ok
  } catch {
    return false
  }
}
