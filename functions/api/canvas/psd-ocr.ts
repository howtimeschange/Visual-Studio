import {
  Env, DEFAULT_BASE, VISION_MODEL, MODEL_MAP,
  json, corsPreflight, resolveKeys, resolveImageModelOptions, callImageModel, callTextModel,
} from '../../_shared'
import { requireAuth } from '../../_lib/auth'
import { mergeUserClientKeys } from '../../_lib/user-api-keys'
import { ensureSession, getAssetDataUrl } from '../../_lib/v2-store'

type CanvasPsdOcrText = {
  text: string
  bbox: { x: number; y: number; width: number; height: number }
  fontSize: number
  color: string
  align: 'left' | 'center' | 'right'
  fontFamily: string
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  orientation: 'horizontal' | 'vertical'
  confidence: number
}

type CanvasPsdSemanticLayer = {
  name: string
  type: 'background' | 'subject' | 'logo' | 'decoration' | 'foreground' | 'effect' | 'shadow' | 'object'
  bbox: { x: number; y: number; width: number; height: number }
  description: string
  confidence: number
  zIndex: number
}

type CanvasPsdOcrResult = {
  texts: CanvasPsdOcrText[]
  textCount: number
  semanticLayers: CanvasPsdSemanticLayer[]
  semanticLayerCount: number
  warnings: string[]
}

type CanvasPsdExtractedLayer = CanvasPsdSemanticLayer & {
  dataUrl: string
}

type CanvasPsdBackgroundLayer = {
  name: string
  dataUrl: string
  repaired: boolean
}

type CanvasPsdDecomposeResult = CanvasPsdOcrResult & {
  extractedLayers: CanvasPsdExtractedLayer[]
  extractedLayerCount: number
  backgroundLayer: CanvasPsdBackgroundLayer | null
}

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  try {
    const user = await requireAuth(env, request)
    const clientKeys = await mergeUserClientKeys(env, user.id, body?.clientKeys || {})
    return json(await analyzeCanvasPsdOcr(env, { ...body, clientKeys, _authUserId: user.id }))
  } catch (error: any) {
    return json({ error: String(error?.message || 'PSD OCR failed') }, error?.status || 502)
  }
}

export async function analyzeCanvasPsdOcr(env: Env, body: any): Promise<CanvasPsdOcrResult & { sessionId: string }> {
  const session = await ensureSession(env, body?.sessionId, body?._authUserId || null)
  const modelId = String(body?.modelId || 'nano-banana-2')
  const clientKeys = body?.clientKeys || {}
  const { visionKey } = resolveKeys(modelId, env, clientKeys)
  if (!visionKey) throw createError('缺少 Vision Key，无法识别 PSD 可编辑文字', 400)

  const image = await resolveOcrImage(env, body)
  const width = normalizeDimension(body?.width || image.width)
  const height = normalizeDimension(body?.height || image.height)
  if (!width || !height) throw createError('width and height required', 400)

  const raw = await callTextModel(
    env.RELAY_BASE_URL || DEFAULT_BASE,
    visionKey,
    VISION_MODEL,
    [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image.dataUrl } },
          { type: 'text', text: buildPsdOcrPrompt(width, height) },
        ],
      },
    ],
    { maxTokens: 4096, temperature: 0.1 },
  )

  if (!raw) throw createError('OCR 未返回结果', 502)
  const parsed = parseJsonObject(raw)
  if (!parsed) throw createError('OCR 返回格式无法解析', 502)

  return {
    sessionId: session.id,
    ...normalizeCanvasPsdOcrResult(parsed, width, height),
  }
}

export async function decomposeCanvasPsdImage(env: Env, body: any): Promise<CanvasPsdDecomposeResult & { sessionId: string }> {
  const session = await ensureSession(env, body?.sessionId, body?._authUserId || null)
  const modelId = String(body?.modelId || 'nano-banana-2')
  const clientKeys = body?.clientKeys || {}
  const { visionKey, genKey } = resolveKeys(modelId, env, clientKeys)
  if (!visionKey) throw createError('缺少 Vision Key，无法分析 PSD 图层', 400)
  if (!MODEL_MAP[modelId]) throw createError(`Unknown modelId: ${modelId}`, 400)
  if (!genKey) throw createError(`Missing API key for ${modelId}`, 400)

  const image = await resolveOcrImage(env, body)
  const width = normalizeDimension(body?.width || image.width)
  const height = normalizeDimension(body?.height || image.height)
  if (!width || !height) throw createError('width and height required', 400)

  const analysis = await analyzeCanvasPsdImage(env, {
    ...body,
    sessionId: session.id,
    dataUrl: image.dataUrl,
    assetId: '',
    width,
    height,
    clientKeys,
    _authUserId: body?._authUserId || null,
  })
  const source = splitDataUrl(image.dataUrl)
  if (!source) throw createError('dataUrl must be an image data URL', 400)

  const baseUrl = env.RELAY_BASE_URL || DEFAULT_BASE
  const imageModelOptions = resolveImageModelOptions(modelId, env, clientKeys)
  imageModelOptions.size = buildImageModelSize(width, height)
  imageModelOptions.quality = 'high'
  const warnings: string[] = []
  const extractedLayers: CanvasPsdExtractedLayer[] = []
  const targets = analysis.semanticLayers
    .filter((layer) => layer.type !== 'background')
    .sort((a, b) => b.zIndex - a.zIndex)
    .slice(0, normalizeLayerLimit(body?.maxLayers))

  for (const layer of targets) {
    const prompt = buildCutoutPrompt(layer, width, height)
    const result = await callImageModel(
      baseUrl,
      genKey,
      MODEL_MAP[modelId],
      [source],
      prompt,
      imageModelOptions,
    )
    if (result.ok && isImageDataUrl(result.dataUrl)) {
      extractedLayers.push({ ...layer, dataUrl: result.dataUrl })
    } else {
      warnings.push(`${layer.name} 透明图层生成失败：${result.ok ? '模型未返回图片' : result.error}`)
    }
  }

  let backgroundLayer: CanvasPsdBackgroundLayer | null = null
  const backgroundPrompt = buildCleanBackgroundPrompt(targets, analysis.texts, width, height)
  const backgroundResult = await callImageModel(
    baseUrl,
    genKey,
    MODEL_MAP[modelId],
    [source],
    backgroundPrompt,
    imageModelOptions,
  )
  if (backgroundResult.ok && isImageDataUrl(backgroundResult.dataUrl)) {
    backgroundLayer = {
      name: 'Clean Background',
      dataUrl: backgroundResult.dataUrl,
      repaired: true,
    }
  } else {
    warnings.push(`背景修补失败，PSD 将使用原图底层：${backgroundResult.ok ? '模型未返回图片' : backgroundResult.error}`)
  }

  return {
    sessionId: session.id,
    ...normalizeCanvasPsdDecomposeResult({
      analysis,
      extractedLayers,
      backgroundLayer,
      warnings: [...analysis.warnings, ...warnings],
    }, width, height),
  }
}

async function analyzeCanvasPsdImage(env: Env, body: any): Promise<CanvasPsdOcrResult> {
  const modelId = String(body?.modelId || 'nano-banana-2')
  const clientKeys = body?.clientKeys || {}
  const { visionKey } = resolveKeys(modelId, env, clientKeys)
  if (!visionKey) throw createError('缺少 Vision Key，无法分析 PSD 图层', 400)

  const image = await resolveOcrImage(env, body)
  const width = normalizeDimension(body?.width || image.width)
  const height = normalizeDimension(body?.height || image.height)
  if (!width || !height) throw createError('width and height required', 400)

  const raw = await callTextModel(
    env.RELAY_BASE_URL || DEFAULT_BASE,
    visionKey,
    VISION_MODEL,
    [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image.dataUrl } },
          { type: 'text', text: buildPsdOcrPrompt(width, height) },
        ],
      },
    ],
    { maxTokens: 4096, temperature: 0.1 },
  )

  if (!raw) throw createError('PSD 图层分析未返回结果', 502)
  const parsed = parseJsonObject(raw)
  if (!parsed) throw createError('PSD 图层分析返回格式无法解析', 502)
  return normalizeCanvasPsdOcrResult(parsed, width, height)
}

export function normalizeCanvasPsdOcrResult(raw: any, width: number, height: number): CanvasPsdOcrResult {
  const canvasWidth = normalizeDimension(width) || 1
  const canvasHeight = normalizeDimension(height) || 1
  const sourceTexts = Array.isArray(raw?.texts) ? raw.texts : []
  const texts = sourceTexts
    .map((item) => normalizeOcrTextItem(item, canvasWidth, canvasHeight))
    .filter((item): item is CanvasPsdOcrText => Boolean(item))
  const sourceSemanticLayers = Array.isArray(raw?.semanticLayers)
    ? raw.semanticLayers
    : (Array.isArray(raw?.layers) ? raw.layers : [])
  const semanticLayers = sourceSemanticLayers
    .map((item, index) => normalizeSemanticLayerItem(item, index, canvasWidth, canvasHeight))
    .filter((item): item is CanvasPsdSemanticLayer => Boolean(item))
    .sort((a, b) => a.zIndex - b.zIndex)
    .slice(0, 12)

  return {
    texts,
    textCount: texts.length,
    semanticLayers,
    semanticLayerCount: semanticLayers.length,
    warnings: Array.isArray(raw?.warnings)
      ? raw.warnings.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 5)
      : [],
  }
}

export function normalizeCanvasPsdDecomposeResult(raw: any, width: number, height: number): CanvasPsdDecomposeResult {
  const analysis = normalizeCanvasPsdOcrResult(raw?.analysis || raw, width, height)
  const canvasWidth = normalizeDimension(width) || 1
  const canvasHeight = normalizeDimension(height) || 1
  const sourceExtracted = Array.isArray(raw?.extractedLayers) ? raw.extractedLayers : []
  const extractedLayers = sourceExtracted
    .map((item, index) => normalizeExtractedLayerItem(item, index, canvasWidth, canvasHeight))
    .filter((item): item is CanvasPsdExtractedLayer => Boolean(item))
    .sort((a, b) => a.zIndex - b.zIndex)
    .slice(0, 12)
  const backgroundLayer = normalizeBackgroundLayer(raw?.backgroundLayer)
  const warnings = [
    ...(analysis.warnings || []),
    ...(Array.isArray(raw?.warnings)
      ? raw.warnings.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : []),
  ].slice(0, 8)

  return {
    ...analysis,
    extractedLayers,
    extractedLayerCount: extractedLayers.length,
    backgroundLayer,
    warnings: [...new Set(warnings)],
  }
}

function normalizeOcrTextItem(item: any, canvasWidth: number, canvasHeight: number): CanvasPsdOcrText | null {
  const text = String(item?.text || item?.content || item?.original || '').replace(/\s+/g, ' ').trim()
  if (!text) return null

  const bbox = normalizeBbox(item?.bbox || item?.box || item, canvasWidth, canvasHeight)
  if (!bbox) return null

  return {
    text,
    bbox,
    fontSize: normalizeFontSize(item?.fontSize || item?.size, bbox.height),
    color: normalizeHexColor(item?.color || item?.fillColor || item?.fill),
    align: normalizeAlign(item?.align || item?.justification),
    fontFamily: normalizeFontFamily(item?.fontFamily || item?.font),
    fontWeight: normalizeFontWeight(item?.fontWeight || item?.weight || item?.style),
    fontStyle: normalizeFontStyle(item?.fontStyle || item?.style),
    orientation: String(item?.orientation || '').trim().toLowerCase() === 'vertical' ? 'vertical' : 'horizontal',
    confidence: normalizeConfidence(item?.confidence),
  }
}

function normalizeSemanticLayerItem(item: any, index: number, canvasWidth: number, canvasHeight: number): CanvasPsdSemanticLayer | null {
  const type = normalizeSemanticLayerType(item?.type || item?.kind || item?.role)
  if (type === 'text') return null

  const bbox = normalizeBbox(item?.bbox || item?.box || item, canvasWidth, canvasHeight)
  if (!bbox) return null

  const minUsefulArea = Math.max(16, Math.round(canvasWidth * canvasHeight * 0.00005))
  if (bbox.width * bbox.height < minUsefulArea) return null

  return {
    name: normalizeSemanticLayerName(item?.name || item?.label || item?.title, type, index),
    type,
    bbox,
    description: String(item?.description || item?.prompt || item?.maskHint || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    confidence: normalizeConfidence(item?.confidence),
    zIndex: normalizeZIndex(item?.zIndex ?? item?.order, type, index),
  }
}

function normalizeExtractedLayerItem(item: any, index: number, canvasWidth: number, canvasHeight: number): CanvasPsdExtractedLayer | null {
  const base = normalizeSemanticLayerItem(item, index, canvasWidth, canvasHeight)
  if (!base || base.type === 'background') return null
  const dataUrl = String(item?.dataUrl || item?.source || '').trim()
  if (!isImageDataUrl(dataUrl)) return null
  return {
    ...base,
    dataUrl,
  }
}

function normalizeBackgroundLayer(item: any): CanvasPsdBackgroundLayer | null {
  const dataUrl = String(item?.dataUrl || item?.source || '').trim()
  if (!isImageDataUrl(dataUrl)) return null
  return {
    name: String(item?.name || 'Clean Background').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Clean Background',
    dataUrl,
    repaired: item?.repaired !== false,
  }
}

function normalizeBbox(raw: any, canvasWidth: number, canvasHeight: number): CanvasPsdOcrText['bbox'] | null {
  const source = Array.isArray(raw)
    ? { x: raw[0], y: raw[1], width: raw[2], height: raw[3] }
    : raw
  const x = numberOr(source?.x ?? source?.left, 0)
  const y = numberOr(source?.y ?? source?.top, 0)
  const width = numberOr(source?.width, numberOr(source?.right, 0) - x)
  const height = numberOr(source?.height, numberOr(source?.bottom, 0) - y)

  const left = clampNumber(Math.round(x), 0, canvasWidth)
  const top = clampNumber(Math.round(y), 0, canvasHeight)
  const right = clampNumber(Math.round(x + width), 0, canvasWidth)
  const bottom = clampNumber(Math.round(y + height), 0, canvasHeight)
  const clippedWidth = right - left
  const clippedHeight = bottom - top
  if (clippedWidth < 2 || clippedHeight < 2) return null

  return {
    x: left,
    y: top,
    width: clippedWidth,
    height: clippedHeight,
  }
}

function buildPsdOcrPrompt(width: number, height: number): string {
  return `你是 PSD 导出专用 OCR、版式重建与图层规划助手。

目标：把单张 AI 图片规划成一个更可编辑的 PSD：
1. 识别图片中所有可读文字，输出可用于 Photoshop 可编辑文字层的 texts。
2. 规划 4-12 个有设计意义的语义 raster 图层，输出 semanticLayers。不要做颜色聚类，不要把细碎笔画/噪点拆成层。

坐标要求：
- 图片原始像素尺寸是 ${width}x${height}。
- bbox 必须使用原始图片像素坐标，不要用百分比。
- bbox = { "x": 左上角, "y": 左上角, "width": 文本框宽度, "height": 文本框高度 }。
- 尽量按完整词组/短句合并，不要把同一行拆成单字。

文字重建要求：
- fontSize 用像素估算真实字号。
- color 用 #RRGGBB。
- align 只能是 left、center、right。
- fontWeight 只能是 normal、bold。
- fontStyle 只能是 normal、italic。
- orientation 只能是 horizontal、vertical。
- fontFamily 如果无法判断就用空字符串。

语义图层规划要求：
- semanticLayers 用于把原图裁切成可移动的 PSD raster 层；请按「背景、主体/人物/产品、Logo/徽章、装饰、前景光效/阴影」合并成少量有编辑价值的层。
- type 只能是 background、subject、logo、decoration、foreground、effect、shadow、object、text；文字不要放进 semanticLayers，放进 texts。
- background 通常用整张图 bbox。
- 主体/产品/人物的 bbox 要覆盖完整对象，宁可略大，不要裁边。
- 同一对象的细节应合并成一个层，例如“人物和手持道具”“产品和阴影”“一组装饰星星”。
- zIndex 表示从底到顶的视觉顺序：背景 0，主体 20-60，前景/徽章/光效 60-100。

只输出 JSON，不要 markdown，不要解释：
{
  "texts": [
    {
      "text": "原文",
      "bbox": { "x": 0, "y": 0, "width": 100, "height": 40 },
      "fontSize": 32,
      "color": "#111111",
      "align": "left",
      "fontFamily": "",
      "fontWeight": "normal",
      "fontStyle": "normal",
      "orientation": "horizontal",
      "confidence": 0.9
    }
  ],
  "semanticLayers": [
    {
      "name": "Background",
      "type": "background",
      "bbox": { "x": 0, "y": 0, "width": ${width}, "height": ${height} },
      "description": "base scene behind the main subject",
      "confidence": 0.8,
      "zIndex": 0
    },
    {
      "name": "Main subject",
      "type": "subject",
      "bbox": { "x": 120, "y": 180, "width": 520, "height": 760 },
      "description": "primary product/person/object as one movable layer",
      "confidence": 0.8,
      "zIndex": 40
    }
  ],
  "warnings": []
}`
}

async function resolveOcrImage(env: Env, body: any): Promise<{ dataUrl: string; width: number; height: number }> {
  const dataUrl = String(body?.dataUrl || '').trim()
  if (dataUrl) {
    const parsed = splitDataUrl(dataUrl)
    if (!parsed) throw createError('dataUrl must be an image data URL', 400)
    return {
      dataUrl,
      width: normalizeDimension(body?.width),
      height: normalizeDimension(body?.height),
    }
  }

  const assetId = String(body?.assetId || '').trim()
  if (!assetId) throw createError('dataUrl or assetId required', 400)
  const assetDataUrl = await getAssetDataUrl(env, assetId)
  if (!assetDataUrl) throw createError(`Asset not found: ${assetId}`, 404)
  return {
    dataUrl: assetDataUrl,
    width: normalizeDimension(body?.width),
    height: normalizeDimension(body?.height),
  }
}

function parseJsonObject(raw: string | null): any {
  if (!raw) return null
  const text = raw.trim()
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

function splitDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const match = String(dataUrl).match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/)
  return match ? { mime: match[1], base64: match[2] } : null
}

function isImageDataUrl(value: unknown): boolean {
  return /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(String(value || '').trim())
}

function normalizeDimension(value: unknown): number {
  const number = Math.round(Number(value) || 0)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function normalizeFontSize(value: unknown, fallbackHeight: number): number {
  const number = Math.round(Number(value) || 0)
  if (Number.isFinite(number) && number > 0) return clampNumber(number, 6, 512)
  return clampNumber(Math.round(fallbackHeight * 0.78), 6, 512)
}

function normalizeHexColor(value: unknown): string {
  if (value && typeof value === 'object') {
    const color = value as Record<string, unknown>
    return rgbToHex(color.r, color.g, color.b)
  }
  const raw = String(value || '').trim()
  const hex = raw.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const body = hex[1]
    const full = body.length === 3
      ? body.split('').map((char) => `${char}${char}`).join('')
      : body
    return `#${full.toLowerCase()}`
  }
  const rgb = raw.match(/^rgba?\(([^)]+)\)$/i)
  if (rgb) {
    const parts = rgb[1].split(',').map((part) => Number(part.trim()))
    if (parts.length >= 3) return rgbToHex(parts[0], parts[1], parts[2])
  }
  return '#111111'
}

function rgbToHex(r: unknown, g: unknown, b: unknown): string {
  const part = (value: unknown) => clampNumber(Math.round(Number(value) || 0), 0, 255).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

function normalizeAlign(value: unknown): CanvasPsdOcrText['align'] {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'right' || raw === 'end') return 'right'
  if (raw === 'center' || raw === 'centre' || raw === 'middle') return 'center'
  return 'left'
}

function normalizeFontFamily(value: unknown): string {
  return String(value || '').replace(/["']/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

function normalizeFontWeight(value: unknown): CanvasPsdOcrText['fontWeight'] {
  const raw = String(value || '').trim().toLowerCase()
  const number = Number(raw)
  return raw.includes('bold') || raw.includes('heavy') || raw.includes('black') || (Number.isFinite(number) && number >= 600)
    ? 'bold'
    : 'normal'
}

function normalizeFontStyle(value: unknown): CanvasPsdOcrText['fontStyle'] {
  return /italic|oblique/i.test(String(value || '')) ? 'italic' : 'normal'
}

function normalizeSemanticLayerType(value: unknown): CanvasPsdSemanticLayer['type'] | 'text' {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (['background', 'backdrop', 'base', 'scene'].includes(raw)) return 'background'
  if (['subject', 'main_subject', 'person', 'people', 'character', 'product', 'hero', 'foreground_subject'].includes(raw)) return 'subject'
  if (['logo', 'brand', 'mark', 'wordmark'].includes(raw)) return 'logo'
  if (['decoration', 'decorative', 'badge', 'sticker', 'ornament', 'shape', 'icon'].includes(raw)) return 'decoration'
  if (['foreground', 'front'].includes(raw)) return 'foreground'
  if (['effect', 'light', 'lighting', 'glow', 'sparkle'].includes(raw)) return 'effect'
  if (['shadow', 'reflection'].includes(raw)) return 'shadow'
  if (['text', 'ocr_text', 'title', 'headline', 'body'].includes(raw)) return 'text'
  return 'object'
}

function normalizeSemanticLayerName(value: unknown, type: CanvasPsdSemanticLayer['type'], index: number): string {
  const raw = String(value || '').replace(/\s+/g, ' ').trim()
  if (raw) return raw.slice(0, 80)
  const fallback: Record<CanvasPsdSemanticLayer['type'], string> = {
    background: 'Background',
    subject: 'Main subject',
    logo: 'Logo',
    decoration: 'Decoration',
    foreground: 'Foreground',
    effect: 'Effect',
    shadow: 'Shadow',
    object: 'Object',
  }
  return `${fallback[type] || 'Object'} ${index + 1}`.slice(0, 80)
}

function normalizeZIndex(value: unknown, type: CanvasPsdSemanticLayer['type'], index: number): number {
  const number = Math.round(Number(value))
  if (Number.isFinite(number)) return clampNumber(number, 0, 1000)
  const fallback: Record<CanvasPsdSemanticLayer['type'], number> = {
    background: 0,
    shadow: 12,
    subject: 40,
    object: 45,
    logo: 70,
    decoration: 75,
    effect: 85,
    foreground: 90,
  }
  return (fallback[type] ?? 50) + index
}

function normalizeLayerLimit(value: unknown): number {
  const number = Math.round(Number(value) || 0)
  return Number.isFinite(number) && number > 0 ? clampNumber(number, 1, 6) : 5
}

function buildImageModelSize(width: number, height: number): string {
  const w = clampNumber(Math.round(width / 16) * 16, 16, 3840)
  const h = clampNumber(Math.round(height / 16) * 16, 16, 3840)
  const pixels = w * h
  if (pixels < 655_360 || pixels > 8_294_400 || Math.max(w, h) / Math.min(w, h) > 3) return 'auto'
  return `${w}x${h}`
}

function buildCutoutPrompt(layer: CanvasPsdSemanticLayer, width: number, height: number): string {
  return `Create a transparent PNG cutout layer for PSD decomposition.

Canvas: ${width}x${height}px. Preserve the original canvas size exactly.
Target layer: ${layer.name}
Type: ${layer.type}
Bounding box: x=${layer.bbox.x}, y=${layer.bbox.y}, width=${layer.bbox.width}, height=${layer.bbox.height}
Description: ${layer.description || layer.name}

Output requirements:
- Return only the selected target object/effect as a PNG with alpha transparency.
- Keep the object in its exact original pixel position on a full ${width}x${height} transparent canvas.
- Everything outside this target must be transparent.
- Preserve original pixels, colors, shadows, antialiasing, and edge softness as much as possible.
- Do not add text, labels, background, borders, or explanations.`
}

function buildCleanBackgroundPrompt(layers: CanvasPsdSemanticLayer[], texts: CanvasPsdOcrText[], width: number, height: number): string {
  const removeItems = [
    ...layers.map((layer) =>
      `${layer.name} (${layer.type}) bbox x=${layer.bbox.x}, y=${layer.bbox.y}, w=${layer.bbox.width}, h=${layer.bbox.height}`),
    ...texts.map((text) =>
      `Raster text "${text.text}" bbox x=${text.bbox.x}, y=${text.bbox.y}, w=${text.bbox.width}, h=${text.bbox.height}`),
  ]
  const removeList = removeItems.length
    ? removeItems.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : 'No foreground objects or raster text were confidently identified.'
  return `Create a clean repaired background layer for PSD decomposition.

Canvas: ${width}x${height}px. Preserve the original canvas size exactly.
Remove these foreground/overlay elements and inpaint the missing areas naturally:
${removeList}

Output requirements:
- Return a full ${width}x${height} PNG background image.
- The removed areas should be filled with plausible background texture, lighting, gradients, or scenery.
- Do not include the removed subjects, products, logos, text, badges, decorations, or foreground effects.
- Preserve the original style and color palette.
- Do not add explanations, labels, or borders.`
}

function normalizeConfidence(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? clampNumber(number, 0, 1) : 0
}

function numberOr(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function createError(message: string, status = 502) {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  return error
}
