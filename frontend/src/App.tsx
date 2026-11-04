import { useCallback, useEffect, useRef, useState } from 'react'
import type { PetEngine } from './engine/engine'
import type { Manifest, SceneExit, SceneInfo, ScenesFile } from './engine/types'
import { PetStage } from './pet/PetStage'
import { connectWS } from './net/ws'
import type { ServerEvent } from './net/api'
import { ActionPanel } from './ui/ActionPanel'
import { readLS, writeLS } from './util/storage'
import { resolvePhase, type DayMode, type DayPhase } from './scene/daylight'
import { preloadFile, preloadScene, visibleBgFile } from './scene/preload'
import type { Weather } from './weather/rain'
import { DEFAULT_BEHAVIOR, type BehaviorConfig } from './engine/behavior'
import { setMemeFiles } from './engine/memes'

const SCENE_KEY = 'dfy.scene'
const BEHAVIOR_KEY = 'dfy.behavior'
const LIGHT_KEY = 'dfy.daylight'
const WEATHER_KEY = 'dfy.weather'

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [scenes, setScenes] = useState<ScenesFile | null>(null)
  const [sceneId, setSceneId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nearExits, setNearExits] = useState<SceneExit[]>([])
  const engineRef = useRef<PetEngine | null>(null)
  /** 切房间的过场遮罩：先盖住、换完图再撤 */
  const [sceneFade, setSceneFade] = useState(false)
  /** 遮罩上的目标房间名（「正在前往 卧室…」） */
  const [sceneFadeTo, setSceneFadeTo] = useState<string | null>(null)
  /** 防止连点两下切两次（第一次还没换完就再来一次会打架） */
  const switchingRef = useRef(false)

  /** auto = 跟着现实时间走，day / night = 手动锁死 */
  const [dayMode, setDayMode] = useState<DayMode>(() => {
    const saved = readLS(LIGHT_KEY)
    return saved === 'day' || saved === 'night' ? saved : 'auto'
  })
  const [phase, setPhase] = useState<DayPhase>(() => resolvePhase(dayMode))

  /**
   * 行为节奏：日常事件间隔（30~300 秒）+ 三餐时间。
   * 存在 localStorage，下次打开还记得；面板改完立即生效。
   */
  const [behavior, setBehavior] = useState<BehaviorConfig>(() => {
    try {
      const raw = readLS(BEHAVIOR_KEY)
      if (raw) {
        const p = JSON.parse(raw) as Partial<BehaviorConfig>
        const interval = Math.max(30, Math.min(300, Number(p.eventInterval) || 40))
        const meals =
          Array.isArray(p.meals) && p.meals.length === 3 && p.meals.every((n) => Number.isFinite(n))
            ? (p.meals as [number, number, number])
            : DEFAULT_BEHAVIOR.meals
        return { eventInterval: interval, meals }
      }
    } catch {
      /* 解析失败就用默认值 */
    }
    return { ...DEFAULT_BEHAVIOR }
  })

  /** 行为配置变化：存盘 + 立即推给引擎 */
  useEffect(() => {
    writeLS(BEHAVIOR_KEY, JSON.stringify(behavior))
    engineRef.current?.setBehavior(behavior)
  }, [behavior])

  /** 天气：暂不接真实气象，晴/雨/雪手动切（壁纸断网也不会失灵） */
  const [weather, setWeather] = useState<Weather>(() => {
    const saved = readLS(WEATHER_KEY)
    return saved === 'rain' || saved === 'snow' ? saved : 'clear'
  })

  useEffect(() => {
    let alive = true
    Promise.all([
      fetch('./assets/manifest.json').then((r) => {
        if (!r.ok) throw new Error(`manifest ${r.status}`)
        return r.json() as Promise<Manifest>
      }),
      fetch('./assets/bg/scenes.json').then((r) => {
        if (!r.ok) throw new Error(`scenes ${r.status}`)
        return r.json() as Promise<ScenesFile>
      }),
    ])
      .then(([m, s]) => {
        if (!alive) return
        // 表情包文件名（m001.png…）在这里注册，气泡与面板都靠它拼地址
        setMemeFiles(m.memeFiles)
        setManifest(m)
        setScenes(s)
        // 记住上次待的房间（壁纸模式下 localStorage 可能不可用，readLS 会兜住）
        const saved = readLS(SCENE_KEY)
        const valid = s.scenes.some((x) => x.id === saved)
        setSceneId(valid && saved ? saved : s.default)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [])

  /*
   * 每分钟对一次系统时钟。
   * 不用「算好下一次切换的精确毫秒再 setTimeout」：壁纸会连开几天，
   * 中间休眠、锁屏、显示器断电都会让计时器停摆或漂移。每分钟重算一次，
   * 醒来最多晚 60 秒，但永远不会错到「大中午还黑着灯」。
   */
  useEffect(() => {
    const tick = () => setPhase(resolvePhase(dayMode))
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [dayMode])

  const changeDayMode = useCallback((m: DayMode) => {
    setDayMode(m)
    writeLS(LIGHT_KEY, m)
    setPhase(resolvePhase(m))
  }, [])

  const changeWeather = useCallback((w: Weather) => {
    setWeather(w)
    writeLS(WEATHER_KEY, w)
  }, [])

  // 后端推来的指令：任何端都能让她做动作 / 说话
  useEffect(() => {
    if (!manifest) return
    const conn = connectWS((ev: ServerEvent) => {
      const engine = engineRef.current
      if (!engine) return
      switch (ev.type) {
        case 'act':
          if (ev.name) void engine.act(ev.name, { facing: ev.facing })
          break
        case 'say':
          if (ev.content) engine.say(ev.content)
          break
        case 'state':
          if (ev.mode) engine.setMode(ev.mode, { workIndex: ev.workIndex })
          break
        case 'poke':
          engine.poke()
          break
        case 'reload':
          location.reload()
          break
      }
    })
    return () => conn.close()
  }, [manifest])

  if (error) {
    return (
      <div className="stage">
        <div className="loading">场景加载失败：{error}</div>
      </div>
    )
  }

  const scene: SceneInfo | null =
    scenes?.scenes.find((s) => s.id === sceneId) ?? scenes?.scenes[0] ?? null

  /**
   * 切房间：先盖遮罩 → 等目标房间四张图解码完 → 换图 → 等两帧首帧绘制 → 撤遮罩。
   *
   * 顺序不能反：先换图再盖遮罩，用户会先看到白帧；而等 decode 完才盖，
   * 遮罩淡入的那 170ms 里图还没好，一样是空白。所以是「先盖，再等，再换」。
   */
  const switchScene = useCallback(
    async (id: string) => {
      if (switchingRef.current || id === sceneId) return
      const target = scenes?.scenes.find((s) => s.id === id)
      if (!target) return
      switchingRef.current = true
      setNearExits([])
      setSceneFadeTo(target.name)
      setSceneFade(true)
      try {
        await Promise.all([
          // 只等「这张房间此刻真正显示的那一张」——等四张会让遮罩白盖几百毫秒
          preloadFile(visibleBgFile(target, phase, weather)),
          /*
           * 遮罩最短停留 600ms：门口已经预加载过，真正等图往往 <50ms，
           * 170ms 时遮罩闪一下就没了 —— 玩家根本看不到「加载中」。
           * 600ms 足够读完「正在前往 卧室…」又不至于像卡住。
           */
          new Promise<void>((r) => window.setTimeout(r, 600)),
        ])
        setSceneId(id)
        writeLS(SCENE_KEY, id)
        // 两帧：第一帧 React 提交新 src，第二帧浏览器绘制首帧
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        )
        // 不可见的那几张（别的天气/昼夜）后台慢慢解码，下次切天气就不用等
        void preloadScene(target)
      } finally {
        setSceneFade(false)
        switchingRef.current = false
      }
    },
    [sceneId, scenes, phase, weather],
  )

  /**
   * 串门：先播一个礼让动作（女仆屈膝礼仪），播到一半再切房间。
   * 直接切太生硬，像瞬移。
   */
  /**
   * 串门。读条（到门口自动触发）和按钮点击走同一条路，
   * 两个入口可能在同一瞬间都触发 —— leavingRef 保证一次只进一个门。
   */
  const leavingRef = useRef(false)
  const goThrough = (exit: SceneExit) => {
    if (leavingRef.current) return
    leavingRef.current = true
    setNearExits([])
    engineRef.current?.playTransition('女仆屈膝礼仪', 2600)
    window.setTimeout(() => {
      void switchScene(exit.to).finally(() => {
        leavingRef.current = false
      })
    }, 2200)
  }

  /**
   * 走到门口就把目标房间的图预加载了 —— 礼让动作有 2.2 秒，
   * 足够四张 3400×1440 的 webp 下载 + 解码完，真正切的时候只是换 src。
   */
  useEffect(() => {
    if (!scenes || nearExits.length === 0) return
    for (const e of nearExits) {
      const target = scenes.scenes.find((s) => s.id === e.to)
      if (!target) continue
      // 先保「此刻可见的那张」，其余几张后台补 —— 门口有 2.2 秒，够用
      void preloadFile(visibleBgFile(target, phase, weather)).then(() => preloadScene(target))
    }
  }, [nearExits, scenes, phase, weather])

  return (
    <div className={`stage${phase === 'night' ? ' night' : ''}${weather === 'rain' ? ' rain' : ''}`}>
      {manifest && scene && scenes ? (
        <>
          <PetStage
            manifest={manifest}
            scene={scene}
            phase={phase}
            weather={weather}
            onReady={(e) => {
              engineRef.current = e
              // 引擎每次重建都要重新灌行为配置（切房间会重建）
              e?.setBehavior(behavior)
              // 调试用：控制台可以直接 __fish.act('吃白饭')
              if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__fish = e
            }}
            onExitChange={setNearExits}
            onVisit={goThrough}
          />
          {/*
            场景出口：走到门附近才显示，位置按门的世界比例固定（不跟随角色/摄像机）。
            她站到哪个门口，那个门的按钮就出现在门的正下方。
          */}
          {nearExits.map((e) => (
            <button
              key={e.to}
              className="exit-btn"
              style={{ left: `${e.x * 100}%` }}
              onClick={() => goThrough(e)}
            >
              <span className="exit-icon">{e.icon ?? '🚪'}</span>
              {e.label}
            </button>
          ))}
          <ActionPanel
            behavior={behavior}
            onBehaviorChange={setBehavior}
            manifest={manifest}
            scenes={scenes.scenes}
            sceneId={scene.id}
            onSceneChange={(id) => void switchScene(id)}
            onAct={(name) => void engineRef.current?.act(name)}
            onSay={(text, image) => engineRef.current?.say({ text, image })}
            dayMode={dayMode}
            phase={phase}
            onDayModeChange={changeDayMode}
            weather={weather}
            onWeatherChange={changeWeather}
          />
        </>
      ) : (
        <div className="loading">大肥鱼正在回家…</div>
      )}
      {/* 切房间的过场遮罩：盖住换 src 的那一两帧，颜色跟昼夜走 */}
      <div className={`scene-fade${sceneFade ? ' on' : ''}`} aria-hidden="true">
        <div className="scene-fade-label">
          <span className="scene-fade-dots"><i /><i /><i /></span>
          正在前往{sceneFadeTo ?? ''}…
        </div>
      </div>
      {/*
        署名：角色素材来自 dsh-pet（CC BY-NC-SA 4.0 + 二创约定），公开渠道必须附原作者地址。
        这是许可要求，不是装饰 —— 别删、别 `display:none` 掉。
      */}
      <a
        className="credit"
        href="https://github.com/PC2005-cloud/dsh-pet"
        target="_blank"
        rel="noreferrer noopener"
      >
        角色素材 dsh-pet · CC BY-NC-SA 4.0
      </a>
    </div>
  )
}
