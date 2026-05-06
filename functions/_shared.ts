// Shared helpers for Pages Functions calling the 1xm.ai OpenAI-compatible relay.

export interface Env {
  RELAY_BASE_URL?: string
  VISION_API_KEY?: string
  BANANA2_API_KEY?: string
  BANANA_PRO_API_KEY?: string
  GPT_IMAGE_API_KEY?: string
  GPT_IMAGE_GROUP?: string
  CREDENTIAL_KEK?: string
  ADMIN_EMAILS?: string
  ADMIN_USER_IDS?: string
  VS_ADMIN_EMAILS?: string
  VS_ADMIN_USER_IDS?: string
  VS_QUEUE_EXECUTION_MODE?: string
  VS_IMAGE_REQUEST_TIMEOUT_MS?: string
  VS_TEXT_REQUEST_TIMEOUT_MS?: string
  VS_IMAGE_FETCH_TIMEOUT_MS?: string
  VS_DB?: D1Database
  VS_INPUTS_BUCKET?: R2Bucket
  VS_RESULTS_BUCKET?: R2Bucket
  VS_TEMP_BUCKET?: R2Bucket
  VS_JOBS_QUEUE?: Queue<unknown>
}

export const DEFAULT_BASE = 'https://api.1xm.ai/v1'
export const VISION_MODEL = 'gemini-3-flash-preview'
const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 300_000
const DEFAULT_TEXT_REQUEST_TIMEOUT_MS = 90_000
const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 60_000
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 900_000

export const MODEL_MAP: Record<string, string> = {
  'nano-banana-2': 'gemini-3.1-flash-image-preview',
  'nano-banana-pro': 'gemini-3-pro-image-preview',
  'gpt-image-2': 'gpt-image-2',
}

export const LANG_NAMES: Record<string, string> = {
  auto: '自动检测', zh: '简体中文', 'zh-TW': '繁體中文', en: 'English',
  ja: '日本語', ko: '한국어', fr: 'Français', de: 'Deutsch', es: 'Español',
  pt: 'Português', ru: 'Русский', ar: 'العربية', th: 'ภาษาไทย',
  vi: 'Tiếng Việt', id: 'Bahasa Indonesia', ms: 'Bahasa Melayu',
  tl: 'Filipino', my: 'မြန်မာဘာသာ', km: 'ភាសាខ្មែរ', lo: 'ພາສາລາວ',
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })

export const corsPreflight = () =>
  new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })

export function resolveKeys(modelId: string, env: Env, clientKeys: any = {}) {
  const visionKey = clientKeys.visionApiKey || env.VISION_API_KEY || ''
  const genKey =
    modelId === 'nano-banana-pro'
      ? clientKeys.bananaProApiKey || env.BANANA_PRO_API_KEY || ''
      : modelId === 'gpt-image-2'
        ? clientKeys.gptImageApiKey || env.GPT_IMAGE_API_KEY || ''
        : clientKeys.banana2ApiKey || env.BANANA2_API_KEY || ''
  return { visionKey, genKey }
}

export function resolveImageModelOptions(modelId: string, env: Env, clientKeys: any = {}) {
  return {
    group: modelId === 'gpt-image-2'
      ? String(clientKeys.gptImageGroup || env.GPT_IMAGE_GROUP || '').trim()
      : '',
    timeoutMs: normalizeTimeoutMs(env.VS_IMAGE_REQUEST_TIMEOUT_MS, DEFAULT_IMAGE_REQUEST_TIMEOUT_MS),
    imageFetchTimeoutMs: normalizeTimeoutMs(env.VS_IMAGE_FETCH_TIMEOUT_MS, DEFAULT_IMAGE_FETCH_TIMEOUT_MS),
  }
}

export interface ImagePart {
  base64: string
  mime: string
}

export async function callImageModel(
  baseUrl: string,
  apiKey: string,
  modelName: string,
  images: ImagePart[],
  prompt: string,
  opts: { group?: string; timeoutMs?: number; imageFetchTimeoutMs?: number } = {},
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string; status: number }> {
  if (modelName === 'gpt-image-2') {
    return callGptImage2Model(baseUrl, apiKey, modelName, images, prompt, opts)
  }

  const content: any[] = images.map((img) => ({
    type: 'image_url',
    image_url: { url: `data:${img.mime};base64,${img.base64}` },
  }))
  content.push({
    type: 'text',
    text: prompt,
  })

  const payload = {
    model: modelName,
    messages: [{ role: 'user', content }],
    temperature: 0.2,
  }

  try {
    const timeoutMs = normalizeTimeoutMs(opts.timeoutMs, DEFAULT_IMAGE_REQUEST_TIMEOUT_MS)
    const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    }, timeoutMs)

    if (!res.ok) {
      const errBody = await res.text()
      return { ok: false, error: `Upstream ${res.status}: ${errBody.slice(0, 500)}`, status: res.status }
    }
    const data = await res.json<any>()
    const imageSource = extractImageFromResponse(data)
    const dataUrl = imageSource
      ? await coerceImageSourceToDataUrl(
        imageSource,
        normalizeTimeoutMs(opts.imageFetchTimeoutMs, DEFAULT_IMAGE_FETCH_TIMEOUT_MS),
      )
      : null
    if (!dataUrl) {
      return { ok: false, error: 'Model returned no image.', status: 502 }
    }
    return { ok: true, dataUrl }
  } catch (e: any) {
    if (isTimeoutError(e)) {
      return { ok: false, error: `Upstream image request timed out after ${formatDuration(e.timeoutMs)}.`, status: 504 }
    }
    return { ok: false, error: e?.message ?? 'fetch failed', status: 502 }
  }
}

async function callGptImage2Model(
  baseUrl: string,
  apiKey: string,
  modelName: string,
  images: ImagePart[],
  prompt: string,
  opts: { timeoutMs?: number; imageFetchTimeoutMs?: number } = {},
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string; status: number }> {
  const timeoutMs = normalizeTimeoutMs(opts.timeoutMs, DEFAULT_IMAGE_REQUEST_TIMEOUT_MS)
  const hasImages = images.length > 0
  const endpoint = hasImages ? 'images/edits' : 'images/generations'
  const request = hasImages
    ? buildGptImage2EditRequest(modelName, images, prompt)
    : buildGptImage2GenerationRequest(modelName, prompt)

  try {
    const res = await fetchWithTimeout(`${baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: {
        ...request.headers,
        Authorization: `Bearer ${apiKey}`,
      },
      body: request.body,
    }, timeoutMs)

    if (!res.ok) {
      const errBody = await res.text()
      return { ok: false, error: `Upstream ${res.status}: ${errBody.slice(0, 500)}`, status: res.status }
    }

    const data = await res.json<any>()
    const imageSource = extractImageFromResponse(data)
    const dataUrl = imageSource
      ? await coerceImageSourceToDataUrl(
        imageSource,
        normalizeTimeoutMs(opts.imageFetchTimeoutMs, DEFAULT_IMAGE_FETCH_TIMEOUT_MS),
      )
      : null
    if (!dataUrl) {
      return { ok: false, error: 'Model returned no image.', status: 502 }
    }
    return { ok: true, dataUrl }
  } catch (e: any) {
    if (isTimeoutError(e)) {
      return { ok: false, error: `Upstream image request timed out after ${formatDuration(e.timeoutMs)}.`, status: 504 }
    }
    return { ok: false, error: e?.message ?? 'fetch failed', status: 502 }
  }
}

function buildGptImage2GenerationRequest(modelName: string, prompt: string): {
  headers: Record<string, string>
  body: string
} {
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      prompt,
      n: 1,
      size: 'auto',
      quality: 'high',
      output_format: 'png',
    }),
  }
}

function buildGptImage2EditRequest(modelName: string, images: ImagePart[], prompt: string): {
  headers: Record<string, string>
  body: FormData
} {
  const form = new FormData()
  form.set('model', modelName)
  form.set('prompt', prompt)
  form.set('n', '1')
  form.set('size', 'auto')
  form.set('quality', 'high')
  form.set('output_format', 'png')

  images.forEach((image, index) => {
    const mime = normalizeImageMime(image.mime) || 'image/png'
    const extension = extensionForImageMime(mime)
    form.append('image[]', base64ToBlob(image.base64, mime), `reference-${index + 1}.${extension}`)
  })

  return { headers: {}, body: form }
}

export async function callTextModel(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: any[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 1500,
      }),
    }, normalizeTimeoutMs((opts as { timeoutMs?: number }).timeoutMs, DEFAULT_TEXT_REQUEST_TIMEOUT_MS))
    if (!res.ok) return null
    const data = await res.json<any>()
    const raw = data.choices?.[0]?.message?.content
    if (typeof raw === 'string') return raw
    if (Array.isArray(raw)) {
      return raw.map((p) => (p.type === 'text' ? p.text : '')).join('\n').trim()
    }
    return null
  } catch {
    return null
  }
}

export function extractImageFromResponse(data: any): string | null {
  const content = data.choices?.[0]?.message?.content
  const sources = collectImageSources(content)
  if (sources[0]) return sources[0]

  const text = extractTextFromContent(content)
  if (text) {
    const textSources = collectImageSources(text)
    if (textSources[0]) return textSources[0]
  }

  const dataSources = collectImageSources(data.data || [])
  if (dataSources[0]) return dataSources[0]

  const candidateSources = collectImageSources(data.candidates?.[0]?.content?.parts || [])
  if (candidateSources[0]) return candidateSources[0]

  return null
}

const MARKDOWN_IMAGE_REGEX = /!\[[^\]]*\]\((data:image\/[^\s)]+|https?:\/\/[^\s)]+)\)/gi
const DATA_URL_REGEX = /(data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+)/gi
const HTTP_URL_REGEX = /https?:\/\/[^\s)\]>\"']+/gi

function extractTextFromContent(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item
        if (item?.type === 'text' || item?.type === 'output_text') return String(item.text || '')
        return typeof item?.text === 'string' ? item.text : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') {
    return content.text
  }
  return ''
}

function collectImageSources(content: any): string[] {
  const sources: string[] = []

  const addSource = (value: string | null | undefined) => {
    if (!value || sources.includes(value)) return
    sources.push(value)
  }

  const addBase64 = (data: string | null | undefined, mime = 'image/png') => {
    if (!data) return
    addSource(`data:${mime};base64,${data}`)
  }

  const walk = (node: any) => {
    if (!node) return

    if (typeof node === 'string') {
      for (const match of node.matchAll(MARKDOWN_IMAGE_REGEX)) addSource(match[1])
      for (const match of node.matchAll(DATA_URL_REGEX)) addSource(match[1])
      for (const match of node.matchAll(HTTP_URL_REGEX)) addSource(match[0])
      return
    }

    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }

    if (typeof node !== 'object') return

    if (typeof node.image_url === 'string') addSource(node.image_url)
    if (typeof node.imageUrl === 'string') addSource(node.imageUrl)
    if (node.image_url?.url) addSource(node.image_url.url)
    if (node.imageUrl?.url) addSource(node.imageUrl.url)
    if (node.url) addSource(node.url)
    if (node.b64_json || node.b64Json) addBase64(node.b64_json || node.b64Json)
    if (node.inlineData?.data) addBase64(node.inlineData.data, node.inlineData.mimeType || 'image/png')
    if (node.inline_data?.data) addBase64(node.inline_data.data, node.inline_data.mime_type || 'image/png')

    if (typeof node.text === 'string') walk(node.text)
    if (node.content) walk(node.content)
    if (node.parts) walk(node.parts)
  }

  walk(content)
  return sources
}

async function coerceImageSourceToDataUrl(source: string, timeoutMs = DEFAULT_IMAGE_FETCH_TIMEOUT_MS): Promise<string | null> {
  if (!source) return null
  if (source.startsWith('data:')) return source
  if (!/^https?:\/\//i.test(source)) return source

  try {
    const res = await fetchWithTimeout(source, {}, timeoutMs)
    if (!res.ok) return source
    const mime = normalizeImageMime(res.headers.get('content-type')) || guessMimeFromUrl(source) || 'image/png'
    const buffer = await res.arrayBuffer()
    return `data:${mime};base64,${arrayBufferToBase64(buffer)}`
  } catch {
    return source
  }
}

function normalizeTimeoutMs(value: unknown, fallback: number): number {
  const numeric = Math.floor(Number(value))
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, numeric))
}

function createTimeoutError(timeoutMs: number) {
  const error = new Error(`Request timed out after ${timeoutMs}ms`) as Error & { code?: string; timeoutMs?: number }
  error.code = 'REQUEST_TIMEOUT'
  error.timeoutMs = timeoutMs
  return error
}

function isTimeoutError(error: unknown): error is Error & { code: string; timeoutMs: number } {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'REQUEST_TIMEOUT')
}

function formatDuration(timeoutMs: number): string {
  if (timeoutMs >= 60_000 && timeoutMs % 60_000 === 0) return `${timeoutMs / 60_000} minutes`
  if (timeoutMs >= 1_000 && timeoutMs % 1_000 === 0) return `${timeoutMs / 1_000} seconds`
  return `${timeoutMs}ms`
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<Response>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(createTimeoutError(timeoutMs))
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      timeout,
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function normalizeImageMime(value: string | null): string | null {
  if (!value) return null
  const mime = value.split(';', 1)[0]?.trim().toLowerCase()
  return mime?.startsWith('image/') ? mime : null
}

function guessMimeFromUrl(url: string): string | null {
  const clean = url.split(/[?#]/, 1)[0].toLowerCase()
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg'
  if (clean.endsWith('.png')) return 'image/png'
  if (clean.endsWith('.webp')) return 'image/webp'
  if (clean.endsWith('.gif')) return 'image/gif'
  return null
}

function extensionForImageMime(mime: string): string {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'png'
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(String(base64 || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mime })
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}
