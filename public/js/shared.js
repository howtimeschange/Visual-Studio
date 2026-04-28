const CANVAS_RESOLUTIONS = new Set(['1k', '2k', '4k'])
const KNOWN_VIEWS = new Set(['home', 'auth', 'translate', 'generate', 'projects', 'outfit', 'style'])

export function normalizeAspectRatio(value, fallback = '1:1') {
  const ratio = String(value || '').trim()
  return ['1:1', '4:3', '3:4', '16:9', '9:16', '1:4', '1:8'].includes(ratio) ? ratio : fallback
}

export function normalizeCanvasResolution(value, fallback = '1k') {
  const resolution = String(value || '').trim().toLowerCase()
  return CANVAS_RESOLUTIONS.has(resolution) ? resolution : fallback
}

export function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function splitDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return {
    mime: match[1],
    base64: match[2],
  }
}

export function normalizeView(view) {
  return KNOWN_VIEWS.has(view) ? view : 'home'
}

export function basename(name = '') {
  return String(name).replace(/\.[^.]+$/, '')
}

export function formatTimestamp(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatRelativeTime(ts) {
  if (!ts) return '刚刚编辑'
  const time = new Date(ts).getTime()
  if (!Number.isFinite(time)) return '刚刚编辑'
  const diff = Date.now() - time
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚编辑'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前编辑`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前编辑`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前编辑`
  return new Date(ts).toLocaleDateString('zh-CN')
}

export function sanitizeFileName(name = '') {
  return String(name).replace(/[\\/:*?"<>|]+/g, '-')
}

export function ensureImageExtension(name = '', href = '') {
  const normalized = String(name || 'image').trim() || 'image'
  if (/\.(png|jpg|jpeg|webp|gif)$/i.test(normalized)) return normalized
  const mime = splitDataUrl(href)?.mime || ''
  if (/jpeg/i.test(mime)) return `${normalized}.jpg`
  if (/webp/i.test(mime)) return `${normalized}.webp`
  if (/gif/i.test(mime)) return `${normalized}.gif`
  return `${normalized}.png`
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function rectsIntersect(a, b) {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1
}

export function unique(values) {
  return [...new Set(values)]
}

export function trimError(error) {
  return String(error?.message || error || 'Unknown error').trim().slice(0, 1600)
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
