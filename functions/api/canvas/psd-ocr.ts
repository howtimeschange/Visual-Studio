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

type CanvasPsdCutoutResult = { ok: true; dataUrl: string } | { ok: false; error: string; status?: number }

const DEFAULT_PSD_CUTOUT_CONCURRENCY = 2
const DEFAULT_SEMANTIC_LAYER_LIMIT = 12
const MIN_TARGET_AREA_RATIO = 0.001
const SEMANTIC_GROUP_TYPES = new Set<CanvasPsdSemanticLayer['type']>([
  'decoration',
  'effect',
  'shadow',
  'foreground',
])
const EXTRACTION_TYPE_SCORE: Record<CanvasPsdSemanticLayer['type'], number> = {
  background: 0,
  shadow: 20,
  effect: 32,
  decoration: 38,
  foreground: 52,
  object: 62,
  logo: 72,
  subject: 100,
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
  const targets = selectCanvasPsdExtractionTargets(analysis.semanticLayers, normalizeLayerLimit(body?.maxLayers), width, height)
  const cutoutJobs = runCanvasPsdCutoutJobs(targets, (layer) => {
    const prompt = buildCutoutPrompt(layer, width, height)
    return callImageModel(
      baseUrl,
      genKey,
      MODEL_MAP[modelId],
      [source],
      prompt,
      imageModelOptions,
    )
  }, { concurrency: normalizeCutoutConcurrency(body?.layerConcurrency || body?.concurrency) })

  const backgroundPrompt = buildCleanBackgroundPrompt(targets, analysis.texts, width, height)
  const backgroundJob = callImageModel(
    baseUrl,
    genKey,
    MODEL_MAP[modelId],
    [source],
    backgroundPrompt,
    imageModelOptions,
  )

  const [cutoutResult, backgroundResult] = await Promise.all([cutoutJobs, backgroundJob])
  const warnings: string[] = [...cutoutResult.warnings]
  let backgroundLayer: CanvasPsdBackgroundLayer | null = null
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
      extractedLayers: cutoutResult.extractedLayers,
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
    .reduce((layers, layer) => mergeSemanticLayerIntoPlan(layers, layer, canvasWidth, canvasHeight), [] as CanvasPsdSemanticLayer[])
    .sort((a, b) => a.zIndex - b.zIndex)
    .slice(0, DEFAULT_SEMANTIC_LAYER_LIMIT)

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

export function selectCanvasPsdExtractionTargets(
  semanticLayers: CanvasPsdSemanticLayer[] = [],
  maxLayers = 5,
  width = 1,
  height = 1,
): CanvasPsdSemanticLayer[] {
  const canvasArea = Math.max(1, normalizeDimension(width) * normalizeDimension(height))
  const limit = normalizeLayerLimit(maxLayers)
  const seenTypes = new Set<CanvasPsdSemanticLayer['type']>()
  const candidates = semanticLayers
    .filter((layer) => layer?.type !== 'background')
    .filter((layer) => {
      const area = Math.max(0, Number(layer?.bbox?.width) || 0) * Math.max(0, Number(layer?.bbox?.height) || 0)
      const areaRatio = area / canvasArea
      if (areaRatio >= MIN_TARGET_AREA_RATIO) return true
      return ['subject', 'logo', 'object'].includes(layer?.type)
    })
    .map((layer, index) => {
      const area = Math.max(0, Number(layer.bbox.width) || 0) * Math.max(0, Number(layer.bbox.height) || 0)
      const areaRatio = area / canvasArea
      const typeScore = EXTRACTION_TYPE_SCORE[layer.type] || EXTRACTION_TYPE_SCORE.object
      const areaScore = Math.min(18, Math.sqrt(Math.max(0, areaRatio)) * 32)
      const confidenceScore = normalizeConfidence(layer.confidence) * 12
      const zScore = clampNumber(Number(layer.zIndex) || 0, 0, 100) / 20
      return {
        layer,
        index,
        score: typeScore + areaScore + confidenceScore + zScore,
      }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.index - b.index
    })

  const targets: CanvasPsdSemanticLayer[] = []
  for (const candidate of candidates) {
    if (targets.length >= limit) break
    if (candidate.layer.type !== 'subject' && seenTypes.has(candidate.layer.type)) continue
    targets.push(candidate.layer)
    seenTypes.add(candidate.layer.type)
  }
  return targets
}

export async function runCanvasPsdCutoutJobs(
  layers: CanvasPsdSemanticLayer[] = [],
  runLayer: (layer: CanvasPsdSemanticLayer, index: number) => Promise<CanvasPsdCutoutResult>,
  opts: { concurrency?: number } = {},
): Promise<{ extractedLayers: CanvasPsdExtractedLayer[]; warnings: string[] }> {
  const sourceLayers = Array.isArray(layers) ? layers : []
  const concurrency = normalizeCutoutConcurrency(opts.concurrency)
  const results: Array<CanvasPsdExtractedLayer | null> = new Array(sourceLayers.length).fill(null)
  const warnings: string[] = []
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < sourceLayers.length) {
      const index = nextIndex
      nextIndex += 1
      const layer = sourceLayers[index]
      try {
        const result = await runLayer(layer, index)
        if (result.ok && isImageDataUrl(result.dataUrl)) {
          results[index] = { ...layer, dataUrl: result.dataUrl }
        } else {
          warnings.push(`${layer.name} 透明图层生成失败：${result.ok ? '模型未返回图片' : result.error}`)
        }
      } catch (error: any) {
        warnings.push(`${layer.name} 透明图层生成失败：${String(error?.message || error || '未知错误')}`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, sourceLayers.length) }, () => worker()))
  return {
    extractedLayers: results.filter((layer): layer is CanvasPsdExtractedLayer => Boolean(layer)),
    warnings,
  }
}

function mergeSemanticLayerIntoPlan(
  layers: CanvasPsdSemanticLayer[],
  layer: CanvasPsdSemanticLayer,
  canvasWidth: number,
  canvasHeight: number,
): CanvasPsdSemanticLayer[] {
  const existingIndex = layers.findIndex((candidate) => shouldMergeSemanticLayers(candidate, layer))
  if (existingIndex < 0) return [...layers, layer]

  const existing = layers[existingIndex]
  const merged = mergeSemanticLayers(existing, layer, canvasWidth, canvasHeight)
  return layers.map((candidate, index) => (index === existingIndex ? merged : candidate))
}

function shouldMergeSemanticLayers(a: CanvasPsdSemanticLayer, b: CanvasPsdSemanticLayer): boolean {
  if (!a || !b || a.type !== b.type) return false
  if (a.type === 'background') return true
  if (SEMANTIC_GROUP_TYPES.has(a.type)) return true
  if (a.type === 'subject') return true
  if (a.type === 'object') return bboxesOverlapOrNearlyTouch(a.bbox, b.bbox, 0.2)
  if (a.type === 'logo') return bboxesOverlapOrNearlyTouch(a.bbox, b.bbox, 0.45)
  return false
}

function mergeSemanticLayers(
  a: CanvasPsdSemanticLayer,
  b: CanvasPsdSemanticLayer,
  canvasWidth: number,
  canvasHeight: number,
): CanvasPsdSemanticLayer {
  const raw = unionBbox(a.bbox, b.bbox)
  const bbox = a.type === 'background'
    ? clampBbox(raw, canvasWidth, canvasHeight)
    : expandBbox(raw, canvasWidth, canvasHeight, semanticLayerPadding(raw, a.type))
  return {
    name: createMergedSemanticLayerName(a, b),
    type: a.type,
    bbox,
    description: mergeDescriptions(a.description, b.description),
    confidence: Math.max(normalizeConfidence(a.confidence), normalizeConfidence(b.confidence)),
    zIndex: Math.round((a.zIndex + b.zIndex) / 2),
  }
}

function createMergedSemanticLayerName(a: CanvasPsdSemanticLayer, b: CanvasPsdSemanticLayer): string {
  const fallback: Record<CanvasPsdSemanticLayer['type'], string> = {
    background: 'Background',
    subject: 'Main subject',
    logo: 'Logo',
    decoration: 'Decorations',
    foreground: 'Foreground',
    effect: 'Effects',
    shadow: 'Shadows',
    object: 'Objects',
  }
  if (a.type === 'subject' || SEMANTIC_GROUP_TYPES.has(a.type) || a.type === 'object') {
    return fallback[a.type]
  }
  const first = String(a.name || '').trim()
  const second = String(b.name || '').trim()
  if (!first) return second || fallback[a.type]
  if (!second || first === second) return first
  return `${first} + ${second}`.slice(0, 80)
}

function mergeDescriptions(a: string, b: string): string {
  const parts = [a, b].map((item) => String(item || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  return [...new Set(parts)].join('; ').slice(0, 240)
}

function unionBbox(
  a: CanvasPsdSemanticLayer['bbox'],
  b: CanvasPsdSemanticLayer['bbox'],
): CanvasPsdSemanticLayer['bbox'] {
  const left = Math.min(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}

function semanticLayerPadding(
  bbox: CanvasPsdSemanticLayer['bbox'],
  type: CanvasPsdSemanticLayer['type'],
): { x: number; y: number } {
  const baseX = type === 'decoration' || type === 'effect'
    ? Math.max(20, Math.round(bbox.width * 0.025))
    : Math.max(10, Math.round(bbox.width * 0.04))
  const baseY = type === 'decoration' || type === 'effect'
    ? Math.max(20, Math.round(bbox.height * 0.18))
    : Math.max(12, Math.round(bbox.height * 0.03))
  return { x: baseX, y: baseY }
}

function expandBbox(
  bbox: CanvasPsdSemanticLayer['bbox'],
  canvasWidth: number,
  canvasHeight: number,
  padding: { x: number; y: number },
): CanvasPsdSemanticLayer['bbox'] {
  return clampBbox({
    x: bbox.x - padding.x,
    y: bbox.y - padding.y,
    width: bbox.width + padding.x * 2,
    height: bbox.height + padding.y * 2,
  }, canvasWidth, canvasHeight)
}

function clampBbox(
  bbox: CanvasPsdSemanticLayer['bbox'],
  canvasWidth: number,
  canvasHeight: number,
): CanvasPsdSemanticLayer['bbox'] {
  const left = clampNumber(Math.round(bbox.x), 0, canvasWidth)
  const top = clampNumber(Math.round(bbox.y), 0, canvasHeight)
  const right = clampNumber(Math.round(bbox.x + bbox.width), left + 1, canvasWidth)
  const bottom = clampNumber(Math.round(bbox.y + bbox.height), top + 1, canvasHeight)
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}

function bboxesOverlapOrNearlyTouch(
  a: CanvasPsdSemanticLayer['bbox'],
  b: CanvasPsdSemanticLayer['bbox'],
  toleranceRatio: number,
): boolean {
  const tolerance = Math.max(8, Math.min(
    Math.max(a.width, a.height),
    Math.max(b.width, b.height),
  ) * toleranceRatio)
  return !(
    a.x + a.width + tolerance < b.x
    || b.x + b.width + tolerance < a.x
    || a.y + a.height + tolerance < b.y
    || b.y + b.height + tolerance < a.y
  )
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

function normalizeCutoutConcurrency(value: unknown): number {
  const number = Math.round(Number(value) || 0)
  return Number.isFinite(number) && number > 0
    ? clampNumber(number, 1, 3)
    : DEFAULT_PSD_CUTOUT_CONCURRENCY
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
