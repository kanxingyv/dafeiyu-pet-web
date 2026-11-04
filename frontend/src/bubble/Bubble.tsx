import { useEffect, useRef, useState } from 'react'
import type { BubbleContent } from '../engine/types'
import { memeUrl } from '../engine/memes'

/** 打字机速度（毫秒/字）—— 中文按字推进，接近动画里说话的感觉 */
const TYPE_MS = 46

interface Props {
  content: BubbleContent
  onDismiss: () => void
}

/**
 * 头顶文字框：逐字显示 → 停留 → 淡出。
 * 停留时长按字数估（说的越多停越久），也可以用 holdMs 强制指定。
 */
export function Bubble({ content, onDismiss }: Props) {
  const [shown, setShown] = useState(0)
  const [out, setOut] = useState(false)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  const text = content.text ?? ''
  const typeMs = text.length * TYPE_MS

  useEffect(() => {
    setShown(0)
    setOut(false)
    if (!text) return
    let i = 0
    const timer = setInterval(() => {
      i += 1
      setShown(i)
      if (i >= text.length) clearInterval(timer)
    }, TYPE_MS)
    return () => clearInterval(timer)
  }, [text, content])

  useEffect(() => {
    const hold = content.holdMs ?? Math.max(1700, text.length * 135)
    const t1 = setTimeout(() => setOut(true), typeMs + hold)
    const t2 = setTimeout(() => dismissRef.current(), typeMs + hold + 240)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [text, content, typeMs])

  const typing = shown < text.length

  return (
    <div className={`bubble-wrap${out ? ' out' : ''}`}>
      <div className="bubble">
        <span className="bubble-text">{text.slice(0, shown)}</span>
        {typing && <span className="caret">▍</span>}
        {content.voice && (
          <div className="wave" aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </div>
        )}
        {content.image && (
          <img
            className={`bubble-img${text ? '' : ' solo'}`}
            src={memeUrl(content.image)}
            alt={content.image}
            draggable={false}
          />
        )}
      </div>
    </div>
  )
}
