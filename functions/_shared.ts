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
  VS_IMAGE_TASK_POLL_INTERVAL_MS?: string
  VS_IMAGE_RETRY_COUNT?: string
  VS_IMAGE_RETRY_DELAY_MS?: string
  VS_GENERATE_TASK_MAX_POLLS_PER_RUN?: string
  VS_OUTFIT_TASK_MAX_POLLS_PER_RUN?: string
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
const DEFAULT_IMAGE_TASK_POLL_INTERVAL_MS = 15_000
const DEFAULT_IMAGE_TASK_HTTP_TIMEOUT_MS = 30_000
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
const TRANSIENT_IMAGE_STATUSES = new Set([502, 503, 504, 524])
const SUCCEEDED_IMAGE_TASK_STATUSES = new Set(['succeeded', 'completed', 'success', 'done'])
const FAILED_IMAGE_TASK_STATUSES = new Set(['failed', 'error', 'canceled', 'cancelled'])

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
    pollIntervalMs: normalizePollIntervalMs(env.VS_IMAGE_TASK_POLL_INTERVAL_MS, DEFAULT_IMAGE_TASK_POLL_INTERVAL_MS),
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
  pollIntervalMs?: number
  maxPollAttempts?: number
  existingTask?: any
}

type ImageSourceResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string }

export type ImageTaskStepResult =
  | { ok: true; pending?: false; dataUrl: string; task: any }
  | { ok: false; pending: true; task: any; pollTarget: string; pollUrl: string; taskStatus: string; nextPollAfterMs: number }
  | { ok: false; pending?: false; error: string; status: number }

export async function callImageModel(
  baseUrl: string,
  apiKey: string,
  modelName: string,
  images: ImagePart[],
  prompt: string,
  opts: ImageModelOptions = {},
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string; status: number }> {
  return callAsyncImageTaskModel(baseUrl, apiKey, modelName, images, prompt, opts)
}

async function callAsyncImageTaskModel(
  baseUrl: string,
  apiKey: string,
  modelName: string,
  images: ImagePart[],
  prompt: string,
  opts: ImageModelOptions = {},
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string; status: number }> {
  const result = await callImageModelTaskStep(baseUrl, apiKey, modelName, images, prompt, opts)
  if (result.ok) return { ok: true, dataUrl: result.dataUrl }
  if (result.pending) return { ok: false, error: 'Image task is still running.', status: 202 }
  return result
}

export async function callImageModelTaskStep(
  baseUrl: string,
  apiKey: string,
  modelName: string,
  images: ImagePart[],
  prompt: string,
  opts: ImageModelOptions = {},
): Promise<ImageTaskStepResult> {
  const timeoutMs = normalizeTimeoutMs(opts.timeoutMs, DEFAULT_IMAGE_REQUEST_TIMEOUT_MS)
  const startedAt = Date.now()
  const taskHttpTimeoutMs = Math.min(timeoutMs, DEFAULT_IMAGE_TASK_HTTP_TIMEOUT_MS)
  const payload = buildAsyncImageTaskPayload(modelName, images, prompt, opts)

  try {
    const deadlineAt = startedAt + timeoutMs
    const task = opts.existingTask
      ? { ok: true as const, data: opts.existingTask }
      : await createAsyncImageTask(baseUrl, apiKey, payload, opts, taskHttpTimeoutMs, deadlineAt)
    if (!task.ok) return task

    const finalTask = await waitForAsyncImageTask(baseUrl, apiKey, task.data, opts, {
      timeoutMs,
      taskHttpTimeoutMs,
      startedAt,
      maxPollAttempts: normalizeMaxPollAttempts(opts.maxPollAttempts),
    })
    if (!finalTask.ok) return finalTask

    const imageSource = extractImageFromResponse(finalTask.data)
    if (!imageSource) {
      return { ok: false, error: 'Model returned no image.', status: 502 }
    }

    const dataUrl = await coerceImageSourceToDataUrl(
      imageSource,
      normalizeTimeoutMs(opts.imageFetchTimeoutMs, DEFAULT_IMAGE_FETCH_TIMEOUT_MS),
    )
    if (!dataUrl.ok) {
      return { ok: false, error: dataUrl.error, status: 502 }
    }
    return { ok: true, dataUrl: dataUrl.dataUrl, task: finalTask.data }
  } catch (e: any) {
    if (isTimeoutError(e)) {
      return { ok: false, error: `Upstream image task timed out after ${formatDuration(e.timeoutMs)}.`, status: 504 }
    }
    return { ok: false, error: e?.message ?? 'fetch failed', status: 502 }
  }
}

function buildAsyncImageTaskPayload(
  modelName: string,
  images: ImagePart[],
  prompt: string,
  opts: ImageModelOptions = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: modelName,
    prompt,
    n: 1,
    output_format: 'png',
  }

  if (modelName === 'gpt-image-2') {
    const settings = resolveGptImage2Settings(opts)
    payload.size = settings.size
    payload.quality = settings.quality
    if (opts.group) payload.group = opts.group
  } else {
    const size = normalizeGeminiImageTaskSize(opts.aspectRatio)
    const quality = normalizeGeminiImageTaskQuality(opts.resolution)
    if (size) payload.size = size
    if (quality) payload.quality = quality
  }

  if (images.length > 0) {
    payload.image = images.map((img) => `data:${normalizeImageMime(img.mime) || 'image/png'};base64,${img.base64}`)
  }

  return payload
}

async function createAsyncImageTask(
  baseUrl: string,
  apiKey: string,
  payload: Record<string, unknown>,
  opts: ImageModelOptions,
  timeoutMs: number,
  deadlineAt?: number,
): Promise<{ ok: true; data: any } | { ok: false; error: string; status: number }> {
  const res = await fetchImageModelWithRetry(`${baseUrl}/images/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  }, { ...opts, timeoutMs }, deadlineAt)

  const data = await readJsonResponse(res)
  if (!res.ok && res.status !== 202) {
    return { ok: false, error: `Upstream ${res.status}: ${formatUpstreamError(data)}`, status: res.status }
  }
  return { ok: true, data }
}

async function waitForAsyncImageTask(
  baseUrl: string,
  apiKey: string,
  initialTask: any,
  requestOpts: ImageModelOptions,
  opts: { timeoutMs: number; taskHttpTimeoutMs: number; startedAt: number; maxPollAttempts: number },
): Promise<{ ok: true; data: any } | { ok: false; error: string; status: number } | Extract<ImageTaskStepResult, { pending: true }>> {
  let task = initialTask
  let pollAttempts = 0

  for (;;) {
    const status = normalizeTaskStatus(task?.status)
    if (SUCCEEDED_IMAGE_TASK_STATUSES.has(status)) return { ok: true, data: task }
    if (FAILED_IMAGE_TASK_STATUSES.has(status)) {
      return { ok: false, error: `Image task ${status}: ${formatUpstreamError(task)}`, status: 502 }
    }

    if (extractImageFromResponse(task)) return { ok: true, data: task }

    const pollTarget = String(task?.poll_url || task?.pollUrl || task?.id || task?.task_id || task?.taskId || '').trim()
    if (!pollTarget) {
      return { ok: false, error: 'Image task response did not include poll_url or task_id.', status: 502 }
    }

    const pollUrl = buildImageTaskPollUrl(baseUrl, pollTarget)
    const nextPollAfterMs = normalizePollAfterMs(
      task?.poll_after ?? task?.pollAfter,
      requestOpts.pollIntervalMs,
    )
    if (pollAttempts >= opts.maxPollAttempts) {
      return {
        ok: false,
        pending: true,
        task,
        pollTarget,
        pollUrl,
        taskStatus: status || 'queued',
        nextPollAfterMs,
      }
    }

    const elapsedMs = Date.now() - opts.startedAt
    const remainingMs = opts.timeoutMs - elapsedMs
    if (remainingMs <= 0) throw createTimeoutError(opts.timeoutMs)

    await sleep(Math.min(nextPollAfterMs, remainingMs))
    if (Date.now() - opts.startedAt >= opts.timeoutMs) throw createTimeoutError(opts.timeoutMs)

    const pollRes = await fetchImageModelWithRetry(pollUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    }, {
      ...requestOpts,
      timeoutMs: Math.min(opts.taskHttpTimeoutMs, Math.max(MIN_TIMEOUT_MS, opts.timeoutMs - (Date.now() - opts.startedAt))),
    }, opts.startedAt + opts.timeoutMs)
    const pollData = await readJsonResponse(pollRes)
    if (!pollRes.ok) {
      return { ok: false, error: `Upstream ${pollRes.status}: ${formatUpstreamError(pollData)}`, status: pollRes.status }
    }
    task = pollData
    pollAttempts += 1
  }
}

function buildImageTaskPollUrl(baseUrl: string, pollTarget: string): string {
  if (/^https?:\/\//i.test(pollTarget)) return pollTarget
  return `${baseUrl.replace(/\/+$/, '')}/images/tasks/${encodeURIComponent(pollTarget)}`
}

function normalizeTaskStatus(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function normalizePollAfterMs(value: unknown, fallback = DEFAULT_IMAGE_TASK_POLL_INTERVAL_MS): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return normalizePollIntervalMs(fallback, DEFAULT_IMAGE_TASK_POLL_INTERVAL_MS)
  if (numeric === 0) return 0
  return Math.max(1_000, Math.min(60_000, numeric * 1_000))
}

async function readJsonResponse(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function formatUpstreamError(data: any): string {
  const message =
    data?.error?.message
    || data?.error
    || data?.message
    || data?._timeout
    || data?.raw
    || JSON.stringify(data || {})
  return String(message || 'unknown error').slice(0, 500)
}

function normalizeGeminiImageTaskSize(value: unknown): string {
  const ratio = String(value || '').trim()
  return ['1:1', '4:3', '3:4', '16:9', '9:16'].includes(ratio) ? ratio : ''
}

function normalizeGeminiImageTaskQuality(value: unknown): string {
  const resolution = String(value || '').trim().toUpperCase()
  return ['1K', '2K', '4K'].includes(resolution) ? resolution : ''
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

  const resultSources = collectImageSources(data.result || data.output || data.outputs || [])
  if (resultSources[0]) return resultSources[0]

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
    if (typeof node.output_url === 'string') addSource(node.output_url)
    if (typeof node.outputUrl === 'string') addSource(node.outputUrl)
    if (node.image_url?.url) addSource(node.image_url.url)
    if (node.imageUrl?.url) addSource(node.imageUrl.url)
    if (node.output_url?.url) addSource(node.output_url.url)
    if (node.outputUrl?.url) addSource(node.outputUrl.url)
    if (node.url) addSource(node.url)
    if (node.b64_json || node.b64Json) addBase64(node.b64_json || node.b64Json)
    if (node.inlineData?.data) addBase64(node.inlineData.data, node.inlineData.mimeType || 'image/png')
    if (node.inline_data?.data) addBase64(node.inline_data.data, node.inline_data.mime_type || 'image/png')

    if (typeof node.text === 'string') walk(node.text)
    if (node.content) walk(node.content)
    if (node.parts) walk(node.parts)
    if (node.result) walk(node.result)
    if (node.output) walk(node.output)
    if (node.outputs) walk(node.outputs)
  }

  walk(content)
  return sources
}

async function coerceImageSourceToDataUrl(source: string, timeoutMs = DEFAULT_IMAGE_FETCH_TIMEOUT_MS): Promise<ImageSourceResult> {
  if (!source) return { ok: false, error: 'Model returned no image.' }
  if (source.startsWith('data:')) {
    return isUsableImageDataUrl(source)
      ? { ok: true, dataUrl: source }
      : { ok: false, error: 'Model returned an invalid image data URL.' }
  }
  if (!/^https?:\/\//i.test(source)) {
    return { ok: false, error: `Unsupported image source returned by model: ${source.slice(0, 120)}` }
  }

  try {
    const res = await fetchWithTimeout(source, {}, timeoutMs)
    if (!res.ok) {
      const detail = await readResponseText(res)
      return { ok: false, error: `Image result fetch failed (${res.status}) from ${formatUrlForError(source)}${detail ? `: ${detail}` : ''}` }
    }
    const contentType = res.headers.get('content-type')
    const mime = normalizeImageMime(contentType) || guessMimeFromUrl(source) || 'image/png'
    if (contentType && !normalizeImageMime(contentType)) {
      return { ok: false, error: `Image result fetch returned non-image content-type: ${contentType}` }
    }
    const buffer = await res.arrayBuffer()
    if (buffer.byteLength <= 0) {
      return { ok: false, error: 'Image result fetch returned an empty body.' }
    }
    const dataUrl = `data:${mime};base64,${arrayBufferToBase64(buffer)}`
    return isUsableImageDataUrl(dataUrl)
      ? { ok: true, dataUrl }
      : { ok: false, error: 'Image result fetch returned invalid image data.' }
  } catch (error: any) {
    const message = isTimeoutError(error)
      ? `timed out after ${formatDuration(error.timeoutMs)}`
      : String(error?.message || 'fetch failed')
    return { ok: false, error: `Image result fetch failed from ${formatUrlForError(source)}: ${message}` }
  }
}

async function readResponseText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return ''
  }
}

function formatUrlForError(value: string): string {
  try {
    const url = new URL(value)
    return url.host || value.slice(0, 120)
  } catch {
    return value.slice(0, 120)
  }
}

function isUsableImageDataUrl(value: string): boolean {
  const match = String(value || '').match(/^data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)$/i)
  if (!match) return false
  try {
    return atob(match[2]).length > 0
  } catch {
    return false
  }
}

function normalizeTimeoutMs(value: unknown, fallback: number): number {
  const numeric = Math.floor(Number(value))
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, numeric))
}

function normalizePollIntervalMs(value: unknown, fallback: number): number {
  const numeric = Math.floor(Number(value))
  if (!Number.isFinite(numeric) || numeric < 0) return fallback
  return Math.min(60_000, Math.max(0, numeric))
}

function normalizeMaxPollAttempts(value: unknown): number {
  if (value === undefined || value === null) return Number.POSITIVE_INFINITY
  const numeric = Math.floor(Number(value))
  if (!Number.isFinite(numeric)) return Number.POSITIVE_INFINITY
  return Math.max(0, numeric)
}

function createTimeoutError(timeoutMs: number) {
  const error = new Error(`Request timed out after ${timeoutMs}ms`) as Error & { code?: string; timeoutMs?: number }
  error.code = 'REQUEST_TIMEOUT'
  error.timeoutMs = timeoutMs
  return error
}

async function fetchImageModelWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  opts: ImageModelOptions,
  deadlineAt?: number,
): Promise<Response> {
  const timeoutMs = normalizeTimeoutMs(opts.timeoutMs, DEFAULT_IMAGE_REQUEST_TIMEOUT_MS)
  const retryCount = normalizeRetryCount(opts.retryCount, DEFAULT_IMAGE_RETRY_COUNT)
  const retryDelayMs = normalizeRetryDelayMs(opts.retryDelayMs, DEFAULT_IMAGE_RETRY_DELAY_MS)

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const attemptTimeoutMs = remainingTimeoutMs(deadlineAt, timeoutMs)
    let res: Response
    try {
      res = await fetchWithTimeout(input, init, attemptTimeoutMs)
    } catch (error) {
      if (!shouldRetryImageError(error, attempt, retryCount)) throw error
      await sleepWithinDeadline(retryDelayMs * (2 ** attempt), deadlineAt)
      continue
    }
    if (!shouldRetryImageResponse(res, attempt, retryCount)) return res
    await sleepWithinDeadline(retryDelayMs * (2 ** attempt), deadlineAt)
  }

  return fetchWithTimeout(input, init, remainingTimeoutMs(deadlineAt, timeoutMs))
}

function remainingTimeoutMs(deadlineAt: number | undefined, fallback: number): number {
  if (!deadlineAt) return fallback
  const remaining = deadlineAt - Date.now()
  if (remaining <= 0) throw createTimeoutError(fallback)
  return Math.min(fallback, Math.max(1, remaining))
}

async function sleepWithinDeadline(ms: number, deadlineAt?: number): Promise<void> {
  if (!deadlineAt) return sleep(ms)
  const remaining = deadlineAt - Date.now()
  if (remaining <= 0) throw createTimeoutError(ms)
  await sleep(Math.min(ms, remaining))
  if (Date.now() >= deadlineAt) throw createTimeoutError(ms)
}

function shouldRetryImageResponse(res: Response, attempt: number, retryCount: number): boolean {
  return attempt < retryCount && TRANSIENT_IMAGE_STATUSES.has(res.status)
}

function shouldRetryImageError(error: unknown, attempt: number, retryCount: number): boolean {
  if (attempt >= retryCount) return false
  if (isTimeoutError(error)) return true
  const message = String((error as { message?: string })?.message || '').toLowerCase()
  return /network|connection|fetch|socket|econnreset|etimedout/.test(message)
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
