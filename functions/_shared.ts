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
  VS_DB?: D1Database
  VS_INPUTS_BUCKET?: R2Bucket
  VS_RESULTS_BUCKET?: R2Bucket
  VS_TEMP_BUCKET?: R2Bucket
  VS_JOBS_QUEUE?: Queue<unknown>
}

export const DEFAULT_BASE = 'https://api.1xm.ai/v1'
export const VISION_MODEL = 'gemini-3-flash-preview'

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
  opts: { group?: string } = {},
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string; status: number }> {
  const content: any[] = images.map((img) => ({
    type: 'image_url',
    image_url: { url: `data:${img.mime};base64,${img.base64}` },
  }))
  content.push({
    type: 'text',
    text: modelName === 'gpt-image-2'
      ? `${prompt}\n\nGenerate image only. Do not return explanation text.`
      : prompt,
  })

  const payload = modelName === 'gpt-image-2'
    ? {
        model: modelName,
        messages: [{ role: 'user', content }],
        stream: false,
        ...(opts.group ? { group: opts.group } : {}),
      }
    : {
        model: modelName,
        messages: [{ role: 'user', content }],
        temperature: 0.2,
      }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const errBody = await res.text()
      return { ok: false, error: `Upstream ${res.status}: ${errBody.slice(0, 500)}`, status: res.status }
    }
    const data = await res.json<any>()
    const imageSource = extractImageFromResponse(data)
    const dataUrl = imageSource ? await coerceImageSourceToDataUrl(imageSource) : null
    if (!dataUrl) {
      return { ok: false, error: 'Model returned no image.', status: 502 }
    }
    return { ok: true, dataUrl }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'fetch failed', status: 502 }
  }
}

export async function callTextModel(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: any[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
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
    })
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

async function coerceImageSourceToDataUrl(source: string): Promise<string | null> {
  if (!source) return null
  if (source.startsWith('data:')) return source
  if (!/^https?:\/\//i.test(source)) return source

  try {
    const res = await fetch(source)
    if (!res.ok) return source
    const mime = normalizeImageMime(res.headers.get('content-type')) || guessMimeFromUrl(source) || 'image/png'
    const buffer = await res.arrayBuffer()
    return `data:${mime};base64,${arrayBufferToBase64(buffer)}`
  } catch {
    return source
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
