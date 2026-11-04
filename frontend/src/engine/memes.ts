/**
 * 表情包文件名解析。
 *
 * 素材按「m001.png … m027.png」编号存放，名字→文件名的对应关系写在
 * manifest.json 的 memeFiles 里。**不要**再用中文标签直接拼路径：
 * 中文文件名在打包、上传工坊、跨平台解压时都出过问题（2026-11-04 起统一编号）。
 *
 * 这里留一份运行时副本，免得为了一个图片地址把整个 manifest 透传到气泡组件里。
 */
let files: Record<string, string> = {}

/** manifest 加载完调一次；传 undefined 时清空 */
export function setMemeFiles(map: Record<string, string> | undefined): void {
  files = map ?? {}
}

/**
 * 中文标签 → `./assets/memes/m012.png`。
 *
 * 映射缺失时退回 `${label}.png`（老包 / 手改 manifest 时不至于整块空白），
 * 新加的图一定要先进 filename-map.json，否则这里会静默 404。
 */
export function memeUrl(label: string): string {
  const file = files[label] ?? `${label}.png`
  return `./assets/memes/${encodeURIComponent(file)}`
}
