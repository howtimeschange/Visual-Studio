import { basename, clamp, sanitizeFileName } from './shared.js'

const DEFAULT_EXPORT_PADDING = 40
const DEFAULT_TEXT_COLOR = '#111111'
const DEFAULT_FONT_NAME = 'ArialMT'
const DEFAULT_SPLIT_COLOR_COUNT = 10
const DEFAULT_SPLIT_MAX_SAMPLE_PIXELS = 180_000
const TRANSPARENT_CLUSTER = 255
const DEFAULT_ALPHA_SAMPLE_PIXELS = 220_000
const PSD_FONT_DESCRIPTOR = {
  name: DEFAULT_FONT_NAME,
  script: 0,
  type: 0,
  synthetic: 0,
}
const SEMANTIC_LAYER_PREFIX = {
  background: 'Background',
  subject: 'Subject',
  logo: 'Logo',
  decoration: 'Decoration',
  foreground: 'Foreground',
  effect: 'Effect',
  shadow: 'Shadow',
  object: 'Object',
}
const FONT_NAME_ALIASES = new Map([
  ['arial', 'ArialMT'],
  ['arialmt', 'ArialMT'],
  ['geist', 'ArialMT'],
  ['noto sans sc', 'ArialMT'],
  ['pingfang sc', 'ArialMT'],
  ['helvetica', 'ArialMT'],
  ['sans-serif', 'ArialMT'],
])
const SAFE_PSD_FONT_NAMES = new Set(['ArialMT'])
const SEMANTIC_LAYER_STACK_RANK = {
  background: 0,
  shadow: 10,
  subject: 40,
  object: 45,
  effect: 65,
  decoration: 70,
  logo: 80,
  foreground: 90,
}

export function chooseCanvasPsdBaseImage(elements = [], selectedIds = []) {
  const images = elements.filter(isExportableImageElement)
  if (!images.length) return null

  const selected = new Set(selectedIds || [])
  const selectedImage = images.find((el) => selected.has(el.id))
  if (selectedImage) return selectedImage

  return images
    .slice()
    .sort((a, b) => getImageOriginalArea(b) - getImageOriginalArea(a))[0] || null
}

export function getCanvasPsdExportFrame(elements = [], selectedIds = [], opts = {}) {
  const baseImage = chooseCanvasPsdBaseImage(elements, selectedIds)
  if (baseImage) {
    const original = getImageOriginalSize(baseImage)
    const displayWidth = positiveNumber(baseImage.width, original.width)
    const displayHeight = positiveNumber(baseImage.height, original.height)
    const scaleX = original.width / displayWidth
    const scaleY = original.height / displayHeight
    return {
      mode: 'base-image',
      baseElementId: baseImage.id || '',
      x: Number(baseImage.x) || 0,
      y: Number(baseImage.y) || 0,
      width: Math.max(1, Math.round(original.width)),
      height: Math.max(1, Math.round(original.height)),
      scale: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : (Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1),
    }
  }

  const bounds = getCanvasContentBounds(elements)
  if (!bounds) {
    return {
      mode: 'content-bounds',
      baseElementId: '',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      scale: 1,
    }
  }

  const padding = Math.max(0, Number(opts.padding ?? DEFAULT_EXPORT_PADDING) || 0)
  return {
    mode: 'content-bounds',
    baseElementId: '',
    x: Math.floor(bounds.left - padding),
    y: Math.floor(bounds.top - padding),
    width: Math.max(1, Math.ceil(bounds.right - bounds.left + padding * 2)),
    height: Math.max(1, Math.ceil(bounds.bottom - bounds.top + padding * 2)),
    scale: 1,
  }
}

export function mapCanvasElementToPsdRect(element, frame) {
  const scale = positiveNumber(frame?.scale, 1)
  const left = Math.round(((Number(element?.x) || 0) - (Number(frame?.x) || 0)) * scale)
  const top = Math.round(((Number(element?.y) || 0) - (Number(frame?.y) || 0)) * scale)
  const width = Math.max(1, Math.round(positiveNumber(element?.width, 1) * scale))
  const height = Math.max(1, Math.round(positiveNumber(element?.height, 1) * scale))
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }
}

export function createTextLayerDescriptor(element, frame) {
  const rect = mapCanvasElementToPsdRect(element, frame)
  const text = String(element?.content || '').trim() || 'Text'
  const fontSize = Math.max(1, Math.round((Number(element?.fontSize) || 16) * positiveNumber(frame?.scale, 1)))
  const fillColor = parsePsdColor(element?.color || element?.fill || DEFAULT_TEXT_COLOR)
  const font = createPsdFontDescriptor(element?.fontFamily)

  return {
    kind: 'text',
    name: createLayerName('Text', text),
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    text: {
      text,
      transform: [1, 0, 0, 1, rect.left, rect.top],
      shapeType: 'box',
      boxBounds: [0, 0, rect.width, rect.height],
      style: {
        font,
        fontSize,
        fillColor,
      },
      paragraphStyle: {
        justification: 'left',
      },
    },
    original: {
      id: element?.id || '',
      type: element?.type || 'text',
    },
  }
}

export function createOcrTextLayerDescriptor(item, index = 0) {
  const rect = normalizeOcrTextRect(item?.bbox || item?.box || item)
  const text = String(item?.text || item?.content || '').trim() || 'Text'
  const fontSize = Math.max(1, Math.round(Number(item?.fontSize) || Math.max(12, rect.height * 0.78)))
  const fillColor = parsePsdColor(item?.color || item?.fill || DEFAULT_TEXT_COLOR)
  const font = createPsdFontDescriptor(item?.fontFamily || item?.font)
  const justification = normalizePsdJustification(item?.align || item?.justification)
  const fauxBold = isBoldFontWeight(item?.fontWeight) || /bold/i.test(String(item?.style || ''))
  const fauxItalic = isItalicFontStyle(item?.fontStyle) || /italic/i.test(String(item?.style || ''))
  const label = `${String(index + 1).padStart(2, '0')} ${text}`

  return {
    kind: 'text',
    name: createLayerName('Text OCR', label),
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    text: {
      text,
      transform: [1, 0, 0, 1, rect.left, rect.top],
      shapeType: 'box',
      boxBounds: [0, 0, rect.width, rect.height],
      style: {
        font,
        fontSize,
        fillColor,
        fauxBold,
        fauxItalic,
      },
      paragraphStyle: {
        justification,
      },
      orientation: normalizePsdTextOrientation(item?.orientation),
    },
    original: {
      id: item?.id || `ocr-text-${index + 1}`,
      type: 'ocr-text',
      confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : undefined,
      bbox: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
    },
  }
}

export function createRasterLayerDescriptor(element, frame) {
  const rect = mapCanvasElementToPsdRect(element, frame)
  const isBaseImage = element?.type === 'image' && element?.id && element.id === frame?.baseElementId
  const layerRect = isBaseImage
    ? {
        left: 0,
        top: 0,
        width: Math.max(1, Math.round(Number(frame?.width) || rect.width)),
        height: Math.max(1, Math.round(Number(frame?.height) || rect.height)),
      }
    : rect
  const kind = getRasterKind(element)
  return {
    kind,
    name: createLayerName(getLayerPrefix(element), getLayerLabel(element)),
    source: element?.content || '',
    left: layerRect.left,
    top: layerRect.top,
    width: layerRect.width,
    height: layerRect.height,
    ...(isBaseImage ? { isBaseImage: true } : {}),
    original: {
      id: element?.id || '',
      type: element?.type || '',
    },
  }
}

export function createSemanticRasterLayerDescriptor(item, imageLayer, frame, index = 0) {
  const canvasWidth = Math.max(1, Math.round(Number(frame?.width) || Number(imageLayer?.width) || 1))
  const canvasHeight = Math.max(1, Math.round(Number(frame?.height) || Number(imageLayer?.height) || 1))
  const rect = normalizeSemanticLayerRect(item?.bbox || item?.box || item, canvasWidth, canvasHeight)
  if (!rect) return null

  const semanticType = normalizeSemanticLayerType(item?.type || item?.kind)
  const prefix = SEMANTIC_LAYER_PREFIX[semanticType] || SEMANTIC_LAYER_PREFIX.object
  const rawLabel = String(item?.name || item?.label || item?.description || semanticType || '').trim()
  const label = `${String(index + 1).padStart(2, '0')} ${rawLabel || prefix}`
  const zIndex = Number(item?.zIndex ?? item?.order)
  const confidence = Number(item?.confidence)

  return {
    kind: 'semantic-image',
    name: createLayerName(prefix, label),
    source: imageLayer?.source || '',
    sourceRect: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    },
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    original: {
      id: imageLayer?.original?.id || '',
      type: 'semantic-image',
      semanticType,
      description: String(item?.description || '').trim(),
      confidence: Number.isFinite(confidence) ? confidence : undefined,
      zIndex: Number.isFinite(zIndex) ? zIndex : index + 1,
      order: index,
    },
  }
}

export function createExtractedRasterLayerDescriptor(item, frame, index = 0) {
  const source = String(item?.dataUrl || item?.source || '').trim()
  if (!isImageDataUrl(source)) return null
  const semanticType = normalizeSemanticLayerType(item?.type || item?.kind)
  if (semanticType === 'background' || semanticType === 'text') return null
  const prefix = SEMANTIC_LAYER_PREFIX[semanticType] || SEMANTIC_LAYER_PREFIX.object
  const rawLabel = String(item?.name || item?.label || item?.description || semanticType || '').trim()
  const label = `${String(index + 1).padStart(2, '0')} ${rawLabel || prefix}`
  const bbox = normalizeSemanticLayerRect(item?.bbox || item?.box || item, frame?.width || 1, frame?.height || 1)
  const zIndex = Number(item?.zIndex ?? item?.order)
  const confidence = Number(item?.confidence)

  return {
    kind: 'image',
    name: createLayerName(prefix, label),
    source,
    left: 0,
    top: 0,
    width: Math.max(1, Math.round(Number(frame?.width) || 1)),
    height: Math.max(1, Math.round(Number(frame?.height) || 1)),
    original: {
      id: item?.id || `extracted-layer-${index + 1}`,
      type: 'extracted-image',
      semanticType,
      description: String(item?.description || '').trim(),
      confidence: Number.isFinite(confidence) ? confidence : undefined,
      zIndex: Number.isFinite(zIndex) ? zIndex : index + 1,
      order: index,
      bbox: bbox
        ? { x: bbox.left, y: bbox.top, width: bbox.width, height: bbox.height }
        : undefined,
    },
  }
}

export function createPsdBackgroundLayerDescriptor(backgroundLayer, fallbackLayer, frame) {
  const source = String(backgroundLayer?.dataUrl || backgroundLayer?.source || '').trim()
  if (isImageDataUrl(source)) {
    return {
      kind: 'image',
      name: createLayerName('', backgroundLayer?.name || 'Clean Background').trim(),
      source,
      left: 0,
      top: 0,
      width: Math.max(1, Math.round(Number(frame?.width) || 1)),
      height: Math.max(1, Math.round(Number(frame?.height) || 1)),
      original: {
        id: backgroundLayer?.id || 'clean-background',
        type: 'clean-background',
        repaired: backgroundLayer?.repaired !== false,
      },
    }
  }
  return fallbackLayer
}

export function buildCanvasPsdModel({ elements = [], selectedIds = [], title = 'canvas' } = {}) {
  const frame = getCanvasPsdExportFrame(elements, selectedIds)
  const layersBottomToTop = []
  const warnings = []

  for (const element of elements) {
    if (!isVisibleExportElement(element)) continue
    if (element.type === 'image-generator') {
      warnings.push('未生成的 AI 生图占位不会导出到 PSD。')
      continue
    }
    if (element.type === 'connector') continue

    const rect = mapCanvasElementToPsdRect(element, frame)
    const isBaseElement = element.id && element.id === frame.baseElementId
    if (!isBaseElement && !rectIntersectsFrame(rect, frame)) {
      continue
    }

    if (element.type === 'text') {
      layersBottomToTop.push(createTextLayerDescriptor(element, frame))
    } else {
      layersBottomToTop.push(createRasterLayerDescriptor(element, frame))
    }
  }

  return {
    width: frame.width,
    height: frame.height,
    frame,
    children: layersBottomToTop.reverse(),
    fileName: `${sanitizePsdFileName(title)}.psd`,
    warnings: [...new Set(warnings)],
  }
}

export function buildSelectedImagePsdModel({
  elements = [],
  imageId = '',
  title = 'canvas',
  ocrTextLayers = [],
  semanticLayers = [],
  extractedLayers = [],
  backgroundLayer = null,
} = {}) {
  const image = elements.find((element) => element?.type === 'image' && element.id === imageId)
  if (!isVisibleExportElement(image)) return null

  const frame = getCanvasPsdExportFrame([image], [image.id])
  const layer = {
    ...createRasterLayerDescriptor(image, frame),
    name: createLayerName('Original Image', getLayerLabel(image)),
  }
  const fileBase = basename(image.name || image.id || title) || title
  const textLayers = Array.isArray(ocrTextLayers)
    ? ocrTextLayers
        .filter((item) => String(item?.text || item?.content || '').trim())
        .map((item, index) => createOcrTextLayerDescriptor(item, index))
    : []
  const semanticRasterLayers = []
  const extractedRasterLayers = []
  if (Array.isArray(extractedLayers)) {
    for (const item of extractedLayers) {
      const descriptor = createExtractedRasterLayerDescriptor(item, frame, extractedRasterLayers.length)
      if (descriptor) extractedRasterLayers.push(descriptor)
    }
  }
  if (!extractedRasterLayers.length && Array.isArray(semanticLayers)) {
    for (const item of semanticLayers) {
      const type = normalizeSemanticLayerType(item?.type || item?.kind)
      if (type === 'background' || type === 'text') continue
      const descriptor = createSemanticRasterLayerDescriptor(item, layer, frame, semanticRasterLayers.length)
      if (descriptor) semanticRasterLayers.push(descriptor)
    }
  }
  semanticRasterLayers.sort(compareSemanticLayersTopToBottom)
  extractedRasterLayers.sort(compareSemanticLayersTopToBottom)
  const bottomLayer = createPsdBackgroundLayerDescriptor(backgroundLayer, layer, frame)
  const warnings = semanticRasterLayers.length && !extractedRasterLayers.length
    ? ['非文字语义层当前按识别区域裁切成独立图层；需要干净透明边缘时仍需进一步分割/蒙版。']
    : []
  if (extractedRasterLayers.length && bottomLayer === layer) {
    warnings.push('背景修补未生成，已用原图作为 PSD 底层。')
  }

  return {
    width: frame.width,
    height: frame.height,
    frame,
    image: bottomLayer,
    children: [...textLayers, ...(extractedRasterLayers.length ? extractedRasterLayers : semanticRasterLayers), bottomLayer],
    fileName: `${sanitizePsdFileName(fileBase)}.psd`,
    ocrTextLayerCount: textLayers.length,
    semanticLayerCount: extractedRasterLayers.length || semanticRasterLayers.length,
    extractedLayerCount: extractedRasterLayers.length,
    backgroundRepaired: bottomLayer?.original?.type === 'clean-background' && bottomLayer?.original?.repaired !== false,
    warnings,
  }
}

export function splitImageDataIntoColorClusters(imageData, opts = {}) {
  const width = Math.max(1, Math.round(Number(imageData?.width) || 0))
  const height = Math.max(1, Math.round(Number(imageData?.height) || 0))
  const data = imageData?.data
  if (!data || data.length < width * height * 4) {
    return { width, height, assignments: new Uint8Array(width * height).fill(TRANSPARENT_CLUSTER), clusters: [] }
  }

  const colorCount = clamp(Math.round(Number(opts.colorCount ?? DEFAULT_SPLIT_COLOR_COUNT) || DEFAULT_SPLIT_COLOR_COUNT), 2, 24)
  const alphaThreshold = clamp(Math.round(Number(opts.alphaThreshold ?? 1) || 1), 0, 255)
  const maxSamplePixels = Math.max(64, Math.round(Number(opts.maxSamplePixels ?? DEFAULT_SPLIT_MAX_SAMPLE_PIXELS) || DEFAULT_SPLIT_MAX_SAMPLE_PIXELS))
  const totalPixels = width * height
  const stride = Math.max(1, Math.ceil(totalPixels / maxSamplePixels))
  const sample = []

  for (let pixel = 0; pixel < totalPixels; pixel += stride) {
    const offset = pixel * 4
    if (data[offset + 3] <= alphaThreshold) continue
    sample.push([data[offset], data[offset + 1], data[offset + 2]])
  }

  if (!sample.length) {
    return { width, height, assignments: new Uint8Array(totalPixels).fill(TRANSPARENT_CLUSTER), clusters: [] }
  }

  const centers = chooseInitialColorCenters(sample, colorCount)
  refineColorCenters(sample, centers, Math.max(1, Math.round(Number(opts.iterations ?? 6) || 6)))

  const assignments = new Uint8Array(totalPixels)
  assignments.fill(TRANSPARENT_CLUSTER)
  const stats = centers.map((center, index) => ({
    index,
    count: 0,
    r: 0,
    g: 0,
    b: 0,
    left: width,
    top: height,
    right: 0,
    bottom: 0,
    color: { r: Math.round(center[0]), g: Math.round(center[1]), b: Math.round(center[2]) },
  }))

  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const offset = pixel * 4
    if (data[offset + 3] <= alphaThreshold) continue
    const best = nearestCenterIndex(data[offset], data[offset + 1], data[offset + 2], centers)
    assignments[pixel] = best
    const stat = stats[best]
    const x = pixel % width
    const y = Math.floor(pixel / width)
    stat.count += 1
    stat.r += data[offset]
    stat.g += data[offset + 1]
    stat.b += data[offset + 2]
    stat.left = Math.min(stat.left, x)
    stat.top = Math.min(stat.top, y)
    stat.right = Math.max(stat.right, x + 1)
    stat.bottom = Math.max(stat.bottom, y + 1)
  }

  const clusters = stats
    .filter((stat) => stat.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((stat, order) => {
      const color = {
        r: Math.round(stat.r / stat.count),
        g: Math.round(stat.g / stat.count),
        b: Math.round(stat.b / stat.count),
      }
      return {
        index: stat.index,
        order,
        name: `Color ${String(order + 1).padStart(2, '0')} ${colorToHex(color)}`,
        color,
        pixelCount: stat.count,
        left: stat.left,
        top: stat.top,
        right: stat.right,
        bottom: stat.bottom,
        width: stat.right - stat.left,
        height: stat.bottom - stat.top,
      }
    })

  return { width, height, assignments, clusters }
}

export function classifyPsdAlphaImageData(imageData, opts = {}) {
  const width = Math.max(1, Math.round(Number(imageData?.width) || 0))
  const height = Math.max(1, Math.round(Number(imageData?.height) || 0))
  const data = imageData?.data
  const totalPixels = width * height
  if (!data || data.length < totalPixels * 4) {
    return {
      hasRealAlpha: false,
      likelyCheckerboard: false,
      isUsableTransparentCutout: false,
      transparentPixelRatio: 0,
      sampledPixelCount: 0,
    }
  }

  const maxSamplePixels = Math.max(64, Math.round(Number(opts.maxSamplePixels ?? DEFAULT_ALPHA_SAMPLE_PIXELS) || DEFAULT_ALPHA_SAMPLE_PIXELS))
  const alphaThreshold = clamp(Math.round(Number(opts.alphaThreshold ?? 250) || 250), 0, 255)
  const clearAlphaThreshold = clamp(Math.round(Number(opts.clearAlphaThreshold ?? 8) || 8), 0, 255)
  const minTransparentRatio = Math.max(0, Number(opts.minTransparentRatio ?? 0.01) || 0)
  const stride = Math.max(1, Math.ceil(totalPixels / maxSamplePixels))
  let sampled = 0
  let alphaPixels = 0
  let clearPixels = 0
  let opaquePixels = 0
  let grayOpaquePixels = 0
  let minGray = 255
  let maxGray = 0

  for (let pixel = 0; pixel < totalPixels; pixel += stride) {
    const offset = pixel * 4
    const alpha = data[offset + 3]
    sampled += 1
    if (alpha < alphaThreshold) {
      alphaPixels += 1
      if (alpha <= clearAlphaThreshold) clearPixels += 1
      continue
    }

    opaquePixels += 1
    const r = data[offset]
    const g = data[offset + 1]
    const b = data[offset + 2]
    const channelSpread = Math.max(r, g, b) - Math.min(r, g, b)
    const gray = Math.round((r + g + b) / 3)
    if (channelSpread <= 8 && gray >= 180 && gray <= 255) {
      grayOpaquePixels += 1
      minGray = Math.min(minGray, gray)
      maxGray = Math.max(maxGray, gray)
    }
  }

  const transparentPixelRatio = sampled ? alphaPixels / sampled : 0
  const clearPixelRatio = sampled ? clearPixels / sampled : 0
  const opaquePixelRatio = sampled ? opaquePixels / sampled : 0
  const minTransparentPixels = Math.min(16, Math.max(1, Math.floor(sampled * 0.002)))
  const minOpaquePixels = Math.min(6, Math.max(1, Math.floor(sampled * 0.00005)))
  const hasRealAlpha = alphaPixels >= minTransparentPixels
    && (transparentPixelRatio >= minTransparentRatio || clearPixelRatio >= minTransparentRatio / 2)
  const hasOpaqueContent = opaquePixels >= minOpaquePixels
  const grayRatio = opaquePixels ? grayOpaquePixels / opaquePixels : 0
  const likelyCheckerboard = !hasRealAlpha
    && opaquePixels > 0
    && grayRatio >= 0.75
    && maxGray - minGray >= 16

  return {
    hasRealAlpha,
    likelyCheckerboard,
    isUsableTransparentCutout: hasRealAlpha && hasOpaqueContent,
    transparentPixelRatio,
    opaquePixelRatio,
    sampledPixelCount: sampled,
  }
}

export function repairPsdCheckerboardTransparency(imageData, opts = {}) {
  const width = Math.max(1, Math.round(Number(imageData?.width) || 0))
  const height = Math.max(1, Math.round(Number(imageData?.height) || 0))
  const sourceData = imageData?.data
  const totalPixels = width * height
  if (!sourceData || sourceData.length < totalPixels * 4) {
    return { imageData, changedPixelCount: 0 }
  }

  const data = new Uint8ClampedArray(sourceData)
  const visited = new Uint8Array(totalPixels)
  const queue = new Uint32Array(totalPixels)
  let head = 0
  let tail = 0

  const enqueue = (pixel) => {
    if (visited[pixel]) return
    const offset = pixel * 4
    if (!isCheckerboardBackgroundPixel(data, offset, opts)) return
    visited[pixel] = 1
    queue[tail] = pixel
    tail += 1
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }

  let changedPixelCount = 0
  while (head < tail) {
    const pixel = queue[head]
    head += 1
    const offset = pixel * 4
    if (data[offset + 3] !== 0) {
      data[offset + 3] = 0
      changedPixelCount += 1
    }

    const x = pixel % width
    if (x > 0) enqueue(pixel - 1)
    if (x < width - 1) enqueue(pixel + 1)
    if (pixel >= width) enqueue(pixel - width)
    if (pixel < totalPixels - width) enqueue(pixel + width)
  }

  return {
    imageData: createCompatibleImageData(data, width, height),
    changedPixelCount,
  }
}

export async function validatePsdExtractedLayers(extractedLayers = [], readImageData, opts = {}) {
  const sourceLayers = Array.isArray(extractedLayers) ? extractedLayers : []
  const validLayers = []
  const warnings = []
  if (!sourceLayers.length) return { extractedLayers: validLayers, warnings }
  if (typeof readImageData !== 'function') {
    return { extractedLayers: sourceLayers, warnings }
  }

  for (const layer of sourceLayers) {
    const label = String(layer?.name || layer?.label || layer?.description || '透明图层').replace(/\s+/g, ' ').trim()
    try {
      const imageData = await readImageData(layer)
      const alpha = classifyPsdAlphaImageData(imageData, opts)
      if (alpha.isUsableTransparentCutout) {
        validLayers.push(layer)
        continue
      }
      if (alpha.likelyCheckerboard && typeof opts.encodeImageData === 'function') {
        const repaired = repairPsdCheckerboardTransparency(imageData, opts)
        const repairedAlpha = classifyPsdAlphaImageData(repaired.imageData, opts)
        if (repaired.changedPixelCount > 0 && repairedAlpha.isUsableTransparentCutout) {
          const dataUrl = await opts.encodeImageData(repaired.imageData, layer)
          if (isImageDataUrl(dataUrl)) {
            validLayers.push({
              ...layer,
              dataUrl,
              source: dataUrl,
              alphaStatus: 'repaired',
            })
            warnings.push(`${label || '透明图层'} 返回了棋盘格假透明，已自动转换为真实 alpha。`)
            continue
          }
        }
      }
      const reason = alpha.likelyCheckerboard ? '疑似把棋盘格画进了图片' : '没有真实 alpha 透明区域'
      warnings.push(`${label || '透明图层'} 不是有效透明 PNG（${reason}），已跳过该图层。`)
    } catch (error) {
      warnings.push(`${label || '透明图层'} 无法验证透明通道，已跳过该图层。`)
    }
  }

  return { extractedLayers: validLayers, warnings }
}

function isCheckerboardBackgroundPixel(data, offset, opts = {}) {
  const alpha = data[offset + 3]
  if (alpha < clamp(Math.round(Number(opts.opaqueThreshold ?? 250) || 250), 0, 255)) return false
  const r = data[offset]
  const g = data[offset + 1]
  const b = data[offset + 2]
  const spread = Math.max(r, g, b) - Math.min(r, g, b)
  const gray = Math.round((r + g + b) / 3)
  const maxSpread = clamp(Math.round(Number(opts.checkerGraySpread ?? 12) || 12), 0, 64)
  const minGray = clamp(Math.round(Number(opts.checkerMinGray ?? 160) || 160), 0, 255)
  return spread <= maxSpread && gray >= minGray && gray <= 255
}

function createCompatibleImageData(data, width, height) {
  if (typeof ImageData === 'function') return new ImageData(data, width, height)
  return { width, height, data }
}

export function parsePsdColor(value) {
  const raw = String(value || '').trim()
  const hex = raw.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const body = hex[1]
    const full = body.length === 3
      ? body.split('').map((char) => `${char}${char}`).join('')
      : body
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    }
  }
  const rgb = raw.match(/^rgba?\(([^)]+)\)$/i)
  if (rgb) {
    const parts = rgb[1].split(',').map((part) => Number(part.trim())).filter(Number.isFinite)
    if (parts.length >= 3) {
      return {
        r: clamp(Math.round(parts[0]), 0, 255),
        g: clamp(Math.round(parts[1]), 0, 255),
        b: clamp(Math.round(parts[2]), 0, 255),
      }
    }
  }
  return { r: 17, g: 17, b: 17 }
}

function isExportableImageElement(element) {
  return element?.type === 'image' && (
    Boolean(element.content || element.assetId)
    || getImageOriginalArea(element) > 0
    || (positiveNumber(element.width, 0) > 0 && positiveNumber(element.height, 0) > 0)
  )
}

function isVisibleExportElement(element) {
  if (!element || element.visible === false) return false
  if (element.type === 'connector') return false
  if (element.type === 'image') return Boolean(element.content || element.assetId)
  return ['text', 'shape', 'path', 'image-generator'].includes(element.type)
}

function getImageOriginalSize(element) {
  const originalWidth = positiveNumber(element?.originalWidth, positiveNumber(element?.naturalWidth, 0))
  const originalHeight = positiveNumber(element?.originalHeight, positiveNumber(element?.naturalHeight, 0))
  if (originalWidth && originalHeight) {
    return { width: originalWidth, height: originalHeight }
  }
  return {
    width: positiveNumber(element?.width, 1),
    height: positiveNumber(element?.height, 1),
  }
}

function getImageOriginalArea(element) {
  const size = getImageOriginalSize(element)
  return size.width * size.height
}

function getCanvasContentBounds(elements = []) {
  const rects = elements
    .filter(isVisibleExportElement)
    .filter((element) => element.type !== 'image-generator')
    .map((element) => {
      const left = Number(element.x) || 0
      const top = Number(element.y) || 0
      return {
        left,
        top,
        right: left + positiveNumber(element.width, 1),
        bottom: top + positiveNumber(element.height, 1),
      }
    })
  if (!rects.length) return null
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  }
}

function rectIntersectsFrame(rect, frame) {
  const frameWidth = positiveNumber(frame?.width, 1)
  const frameHeight = positiveNumber(frame?.height, 1)
  return rect.right > 0
    && rect.bottom > 0
    && rect.left < frameWidth
    && rect.top < frameHeight
}

function positiveNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function normalizeOcrTextRect(bbox = {}) {
  const source = Array.isArray(bbox)
    ? { x: bbox[0], y: bbox[1], width: bbox[2], height: bbox[3] }
    : bbox
  const rawLeft = Number(source?.x ?? source?.left ?? 0)
  const rawTop = Number(source?.y ?? source?.top ?? 0)
  const left = Math.max(0, Math.round(Number.isFinite(rawLeft) ? rawLeft : 0))
  const top = Math.max(0, Math.round(Number.isFinite(rawTop) ? rawTop : 0))
  const right = Number(source?.right)
  const bottom = Number(source?.bottom)
  const rawWidth = Number(source?.width)
  const rawHeight = Number(source?.height)
  const width = Math.max(1, Math.round(Number.isFinite(rawWidth) && rawWidth > 0
    ? rawWidth
    : (Number.isFinite(right) ? right - left : 1)))
  const height = Math.max(1, Math.round(Number.isFinite(rawHeight) && rawHeight > 0
    ? rawHeight
    : (Number.isFinite(bottom) ? bottom - top : 1)))
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }
}

function normalizeSemanticLayerRect(bbox = {}, canvasWidth = 1, canvasHeight = 1) {
  const source = Array.isArray(bbox)
    ? { x: bbox[0], y: bbox[1], width: bbox[2], height: bbox[3] }
    : bbox
  const x = Number(source?.x ?? source?.left ?? 0)
  const y = Number(source?.y ?? source?.top ?? 0)
  const width = Number(source?.width)
  const height = Number(source?.height)
  const rightValue = Number(source?.right)
  const bottomValue = Number(source?.bottom)

  const rawLeft = Number.isFinite(x) ? x : 0
  const rawTop = Number.isFinite(y) ? y : 0
  const rawRight = Number.isFinite(width) && width > 0
    ? rawLeft + width
    : (Number.isFinite(rightValue) ? rightValue : rawLeft)
  const rawBottom = Number.isFinite(height) && height > 0
    ? rawTop + height
    : (Number.isFinite(bottomValue) ? bottomValue : rawTop)

  const left = clamp(Math.round(Math.min(rawLeft, rawRight)), 0, canvasWidth)
  const top = clamp(Math.round(Math.min(rawTop, rawBottom)), 0, canvasHeight)
  const right = clamp(Math.round(Math.max(rawLeft, rawRight)), 0, canvasWidth)
  const bottom = clamp(Math.round(Math.max(rawTop, rawBottom)), 0, canvasHeight)
  const clippedWidth = right - left
  const clippedHeight = bottom - top
  if (clippedWidth < 2 || clippedHeight < 2) return null

  return {
    left,
    top,
    width: clippedWidth,
    height: clippedHeight,
    right,
    bottom,
  }
}

function normalizeSemanticLayerType(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!raw) return 'object'
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

function compareSemanticLayersTopToBottom(a, b) {
  const zA = Number(a?.original?.zIndex)
  const zB = Number(b?.original?.zIndex)
  const orderA = Number(a?.original?.order)
  const orderB = Number(b?.original?.order)
  const rankA = getSemanticLayerStackRank(a)
  const rankB = getSemanticLayerStackRank(b)
  if (rankA !== rankB) return rankB - rankA
  const safeZA = Number.isFinite(zA) ? zA : 0
  const safeZB = Number.isFinite(zB) ? zB : 0
  if (safeZA !== safeZB) return safeZB - safeZA
  return (Number.isFinite(orderB) ? orderB : 0) - (Number.isFinite(orderA) ? orderA : 0)
}

function getSemanticLayerStackRank(layer) {
  const type = normalizeSemanticLayerType(layer?.original?.semanticType || layer?.type || layer?.kind)
  return SEMANTIC_LAYER_STACK_RANK[type] ?? SEMANTIC_LAYER_STACK_RANK.object
}

function normalizePsdJustification(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (['right', 'end'].includes(raw)) return 'right'
  if (['center', 'centre', 'middle'].includes(raw)) return 'center'
  if (raw.startsWith('justify')) return raw
  return 'left'
}

function normalizePsdTextOrientation(value) {
  return String(value || '').trim().toLowerCase() === 'vertical' ? 'vertical' : 'horizontal'
}

function isBoldFontWeight(value) {
  if (typeof value === 'number') return value >= 600
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return false
  if (raw === 'bold' || raw === 'bolder' || raw === 'heavy' || raw === 'black') return true
  const numeric = Number(raw)
  return Number.isFinite(numeric) && numeric >= 600
}

function isItalicFontStyle(value) {
  return /italic|oblique/i.test(String(value || ''))
}

function isImageDataUrl(value) {
  return /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(String(value || '').trim())
}

function getRasterKind(element) {
  if (element?.type === 'image') return 'image'
  if (element?.type === 'path') return 'path'
  return 'shape'
}

function getLayerPrefix(element) {
  if (element?.type === 'image') return 'Image'
  if (element?.type === 'path') return 'Path'
  if (element?.type === 'shape') return 'Shape'
  return 'Layer'
}

function getLayerLabel(element) {
  if (element?.type === 'image') return basename(element.name || element.id || 'image')
  if (element?.type === 'shape') return element.shape || element.shapeType || 'shape'
  if (element?.type === 'path') return element.name || element.id || 'path'
  return element?.id || 'layer'
}

function chooseInitialColorCenters(sample, colorCount) {
  const bins = new Map()
  for (const [r, g, b] of sample) {
    const key = `${r >> 3},${g >> 3},${b >> 3}`
    const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 }
    bin.count += 1
    bin.r += r
    bin.g += g
    bin.b += b
    bins.set(key, bin)
  }

  const candidates = [...bins.values()]
    .map((bin) => [bin.r / bin.count, bin.g / bin.count, bin.b / bin.count, bin.count])
    .sort((a, b) => b[3] - a[3])

  const centers = []
  if (candidates.length) centers.push(candidates[0].slice(0, 3))

  while (centers.length < colorCount && centers.length < candidates.length) {
    let bestCandidate = null
    let bestScore = -Infinity
    for (const candidate of candidates) {
      const distance = nearestCenterDistanceSq(candidate[0], candidate[1], candidate[2], centers)
      const score = distance * Math.sqrt(candidate[3])
      if (score > bestScore) {
        bestScore = score
        bestCandidate = candidate
      }
    }
    if (!bestCandidate) break
    centers.push(bestCandidate.slice(0, 3))
  }

  return centers.length ? centers : [[0, 0, 0]]
}

function refineColorCenters(sample, centers, iterations) {
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sums = centers.map(() => ({ count: 0, r: 0, g: 0, b: 0 }))
    for (const [r, g, b] of sample) {
      const index = nearestCenterIndex(r, g, b, centers)
      const sum = sums[index]
      sum.count += 1
      sum.r += r
      sum.g += g
      sum.b += b
    }
    for (let index = 0; index < centers.length; index += 1) {
      const sum = sums[index]
      if (!sum.count) continue
      centers[index] = [sum.r / sum.count, sum.g / sum.count, sum.b / sum.count]
    }
  }
}

function nearestCenterIndex(r, g, b, centers) {
  let best = 0
  let bestDistance = Infinity
  for (let index = 0; index < centers.length; index += 1) {
    const center = centers[index]
    const distance = colorDistanceSq(r, g, b, center[0], center[1], center[2])
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  return best
}

function nearestCenterDistanceSq(r, g, b, centers) {
  if (!centers.length) return Infinity
  let bestDistance = Infinity
  for (const center of centers) {
    bestDistance = Math.min(bestDistance, colorDistanceSq(r, g, b, center[0], center[1], center[2]))
  }
  return bestDistance
}

function colorDistanceSq(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  return dr * dr + dg * dg + db * db
}

function colorToHex(color) {
  const part = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`
}

function createLayerName(prefix, label) {
  const safe = String(label || '').replace(/\s+/g, ' ').trim()
  return `${prefix} ${safe || 'Layer'}`.slice(0, 120)
}

function createPsdFontDescriptor(fontFamily) {
  const name = normalizePsdFontName(fontFamily)
  return { ...PSD_FONT_DESCRIPTOR, name }
}

function normalizePsdFontName(fontFamily) {
  const raw = String(fontFamily || '').split(',')[0].replace(/["']/g, '').trim()
  if (!raw) return DEFAULT_FONT_NAME
  const aliased = FONT_NAME_ALIASES.get(raw.toLowerCase()) || raw.replace(/\s+/g, '')
  return SAFE_PSD_FONT_NAMES.has(aliased) ? aliased : DEFAULT_FONT_NAME
}

function sanitizePsdFileName(title) {
  const safe = sanitizeFileName(String(title || '').trim()) || 'canvas'
  return safe.replace(/\.psd$/i, '')
}
