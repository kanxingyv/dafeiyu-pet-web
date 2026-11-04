import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 前端与后端同源部署时，/api 与 /ws 由 FastAPI 提供；
// 开发期用 vite 代理转到本地后端，避免跨域。
const BACKEND = process.env.DAFEIYU_API ?? 'http://127.0.0.1:8765'

/*
 * 构建时间戳：显示在画面右下角（版本水印）。
 * 作用：WE 里一眼确认「加载的是哪个版本」，终结「到底重载了没」的争论。
 */
const BUILD_STAMP = new Date().toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hour12: false,
})

export default defineConfig({
  plugins: [react()],
  base: './',
  // 版本水印已按需求移除；构建时间暂时保留，需要排查版本时可再启用
  // define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/ws': { target: BACKEND, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0, // 视频/图片一律走文件，不内联
    chunkSizeWarningLimit: 1200,
  },
})
