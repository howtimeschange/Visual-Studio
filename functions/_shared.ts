// Shared helpers for Pages Functions calling the 1xm.ai OpenAI-compatible relay.

export interface Env {
  RELAY_BASE_URL?: string
  VISION_API_KEY?: string
  BANANA2_API_KEY?: string
  BANANA_PRO_API_KEY?: string
  GPT_IMAGE_API_KEY?: string
  GPT_IMAGE_GROUP?: string
  CREDENTIAL_KEK?: string
  VS_JOB_CREDENTIAL_KEK?: string
  ADMIN_EMAILS?: string
  ADMIN_USER_IDS?: string
  VS_ADMIN_EMAILS?: string
  VS_ADMIN_USER_IDS?: string
  VS_QUEUE_EXECUTION_MODE?: string
  VS_LOCAL_QUEUE_ENDPOINT?: string
  VS_LOCAL_QUEUE_BRIDGE?: string
  VS_IMAGE_REQUEST_TIMEOUT_MS?: string
  VS_TEXT_REQUEST_TIMEOUT_MS?: string
  VS_IMAGE_FETCH_TIMEOUT_MS?: string
  VS_IMAGE_RETRY_COUNT?: string
  VS_IMAGE_RETRY_DELAY_MS?: string
  VS_DB?: D1Database
  VS_INPUTS_BUCKET?: R2Bucket
  VS_RESULTS_BUCKET?: R2Bucket
  VS_TEMP_BUCKET?: R2Bucket
  VS_JOBS_QUEUE?: Queue<unknown>
  VS_TRANSLATE_JOBS_QUEUE?: Queue<unknown>
  VS_OUTFIT_JOBS_QUEUE?: Queue<unknown>
}

export const DEFAULT_BASE = 'https://api.1xm.ai/v1'
export const VISION_MODEL = 'gemini-3-flash-preview'
const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 600_000
const DEFAULT_TEXT_REQUEST_TIMEOUT_MS = 90_000
const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 60_000
const DEFAULT_IMAGE_RETRY_COUNT = 2
const DEFAULT_IMAGE_RETRY_DELAY_MS = 1_000
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 900_000
const MAX_RETRY_COUNT = 5
const MAX_RETRY_DELAY_MS = 30_000
const GPT_IMAGE_2_MIN_PIXELS = 655_360
const GPT_IMAGE_2_MAX_PIXELS = 8_294_400
const GPT_IMAGE_2_MAX_EDGE = 3840
const GPT_IMAGE_2_SIZE_STEP = 16
const GPT_IMAGE_2_MAX_RATIO = 3
const TRANSIENT_IMAGE_STATUSES = new Set([500, 502, 503, 504, 524])
const GPT_IMAGE_2_POLL_INTERVAL_MS = 5_000
const GPT_IMAGE_2_MAX_POLL_INTERVAL_MS = 30_000

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

export function readPngDimensions(base64: string): { width: number; height: number } | null {
  try {
    const binary = atob(String(base64 || '').slice(0, 64))
    if (
      binary.length < 24
      || binary.charCodeAt(0) !== 0x89
      || binary.slice(1, 4) !== 'PNG'
      || binary.slice(12, 16) !== 'IHDR'
    ) {
      return null
    }
    const width = readBigEndianUint32(binary, 16)
    const height = readBigEndianUint32(binary, 20)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
    return { width, height }
  } catch {
    return null
  }
}

function readBigEndianUint32(binary: string, offset: number): number {
  return (
    (binary.charCodeAt(offset) << 24)
    | (binary.charCodeAt(offset + 1) << 16)
    | (binary.charCodeAt(offset + 2) << 8)
    | binary.charCodeAt(offset + 3)
  ) >>> 0
}

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
    retryCount: normalizeRetryCount(env.VS_IMAGE_RETRY_COUNT, DEFAULT_IMAGE_RETRY_COUNT),
    retryDelayMs: normalizeRetryDelayMs(env.VS_IMAGE_RETRY_DELAY_MS, DEFAULT_IMAGE_RETRY_DELAY_MS),
  }
}

export interface ImagePart {
  base64: string
  mime: string
}

type ImageModelOptions = {
  group?: string
  timeoutMs?: number
  imageFetchTimeoutMs?: number
  aspectRatio?: string
  resolution?: string
  size?: string
  quality?: string
  retryCount?: number
  retryDelayMs?: number
}

export async function callImageModel(
  baseUrl: string,
  apiKey: string,
  modelName: string,
  images: ImagePart[],
  prompt: string,
  opts: ImageModelOptions = {},
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
    const res = await fetchImageModelWithRetry(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    }, opts)

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
  opts: ImageModelOptions = {},
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string; status: number }> {
  const timeoutMs = normalizeTimeoutMs(opts.timeoutMs, DEFAULT_IMAGE_REQUEST_TIMEOUT_MS)
  const deadline = Date.now() + timeoutMs
  const request = buildGptImage2TaskRequest(modelName, images, prompt, opts)

  try {
    const createRes = await fetchImageModelWithRetry(`${baseUrl}/images/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: request.body,
    }, opts)

    if (!createRes.ok) {
      const errBody = await createRes.text()
      return { ok: false, error: `Upstream ${createRes.status}: ${errBody.slice(0, 500)}`, status: createRes.status }
    }

    const task = await createRes.json<any>()
    const finalTask = await waitForGptImage2Task(baseUrl, apiKey, task, opts, deadline)
    const imageSource = extractImageFromResponse(finalTask)
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

async function waitForGptImage2Task(
  baseUrl: string,
  apiKey: string,
  initialTask: any,
  opts: ImageModelOptions,
  deadline: number,
): Promise<any> {
  let task = initialTask
  for (let attempt = 0; ; attempt += 1) {
    const status = normalizeTaskStatus(task?.status)
    if (status === 'succeeded') return task
    if (status === 'failed') {
      throw new Error(extractTaskErrorMessage(task) || 'Image task failed.')
    }
    if (!status && extractImageFromResponse(task)) return task

    const pollUrl = resolveGptImage2PollUrl(baseUrl, task)
    if (!pollUrl) throw new Error('Image task response did not include a poll URL or task ID.')

    const waitMs = resolveGptImage2PollDelayMs(task, attempt)
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0 || waitMs >= remainingMs) {
      throw createTimeoutError(Math.max(1, normalizeTimeoutMs(opts.timeoutMs, DEFAULT_IMAGE_REQUEST_TIMEOUT_MS)))
    }
    await sleep(waitMs)

    const requestTimeoutMs = Math.max(MIN_TIMEOUT_MS, Math.min(remainingMs - waitMs, normalizeTimeoutMs(opts.timeoutMs, DEFAULT_IMAGE_REQUEST_TIMEOUT_MS)))
    const res = await fetchWithTimeout(pollUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }, requestTimeoutMs)
    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Upstream ${res.status}: ${errBody.slice(0, 500)}`)
    }
    task = await res.json<any>()
  }
}

function buildGptImage2TaskRequest(modelName: string, images: ImagePart[], prompt: string, opts: ImageModelOptions = {}): {
  headers: Record<string, string>
  body: string
} {
  const settings = resolveGptImage2Settings(opts)
  const payload: Record<string, unknown> = {
    model: modelName,
    prompt,
    n: 1,
    size: settings.size,
    quality: settings.quality,
    output_format: 'png',
  }
  if (images.length > 0) {
    payload.image = images.map((image) => {
      const mime = normalizeImageMime(image.mime) || 'image/png'
      return `data:${mime};base64,${image.base64}`
    })
  }
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function normalizeTaskStatus(value: unknown): string {
  const status = String(value || '').trim().toLowerCase()
  if (['succeeded', 'success', 'completed', 'done'].includes(status)) return 'succeeded'
  if (['failed', 'failure', 'error', 'cancelled', 'canceled', 'expired'].includes(status)) return 'failed'
  if (['queued', 'pending', 'running', 'in_progress', 'processing', 'created'].includes(status)) return status
  return ''
}

function extractTaskErrorMessage(task: any): string {
  const error = task?.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    return String(error.message || error.code || error.type || '').trim()
  }
  return String(task?.message || '').trim()
}

function resolveGptImage2PollUrl(baseUrl: string, task: any): string {
  const pollUrl = String(task?.poll_url || task?.pollUrl || '').trim()
  if (/^https?:\/\//i.test(pollUrl)) return pollUrl
  if (pollUrl.startsWith('/')) {
    const base = new URL(baseUrl)
    return `${base.origin}${pollUrl}`
  }

  const taskId = String(task?.id || task?.task_id || task?.taskId || '').trim()
  return taskId ? `${baseUrl}/images/tasks/${encodeURIComponent(taskId)}` : ''
}

function resolveGptImage2PollDelayMs(task: any, attempt: number): number {
  const pollAfterMs = Number(task?.poll_after_ms || task?.pollAfterMs)
  if (Number.isFinite(pollAfterMs) && pollAfterMs >= 0) {
    return Math.min(GPT_IMAGE_2_MAX_POLL_INTERVAL_MS, Math.floor(pollAfterMs))
  }
  const pollAfterSeconds = Number(task?.poll_after ?? task?.pollAfter)
  if (Number.isFinite(pollAfterSeconds) && pollAfterSeconds >= 0) {
    return Math.min(GPT_IMAGE_2_MAX_POLL_INTERVAL_MS, Math.floor(pollAfterSeconds * 1_000))
  }
  return Math.min(GPT_IMAGE_2_MAX_POLL_INTERVAL_MS, GPT_IMAGE_2_POLL_INTERVAL_MS * (attempt + 1))
}

function resolveGptImage2Settings(opts: ImageModelOptions = {}) {
  return {
    size: normalizeGptImage2Size(opts.size || sizeForAspectRatioAndResolution(opts.aspectRatio, opts.resolution)),
    quality: normalizeGptImage2Quality(opts.quality),
  }
}

function normalizeGptImage2Quality(value: unknown): string {
  const quality = String(value || '').trim().toLowerCase()
  return ['auto', 'high', 'medium', 'low'].includes(quality) ? quality : 'high'
}

function normalizeGptImage2Size(value: unknown): string {
  const size = String(value || '').trim().toLowerCase()
  if (!size || size === 'auto') return 'auto'
  const match = size.match(/^(\d+)x(\d+)$/)
  if (!match) return 'auto'
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 'auto'
  if (width < GPT_IMAGE_2_SIZE_STEP || height < GPT_IMAGE_2_SIZE_STEP) return 'auto'
  if (width > GPT_IMAGE_2_MAX_EDGE || height > GPT_IMAGE_2_MAX_EDGE) return 'auto'
  if (width % GPT_IMAGE_2_SIZE_STEP !== 0 || height % GPT_IMAGE_2_SIZE_STEP !== 0) return 'auto'
  const pixels = width * height
  if (pixels < GPT_IMAGE_2_MIN_PIXELS || pixels > GPT_IMAGE_2_MAX_PIXELS) return 'auto'
  if (Math.max(width, height) / Math.min(width, height) > GPT_IMAGE_2_MAX_RATIO) return 'auto'
  return `${width}x${height}`
}

function sizeForAspectRatioAndResolution(aspectRatio: unknown, resolution: unknown): string {
  const ratio = normalizeGptImage2AspectRatio(aspectRatio)
  const longEdge = ({
    '1k': 1024,
    '2k': 2048,
    '4k': 3840,
  } as Record<string, number>)[String(resolution || '').trim().toLowerCase()]
  if (!ratio || !longEdge) return 'auto'

  const [ratioWidth, ratioHeight] = ratio.split(':').map((part) => Number(part) || 1)
  if (Math.max(ratioWidth, ratioHeight) / Math.min(ratioWidth, ratioHeight) > GPT_IMAGE_2_MAX_RATIO) return 'auto'

  let candidateLongEdge = alignGptImage2Size(longEdge)
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const size = buildGptImage2SizeForLongEdge(candidateLongEdge, ratioWidth, ratioHeight)
    const normalized = normalizeGptImage2Size(size)
    if (normalized !== 'auto') return normalized

    const [width, height] = size.split('x').map(Number)
    const pixels = width * height
    candidateLongEdge += pixels > GPT_IMAGE_2_MAX_PIXELS ? -GPT_IMAGE_2_SIZE_STEP : GPT_IMAGE_2_SIZE_STEP
    if (candidateLongEdge < GPT_IMAGE_2_SIZE_STEP || candidateLongEdge > GPT_IMAGE_2_MAX_EDGE) return 'auto'
  }

  return 'auto'
}

function normalizeGptImage2AspectRatio(value: unknown): string {
  const ratio = String(value || '').trim()
  return ['1:1', '4:3', '3:4', '16:9', '9:16', '1:4', '1:8'].includes(ratio) ? ratio : ''
}

function alignGptImage2Size(value: number): number {
  return Math.max(
    GPT_IMAGE_2_SIZE_STEP,
    Math.min(GPT_IMAGE_2_MAX_EDGE, Math.round(value / GPT_IMAGE_2_SIZE_STEP) * GPT_IMAGE_2_SIZE_STEP),
  )
}

function buildGptImage2SizeForLongEdge(longEdge: number, ratioWidth: number, ratioHeight: number): string {
  const landscape = ratioWidth >= ratioHeight
  const width = landscape ? longEdge : alignGptImage2Size((longEdge * ratioWidth) / ratioHeight)
  const height = landscape ? alignGptImage2Size((longEdge * ratioHeight) / ratioWidth) : longEdge
  return `${width}x${height}`
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

async function fetchImageModelWithRetry(input: RequestInfo | URL, init: RequestInit, opts: ImageModelOptions): Promise<Response> {
  const timeoutMs = normalizeTimeoutMs(opts.timeoutMs, DEFAULT_IMAGE_REQUEST_TIMEOUT_MS)
  const retryCount = normalizeRetryCount(opts.retryCount, DEFAULT_IMAGE_RETRY_COUNT)
  const retryDelayMs = normalizeRetryDelayMs(opts.retryDelayMs, DEFAULT_IMAGE_RETRY_DELAY_MS)

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const res = await fetchWithTimeout(input, init, timeoutMs)
    if (!shouldRetryImageResponse(res, attempt, retryCount)) return res
    await sleep(retryDelayMs * (2 ** attempt))
  }

  return fetchWithTimeout(input, init, timeoutMs)
}

function shouldRetryImageResponse(res: Response, attempt: number, retryCount: number): boolean {
  return attempt < retryCount && TRANSIENT_IMAGE_STATUSES.has(res.status)
}

function normalizeRetryCount(value: unknown, fallback: number): number {
  const numeric = Math.floor(Number(value))
  if (!Number.isFinite(numeric) || numeric < 0) return fallback
  return Math.min(MAX_RETRY_COUNT, numeric)
}

function normalizeRetryDelayMs(value: unknown, fallback: number): number {
  const numeric = Math.floor(Number(value))
  if (!Number.isFinite(numeric) || numeric < 0) return fallback
  return Math.min(MAX_RETRY_DELAY_MS, numeric)
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
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
