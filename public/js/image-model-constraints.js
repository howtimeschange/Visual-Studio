// OpenAI GPT Image 2 / 2.5 documented pixel bounds. The gateway's old three
// recommended dimensions were not an exhaustive model capability list.
export function isModeljettyGptImage(provider, model) {
  return provider === 'modeljetty' && String(model).startsWith('gpt-image-')
}
export const GPT_IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
export function gptImageSizeError(size) {
  if (size === 'auto') return ''
  const match = /^(\d{1,4})x(\d{1,4})$/.exec(String(size))
  if (!match) return '请输入宽和高。'
  const [w, h] = match.slice(1).map(Number)
  if (!w || !h || w % 16 || h % 16) return '宽和高须为 16 的倍数。'
  if (Math.max(w, h) > 3840) return '最长边不能超过 3840 px。'
  if (Math.max(w, h) / Math.min(w, h) > 3) return '长短边比例不能超过 3:1。'
  if (w * h < 655360 || w * h > 8294400) return '总像素须在 65.5 万至 829.4 万之间。'
  return ''
}
export function imageOptionError(provider, model, ratio = '1:1', resolution = '1k', size = '', quality = '') {
  if (provider !== 'modeljetty') return ''
  if (isModeljettyGptImage(provider, model)) {
    if (quality && !GPT_IMAGE_QUALITIES.includes(quality)) return '请选择模型支持的生成质量。'
    if (size) return gptImageSizeError(size)
  } else if (size || quality) return '当前模型使用画幅和分辨率，请重新选择规格。'
  if (!['1k', '2k', '4k'].includes(resolution)) return '请选择 1K、2K 或 4K 规格。'
  if (!['auto', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'].includes(ratio)) return '当前模型支持的长短边比例不超过 3:1，请调整画幅。'
  return ''
}

export function gptImageSizePresets(ratio) {
  if (ratio === 'auto') return []
  const standard = { '1:1':'1024x1024', '3:2':'1536x1024', '2:3':'1024x1536', '4:3':'1536x1152', '3:4':'1152x1536', '16:9':'1536x864', '9:16':'864x1536' }[ratio] || '1024x1024'
  return [...new Set([standard, gptImageRequestSize(ratio, '2k'), gptImageRequestSize(ratio, '4k')].filter(Boolean))]
}
export function gptImageSizeIsExperimental(size) {
  const [w, h] = String(size).split('x').map(Number)
  return w * h > 2560 * 1440
}
export function gptImageSizeRatio(size) {
  const [w, h] = String(size).split('x').map(Number)
  return ['1:1','3:2','2:3','4:3','3:4','16:9','9:16'].find(r => {
    const [rw, rh] = r.split(':').map(Number)
    return Math.abs(w / h / (rw / rh) - 1) < 0.01
  }) || 'auto'
}
export function suggestGptImageSize(width, height) {
  let w = Number(width), h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return ''
  if (w / h > 3) w = h * 3
  if (h / w > 3) h = w * 3
  const factor = Math.min(3840 / Math.max(w, h), Math.sqrt(8294400 / (w * h)))
  if (factor < 1) { w *= factor; h *= factor }
  if (w * h < 655360) { const grow = Math.sqrt(655360 / (w * h)); w *= grow; h *= grow }
  w = Math.round(w / 16) * 16; h = Math.round(h / 16) * 16
  while (w * h > 8294400 || Math.max(w,h) > 3840) { if (w >= h) w -= 16; else h -= 16 }
  while (w * h < 655360) { if (w <= h) w += 16; else h += 16 }
  const size = `${w}x${h}`
  return gptImageSizeError(size) ? '' : size
}
export function gptImageRequestSize(ratio = '1:1', resolution = '1k') {
  if (ratio === 'auto') return 'auto'
  const match = /^(\d+):(\d+)$/.exec(ratio)
  if (!match) return ''
  const rw = Number(match[1]), rh = Number(match[2])
  if (!rw || !rh || Math.max(rw, rh) / Math.min(rw, rh) > 3) return ''
  let edge = ({'1k':1024,'2k':2048,'4k':3840})[resolution]
  if (!edge) return ''
  const align = value => Math.max(16, Math.round(value / 16) * 16)
  for (let i = 0; i < 240 && edge > 0 && edge <= 3840; i++) {
    const width = rw >= rh ? edge : align(edge * rw / rh)
    const height = rh >= rw ? edge : align(edge * rh / rw)
    const pixels = width * height
    if (pixels >= 655360 && pixels <= 8294400) return `${width}x${height}`
    edge += pixels > 8294400 ? -16 : 16
  }
  return ''
}
