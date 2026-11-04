import type { ServerEvent } from './api'

/**
 * WebSocket 客户端：断线自动重连（指数退避，最长 15s）。
 *
 * 为什么要 WS：手机和电脑同时开着时，任何一端（或后端脚本）发指令，
 * 所有端要看到同一只鱼做同一个动作。轮询做不到「立刻」且费电。
 */
export function connectWS(onEvent: (ev: ServerEvent) => void): { close: () => void } {
  // 壁纸 / 本地文件模式下没有后端：协议是 wp: 或 file:，host 为空。
  // 这种环境直接不连 —— 否则无效地址会走进无限重连，console 每十几秒报一次错。
  const online = location.protocol === 'http:' || location.protocol === 'https:'
  if (!online) {
    return { close: () => {} }
  }

  let ws: WebSocket | null = null
  let closed = false
  let retry = 0
  let timer: number | undefined

  const url = () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}/ws`
  }

  const open = () => {
    if (closed) return
    try {
      ws = new WebSocket(url())
    } catch {
      schedule()
      return
    }
    ws.onopen = () => {
      retry = 0
    }
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as ServerEvent
        if (data && typeof data.type === 'string') onEvent(data)
      } catch {
        /* 后端偶尔发心跳/非 JSON，忽略 */
      }
    }
    ws.onclose = () => {
      if (!closed) schedule()
    }
    ws.onerror = () => {
      ws?.close()
    }
  }

  const schedule = () => {
    if (closed) return
    const delay = Math.min(15_000, 800 * 2 ** retry)
    retry += 1
    timer = window.setTimeout(open, delay)
  }

  open()

  return {
    close: () => {
      closed = true
      if (timer) window.clearTimeout(timer)
      ws?.close()
    },
  }
}
