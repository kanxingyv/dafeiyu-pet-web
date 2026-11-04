import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
const root = path.join(os.homedir(),'AppData','Local','ms-playwright')
const d = readdirSync(root).filter(x=>x.startsWith('chromium')).sort().reverse()[0]
const exe = path.join(root,'chromium-1223','chrome-win64','chrome.exe')
const b = await chromium.launch({ executablePath: existsSync(exe)?exe:undefined })
const p = await b.newPage({ viewport:{width:1440,height:900} })
await p.goto('http://127.0.0.1:5173',{waitUntil:'networkidle'})
await p.waitForTimeout(2500)
await p.evaluate(()=>fetch('/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'say',text:'主人回来啦',holdMs:20000})}))
await p.waitForTimeout(2500)
const info = await p.evaluate(()=>{
  const w = document.querySelector('.bubble-wrap')
  const bub = document.querySelector('.bubble')
  const t = document.querySelector('.bubble-text')
  const rect = w?.getBoundingClientRect()
  const br = bub?.getBoundingClientRect()
  return {
    hasWrap: !!w, wrapRect: rect && {top:Math.round(rect.top),h:Math.round(rect.height),w:Math.round(rect.width)},
    bubbleRect: br && {top:Math.round(br.top),h:Math.round(br.height),w:Math.round(br.width)},
    textContent: t?.textContent, textRect: t && (()=>{const r=t.getBoundingClientRect();return {top:Math.round(r.top),h:Math.round(r.height)}})(),
    textColor: t && getComputedStyle(t).color,
    petTop: Math.round(document.querySelector('.pet-layer')?.getBoundingClientRect().top||0),
    innerHTML: bub?.innerHTML.slice(0,200),
  }
})
console.log(JSON.stringify(info,null,2))
await b.close()
