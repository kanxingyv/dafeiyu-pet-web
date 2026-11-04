import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Manifest, SceneInfo } from '../engine/types'
import type { BehaviorConfig } from '../engine/behavior'
import { scheduleText, type DayMode, type DayPhase } from '../scene/daylight'
import { memeUrl } from '../engine/memes'
import type { Weather } from '../weather/rain'

/**
 * 动作选择器：右侧抽屉，按分类列出全部动作 + 表情包。
 *
 * 入口是右上角那个 ≡ 圆点，但圆点**平时是隐形的** —— 桌面壁纸一整天挂在那儿，
 * 常驻一个白圆点太碍眼。规则：点一下屏幕任意处，控件浮现 4.5 秒；
 * 面板打开期间一直可见；关掉之后再安静地藏起来。
 */
interface Props {
  manifest: Manifest
  scenes: SceneInfo[]
  sceneId: string
  onSceneChange: (id: string) => void
  onAct: (name: string) => void
  onSay: (text: string, image?: string) => void
  /** 光线：auto 跟着现实时间，day/night 手动锁死 */
  dayMode: DayMode
  phase: DayPhase
  onDayModeChange: (mode: DayMode) => void
  weather: Weather
  onWeatherChange: (w: Weather) => void
  /** 行为节奏：事件间隔 + 三餐时间 */
  behavior: BehaviorConfig
  onBehaviorChange: (cfg: BehaviorConfig) => void
}

/** 控件浮现后停留多久（毫秒） */
const HOLD_MS = 4500

export function ActionPanel({
  manifest,
  scenes,
  sceneId,
  onSceneChange,
  onAct,
  onSay,
  dayMode,
  phase,
  onDayModeChange,
  weather,
  onWeatherChange,
  behavior,
  onBehaviorChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const [awake, setAwake] = useState(true)
  const holdTimer = useRef<number | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  /** 定时器回调里要读最新的 open，不能靠闭包捕获 */
  const openRef = useRef(open)
  openRef.current = open

  const wake = useCallback((holdMs: number) => {
    setAwake(true)
    if (holdTimer.current !== null) clearTimeout(holdTimer.current)
    holdTimer.current = window.setTimeout(() => {
      if (!openRef.current) setAwake(false)
    }, holdMs)
  }, [])

  // 首屏露一下（让人知道右上角有东西），之后点屏幕才回来
  useEffect(() => {
    wake(HOLD_MS)
    const onDown = (e: PointerEvent) => {
      wake(HOLD_MS)
      // 点面板和 ≡ 以外的地方 = 关掉面板，跟抽屉一个手感
      if (!openRef.current) return
      const t = e.target as Node | null
      if (!t) return
      if (panelRef.current?.contains(t) || toggleRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      if (holdTimer.current !== null) clearTimeout(holdTimer.current)
    }
  }, [wake])

  // 面板关掉之后，重新开始倒计时，别让它一直杵着
  useEffect(() => {
    if (!open) wake(HOLD_MS)
  }, [open, wake])

  const [tab, setTab] = useState<'act' | 'meme' | 'scene'>('act')
  const [q, setQ] = useState('')

  const groups = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const [name, meta] of Object.entries(manifest.animations)) {
      const key = meta.category || '其他'
      const arr = map.get(key) ?? []
      arr.push(name)
      map.set(key, arr)
    }
    // 事件类（余额/碎碎念/工作状态）排后面，日常动作排前面；「编排」是她最特别的那几段，置顶
    const order = ['编排', 'idle', 'turn', 'clicks', 'move', '小动作', '玩耍', '吃什么', '时节', '文字']
    return [...map.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0])
      const ib = order.indexOf(b[0])
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
  }, [manifest])

  const memes = useMemo(() => Object.keys(manifest.memes), [manifest])

  // 关键词：动作按「名字 / 分类」匹配，表情按「名字 / 用途描述」匹配
  const query = q.trim().toLowerCase()
  const filteredGroups = useMemo(() => {
    if (!query) return groups
    return groups
      .map(([cat, names]): [string, string[]] => [
        cat,
        names.filter((n) => n.toLowerCase().includes(query) || cat.toLowerCase().includes(query)),
      ])
      .filter(([, names]) => names.length > 0)
  }, [groups, query])

  const filteredMemes = useMemo(() => {
    if (!query) return memes
    return memes.filter(
      (m) =>
        m.toLowerCase().includes(query) || (manifest.memes[m] ?? '').toLowerCase().includes(query),
    )
  }, [memes, manifest, query])

  const keyword = q.trim()

  return (
    <>
      <button
        ref={toggleRef}
        className={`panel-toggle${awake || open ? ' awake' : ''}`}
        onClick={() => {
          setOpen((v) => !v)
          wake(HOLD_MS)
        }}
        aria-label="动作选择器"
      >
        {open ? '×' : '≡'}
      </button>

      {open && (
        <div className="panel" ref={panelRef}>
          <div className="panel-tabs">
            <button className={tab === 'act' ? 'on' : ''} onClick={() => setTab('act')}>
              动作 {Object.keys(manifest.animations).length}
            </button>
            <button className={tab === 'meme' ? 'on' : ''} onClick={() => setTab('meme')}>
              表情 {memes.length}
            </button>
            <button className={tab === 'scene' ? 'on' : ''} onClick={() => setTab('scene')}>
              房间
            </button>
          </div>

          {tab !== 'scene' && (
            <div className="panel-search">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={tab === 'act' ? '搜动作，比如「奔跑」' : '搜表情，比如「生气」'}
                aria-label={tab === 'act' ? '搜索动作' : '搜索表情'}
                enterKeyHint="search"
                spellCheck={false}
                autoComplete="off"
              />
              {q && (
                <button className="panel-search-clear" onClick={() => setQ('')} aria-label="清空搜索">
                  ×
                </button>
              )}
            </div>
          )}

          <div className="panel-body">
            {tab === 'scene' && (
              <>
                {/*
                  光线：白天的房间图和夜晚的夜景图是两套素材（同一构图，只换光照）。
                  「自动」按本机时间切，6:30 天亮、18:30 天黑；手动选了就一直锁着，
                  下次打开还记得。
                */}
                <div className="light-row">
                  <div className="light-head">
                    <span>光线</span>
                    <em>{phase === 'night' ? '夜晚' : '白天'}</em>
                  </div>
                  <div className="seg">
                    {(
                      [
                        ['auto', '自动'],
                        ['day', '白天'],
                        ['night', '夜晚'],
                      ] as const
                    ).map(([m, label]) => (
                      <button
                        key={m}
                        className={dayMode === m ? 'on' : ''}
                        onClick={() => onDayModeChange(m)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="light-hint">
                    {dayMode === 'auto' ? scheduleText() : '已手动锁定，不会随时间变'}
                  </p>
                </div>

                <div className="light-row">
                  <div className="light-head">
                    <span>天气</span>
                    <em>{weather === 'rain' ? '下雨' : weather === 'snow' ? '下雪' : '晴'}</em>
                  </div>
                  <div className="seg">
                    {(
                      [
                        ['clear', '晴'],
                        ['rain', '雨'],
                        ['snow', '雪'],
                      ] as const
                    ).map(([w, label]) => (
                      <button
                        key={w}
                        className={weather === w ? 'on' : ''}
                        onClick={() => onWeatherChange(w)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="light-hint">
                    {weather === 'rain'
                      ? '雨只下在窗外和玻璃上，屋里不会淋到'
                      : weather === 'snow'
                        ? '雪只落在窗外和院子里'
                        : '切到「雨」或「雪」看窗外'}
                  </p>
                </div>

                {/*
                  节奏：她多久做一件「日常小事」（跳舞、吹泡泡、敲小电脑……）。
                  待机时是安静动作（呼吸、哼歌）轮换，到这个间隔才插一件大事。
                */}
                <div className="light-row">
                  <div className="light-head">
                    <span>节奏</span>
                    <em>{behavior.eventInterval} 秒一件小事</em>
                  </div>
                  <input
                    className="range"
                    type="range"
                    min={30}
                    max={300}
                    step={10}
                    value={behavior.eventInterval}
                    onChange={(e) =>
                      onBehaviorChange({ ...behavior, eventInterval: Number(e.target.value) })
                    }
                    aria-label="日常事件间隔"
                  />
                  <p className="light-hint">
                    {behavior.eventInterval <= 60
                      ? '比较活泼，几乎每分钟都有新花样'
                      : behavior.eventInterval >= 180
                        ? '很安静，偶尔才热闹一下'
                        : '张弛适中'}
                  </p>
                </div>

                {/* 三餐：饭点前后一小时，她会更常端出吃的 */}
                <div className="light-row">
                  <div className="light-head">
                    <span>三餐</span>
                    <em>
                      {behavior.meals.join(' / ')} 点
                    </em>
                  </div>
                  <div className="meal-inputs">
                    {(['早', '午', '晚'] as const).map((label, i) => (
                      <label key={label}>
                        <span>{label}</span>
                        <input
                          type="number"
                          min={0}
                          max={23}
                          value={behavior.meals[i]}
                          onChange={(e) => {
                            const v = Math.max(0, Math.min(23, Number(e.target.value) || 0))
                            const next: [number, number, number] = [...behavior.meals] as [
                              number,
                              number,
                              number,
                            ]
                            next[i] = v
                            onBehaviorChange({ ...behavior, meals: next })
                          }}
                          aria-label={`${label}餐时间`}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="light-hint">饭点前后一小时更常端出美食</p>
                </div>

                <div className="scene-list">
                  {scenes.map((s) => (
                    <button
                      key={s.id}
                      className={`scene-item${s.id === sceneId ? ' on' : ''}`}
                      onClick={() => {
                        onSceneChange(s.id)
                        setOpen(false)
                      }}
                    >
                      <img
                        src={`./assets/bg/${phase === 'night' && s.nightImage ? s.nightImage : s.image}`}
                        alt={s.name}
                        loading="lazy"
                      />
                      <span>{s.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {tab === 'act' && (
              <>
                {filteredGroups.map(([cat, names]) => (
                  <section key={cat}>
                    <h4>
                      {cat}
                      {query && ` ${names.length}`}
                    </h4>
                    <div className="chips">
                      {names.map((n) => (
                        <button
                          key={n}
                          onClick={() => {
                            onAct(n)
                            setOpen(false) // 点完就收起，别挡着看她
                          }}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                {filteredGroups.length === 0 && (
                  <p className="panel-empty">
                    没找到和 <em>「{keyword}」</em> 有关的动作
                  </p>
                )}
              </>
            )}
            {tab === 'meme' && (
              <>
                {filteredMemes.map((m) => (
                  <button
                    key={m}
                    className="meme"
                    onClick={() => {
                      // 只发图，不配文字 —— 表情包本身就是一句"话"
                      onSay('', m)
                      setOpen(false)
                    }}
                    title={manifest.memes[m]}
                  >
                    <img src={memeUrl(m)} alt={m} loading="lazy" />
                    <span>{m}</span>
                  </button>
                ))}
                {filteredMemes.length === 0 && (
                  <p className="panel-empty">
                    没找到和 <em>「{keyword}」</em> 有关的表情
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
