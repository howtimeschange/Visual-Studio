type AiTestDirection = {
  key: string
  label: string
  weightText: string
}

type AiTestTemplateVersion = {
  templateId: string
  versionId: string
  version: number
  title: string
  promptBody: string
  negativePrompt: string
  directions: AiTestDirection[]
  variables: string[]
}

type AiTestCategoryFactor = {
  categoryKey: string
  categoryLabel: string
  factorText: string
}

type AiTestFields = {
  categoryKey: string
  modelProfile: string
  pose: string
  background: string
  productColor: string
  sellingPoint: string
}

type NormalizedAiTestImage = {
  assetId: string
  label: string
  index: number
}

type NormalizedAiTestRow = {
  imageAssetId: string
  directionKey: string
  direction?: AiTestDirection
  prompt: string
}

type NormalizedAiTestRequest = {
  sessionId?: string
  modelId: string
  aspectRatio: string
  resolution: string
  templateVersionId?: string
  count: number
  concurrency: number
  images: NormalizedAiTestImage[]
  rows: NormalizedAiTestRow[]
  fields: AiTestFields
}

type AiTestExpandedItem = {
  image: NormalizedAiTestImage
  imageIndex: number
  groupIndex: number
  groupTotal: number
  direction: AiTestDirection
  prompt: string
  modelId: string
  aspectRatio: string
  resolution: string
  templateVersionId?: string
}

const TEXT_LIMITS = {
  sessionId: 120,
  templateVersionId: 120,
  categoryKey: 80,
  modelProfile: 180,
  pose: 180,
  background: 220,
  productColor: 100,
  sellingPoint: 260,
  modelId: 80,
  aspectRatio: 24,
  resolution: 24,
  imageAssetId: 180,
  imageLabel: 120,
  prompt: 6000,
  directionKey: 80,
  directionLabel: 120,
  directionWeightText: 600,
}

const MAX_AI_TEST_IMAGES = 20
const MAX_AI_TEST_TOTAL_ITEMS = 120
const DEFAULT_NEGATIVE_PROMPT = '不要出现：畸形五官、畸形手指、肢体扭曲、头身比例异常、低清晰度、噪点、文字水印、品牌 Logo 错乱、衣服结构错误、颜色严重偏差、面料质感丢失、成人化性感表达、危险动作、背景杂乱、商品被遮挡、参考图款式被改造。'

export const DEFAULT_AI_TEST_DIRECTIONS: AiTestDirection[] = [
  { key: 'scene', label: '场景主导', weightText: '加权倾斜真实穿着场景、生活氛围和背景叙事，让环境成为第一点击理由。' },
  { key: 'model', label: '模特主导', weightText: '加权倾斜模特年龄感、阳光元气、表情感染力和自然童真状态。' },
  { key: 'selling_point', label: '卖点主导', weightText: '加权倾斜商品功能卖点、版型优势和用户一眼能理解的购买理由。' },
  { key: 'pose', label: '姿势角度主导', weightText: '加权倾斜动作姿态、身体角度、抓拍动势和跑跳中的自然活力。' },
  { key: 'color', label: '产品颜色主导', weightText: '加权倾斜衣服选色、面料层次和颜色准确度，保证主推色醒目不偏色。' },
  { key: 'composition', label: '构图主导', weightText: '加权倾斜拍摄构图、商品主体占比、留白节奏和电商缩略图识别度。' },
]

export const DEFAULT_AI_TEST_TEMPLATE: AiTestTemplateVersion = {
  templateId: 'ai_test_children_main_image',
  versionId: 'ai_test_children_main_image_v1',
  version: 1,
  title: '童装电商主图 AI 测图默认模板',
  promptBody: [
    '你是一名资深童装电商主图视觉导演，请基于参考产品图生成一张高点击率 AI 测图。',
    '',
    '【拍摄构图】电商主图构图，主体清晰完整，商品占比充足，画面适合 {{aspectRatio}}，保留适度呼吸感和可点击的第一视觉焦点。',
    '【原图锁死】严格保持参考图里的服装款式、版型、结构、口袋、腰头、裤脚、面料肌理和细节比例，不要改款，不要增删商品部件。',
    '【模特锁定】{{modelProfile}}，童装模特表达自然健康，年龄感准确，不成人化，表情阳光亲和。',
    '【动作姿态】{{pose}}，动作自然可信，能看清商品正面或关键卖点，身体比例真实。',
    '【背景环境】{{background}}，背景干净，服务商品表达，不抢主体。',
    '【衣服选色】主推 {{productColor}}，颜色准确稳定，面料质感清晰，不偏色不过曝。',
    '【卖点文案】画面重点表达 {{sellingPoint}}，不生成真实文字，不添加促销字样，用视觉细节体现卖点。',
    '【全局光影】柔和自然商业摄影光，肤色健康，阴影干净，商品轮廓明确。',
    '【画质规格】{{resolution}} 清晰度，高清精修质感，适合童装电商主图测试，主体锐利，细节干净。',
    '【加权倾斜】{{directionLabel}}：{{directionWeightText}}',
    '【品类高点击因子】{{categoryLabel}}：{{categoryFactor}}',
    '【测图组别】第 {{groupIndex}} / {{groupTotal}} 组，当前测试方向：{{directionLabel}}',
  ].join('\n'),
  negativePrompt: DEFAULT_NEGATIVE_PROMPT,
  directions: DEFAULT_AI_TEST_DIRECTIONS,
  variables: [
    'aspectRatio',
    'resolution',
    'modelProfile',
    'pose',
    'background',
    'productColor',
    'sellingPoint',
    'directionLabel',
    'directionWeightText',
    'categoryLabel',
    'categoryFactor',
    'groupIndex',
    'groupTotal',
  ],
}

export const DEFAULT_AI_TEST_CATEGORY_FACTORS: Record<string, AiTestCategoryFactor> = {
  tshirt: {
    categoryKey: 'tshirt',
    categoryLabel: 'T恤',
    factorText: '突出亲肤棉感、领口不勒脖、童趣图案、夏日清爽和日常百搭。',
  },
  pants: {
    categoryKey: 'pants',
    categoryLabel: '裤装',
    factorText: '突出中大童男童，阳光元气，侧身跳跃抓拍，纯白极简背景，藏青色，弹力腰头，高腰护肚，膝部活动不束缚。',
  },
  dress: {
    categoryKey: 'dress',
    categoryLabel: '连衣裙',
    factorText: '突出甜美裙摆、轻盈转身、舒适里衬、节日出片感和精致但不过度成人化。',
  },
  set: {
    categoryKey: 'set',
    categoryLabel: '套装',
    factorText: '突出上下装成套省心搭配、整体色系统一、校园通勤和运动休闲多场景。',
  },
  outerwear: {
    categoryKey: 'outerwear',
    categoryLabel: '外套',
    factorText: '突出挺括版型、防风保暖、拉链口袋细节、层次穿搭和户外活动安全感。',
  },
  down_cotton: {
    categoryKey: 'down_cotton',
    categoryLabel: '羽绒/棉服',
    factorText: '突出蓬松保暖、轻量不臃肿、防钻绒或锁温细节、冬季户外活力和包裹安全感。',
  },
  hoodie_knit: {
    categoryKey: 'hoodie_knit',
    categoryLabel: '卫衣/针织',
    factorText: '突出软糯手感、宽松舒适、连帽或罗纹细节、校园运动感和秋冬叠穿氛围。',
  },
  shorts: {
    categoryKey: 'shorts',
    categoryLabel: '短裤',
    factorText: '突出透气轻薄、弹力腰头、跑跳不束缚、夏日户外和清爽腿部比例。',
  },
  onesie: {
    categoryKey: 'onesie',
    categoryLabel: '连体衣',
    factorText: '突出婴幼儿柔软包裹、换尿布便利、无骨缝舒适、萌趣造型和安全亲肤。',
  },
  shoes: {
    categoryKey: 'shoes',
    categoryLabel: '童鞋',
    factorText: '突出防滑鞋底、轻便回弹、包头保护、跑跳稳定和校园运动场景。',
  },
  home_underwear_swim: {
    categoryKey: 'home_underwear_swim',
    categoryLabel: '家居/内衣/泳装',
    factorText: '突出亲肤舒适、无感缝线、安全包覆、居家自在或泳池活力场景，表达健康自然。',
  },
}

export function clampCount(value: unknown, min = 1, max = 60, defaultValue = 6): number {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return defaultValue
  return Math.min(max, Math.max(min, Math.trunc(numberValue)))
}

export function normalizeAiTestRequest(body: Record<string, unknown> = {}): NormalizedAiTestRequest {
  const rawFields = isRecord(body.fields) ? body.fields : {}
  const fields: AiTestFields = {
    categoryKey: cleanText(rawFields.categoryKey ?? body.categoryKey ?? body.category, TEXT_LIMITS.categoryKey) || 'tshirt',
    modelProfile: cleanText(rawFields.modelProfile ?? body.modelProfile ?? body.modelFeature, TEXT_LIMITS.modelProfile),
    pose: cleanText(rawFields.pose ?? body.pose, TEXT_LIMITS.pose),
    background: cleanText(rawFields.background ?? body.background, TEXT_LIMITS.background),
    productColor: cleanText(rawFields.productColor ?? body.productColor ?? body.color, TEXT_LIMITS.productColor),
    sellingPoint: cleanText(rawFields.sellingPoint ?? body.sellingPoint, TEXT_LIMITS.sellingPoint),
  }
  const sessionId = cleanText(body.sessionId, TEXT_LIMITS.sessionId)
  const templateVersionId = cleanText(body.templateVersionId, TEXT_LIMITS.templateVersionId)
  const images = normalizeImages(body.images)
  const normalized: NormalizedAiTestRequest = {
    ...(sessionId ? { sessionId } : {}),
    modelId: cleanText(body.modelId ?? body.model, TEXT_LIMITS.modelId) || 'gpt-image-2',
    aspectRatio: cleanText(body.aspectRatio, TEXT_LIMITS.aspectRatio) || '1:1',
    resolution: cleanText(body.resolution, TEXT_LIMITS.resolution).toLowerCase() || '1k',
    ...(templateVersionId ? { templateVersionId } : {}),
    count: clampCount(body.count, 1, 60, 6),
    concurrency: clampCount(body.concurrency, 1, 10, 10),
    images,
    rows: [],
    fields,
  }
  normalized.rows = normalizeRows(body.rows, normalized.images)
  return normalized
}

export function expandAiTestItems(
  request: Record<string, unknown> | NormalizedAiTestRequest,
  template: AiTestTemplateVersion = DEFAULT_AI_TEST_TEMPLATE,
  categoryFactor?: AiTestCategoryFactor,
): AiTestExpandedItem[] {
  const normalized = isNormalizedRequest(request) ? request : normalizeAiTestRequest(request)
  if (normalized.images.length === 0) {
    throw new Error('AI test images required')
  }
  const effectiveCount = Math.max(
    1,
    Math.min(normalized.count, Math.floor(MAX_AI_TEST_TOTAL_ITEMS / normalized.images.length)),
  )
  const directions = normalizeDirections(template.directions)
  const factor = normalizeCategoryFactor(categoryFactor)
    || DEFAULT_AI_TEST_CATEGORY_FACTORS[normalized.fields.categoryKey]
    || fallbackCategoryFactor(normalized.fields.categoryKey)
  const items: AiTestExpandedItem[] = []
  const normalizedRows = Array.isArray(normalized.rows) ? normalized.rows : []
  if (normalizedRows.length > 0) {
    const imageByAssetId = new Map(normalized.images.map((image) => [image.assetId, image]))
    const rowTotals = new Map<string, number>()
    for (const row of normalizedRows) {
      if (!imageByAssetId.has(row.imageAssetId)) continue
      rowTotals.set(row.imageAssetId, (rowTotals.get(row.imageAssetId) || 0) + 1)
    }
    const rowIndexes = new Map<string, number>()
    for (const [rowIndex, row] of normalizedRows.entries()) {
      const image = imageByAssetId.get(row.imageAssetId)
      if (!image) continue
      const groupIndex = (rowIndexes.get(row.imageAssetId) || 0) + 1
      rowIndexes.set(row.imageAssetId, groupIndex)
      const groupTotal = rowTotals.get(row.imageAssetId) || groupIndex
      const direction = resolveRowDirection(row, directions, rowIndex)
      items.push({
        image,
        imageIndex: image.index,
        groupIndex,
        groupTotal,
        direction,
        prompt: row.prompt || renderAiTestPrompt({
          template,
          fields: normalized.fields,
          categoryFactor: factor,
          direction,
          groupIndex,
          groupTotal,
          aspectRatio: normalized.aspectRatio,
          resolution: normalized.resolution,
        }),
        modelId: normalized.modelId,
        aspectRatio: normalized.aspectRatio,
        resolution: normalized.resolution,
        templateVersionId: normalized.templateVersionId || template.versionId,
      })
    }
    return items.slice(0, MAX_AI_TEST_TOTAL_ITEMS)
  }

  for (const image of normalized.images) {
    for (let index = 0; index < effectiveCount; index += 1) {
      const direction = directions[index % directions.length]
      const groupIndex = index + 1
      items.push({
        image,
        imageIndex: image.index,
        groupIndex,
        groupTotal: effectiveCount,
        direction,
        prompt: renderAiTestPrompt({
          template,
          fields: normalized.fields,
          categoryFactor: factor,
          direction,
          groupIndex,
          groupTotal: effectiveCount,
          aspectRatio: normalized.aspectRatio,
          resolution: normalized.resolution,
        }),
        modelId: normalized.modelId,
        aspectRatio: normalized.aspectRatio,
        resolution: normalized.resolution,
        templateVersionId: normalized.templateVersionId || template.versionId,
      })
    }
  }
  return items
}

export function renderAiTestPrompt(input: {
  template?: AiTestTemplateVersion
  fields: AiTestFields
  categoryFactor?: AiTestCategoryFactor
  direction: AiTestDirection
  groupIndex: number
  groupTotal: number
  aspectRatio?: string
  resolution?: string
}): string {
  const template = input.template || DEFAULT_AI_TEST_TEMPLATE
  const categoryFactor = normalizeCategoryFactor(input.categoryFactor)
    || DEFAULT_AI_TEST_CATEGORY_FACTORS[input.fields.categoryKey]
    || fallbackCategoryFactor(input.fields.categoryKey)
  const prompt = replaceTemplateVariables(template.promptBody, {
    categoryKey: input.fields.categoryKey,
    categoryLabel: categoryFactor.categoryLabel,
    categoryFactor: categoryFactor.factorText,
    modelProfile: input.fields.modelProfile,
    modelFeature: input.fields.modelProfile,
    pose: input.fields.pose,
    background: input.fields.background,
    productColor: input.fields.productColor,
    color: input.fields.productColor,
    sellingPoint: input.fields.sellingPoint,
    directionKey: input.direction.key,
    directionLabel: input.direction.label,
    directionWeightText: input.direction.weightText,
    weightText: input.direction.weightText,
    groupIndex: String(input.groupIndex),
    groupTotal: String(input.groupTotal),
    count: String(input.groupTotal),
    aspectRatio: cleanText(input.aspectRatio, TEXT_LIMITS.aspectRatio) || '1:1',
    resolution: cleanText(input.resolution, TEXT_LIMITS.resolution).toLowerCase() || '1k',
  }).trim()
  const negativePrompt = cleanText(template.negativePrompt, 4000)
  return negativePrompt ? `${prompt}\n\n${negativePrompt}` : prompt
}

function normalizeImages(images: unknown): NormalizedAiTestImage[] {
  if (!Array.isArray(images)) return []
  const normalized: NormalizedAiTestImage[] = []
  for (const image of images) {
    if (normalized.length >= MAX_AI_TEST_IMAGES) break
    if (!isRecord(image)) continue
    const assetId = cleanText(image.assetId, TEXT_LIMITS.imageAssetId)
    if (!assetId) continue
    const rawIndex = Number(image.index)
    normalized.push({
      assetId,
      label: cleanText(image.label, TEXT_LIMITS.imageLabel) || assetId,
      index: Number.isFinite(rawIndex) && rawIndex > 0 ? Math.trunc(rawIndex) : normalized.length + 1,
    })
  }
  return normalized
}

function normalizeDirections(directions: unknown): AiTestDirection[] {
  if (!Array.isArray(directions) || directions.length === 0) return DEFAULT_AI_TEST_DIRECTIONS
  const normalized = directions
    .map((direction) => {
      if (!isRecord(direction)) return null
      const key = cleanText(direction.key, 80)
      const label = cleanText(direction.label, 120)
      const weightText = cleanText(direction.weightText, 600)
      return key && label ? { key, label, weightText } : null
    })
    .filter((direction): direction is AiTestDirection => Boolean(direction))
  return normalized.length > 0 ? normalized : DEFAULT_AI_TEST_DIRECTIONS
}

function normalizeRows(rows: unknown, images: NormalizedAiTestImage[]): NormalizedAiTestRow[] {
  if (!Array.isArray(rows) || rows.length === 0) return []
  const imageAssetIds = new Set(images.map((image) => image.assetId))
  const normalized: NormalizedAiTestRow[] = []
  for (const row of rows) {
    if (normalized.length >= MAX_AI_TEST_TOTAL_ITEMS) break
    if (!isRecord(row)) continue
    const nestedImage = isRecord(row.image) ? row.image : {}
    const imageAssetId = cleanText(
      row.imageAssetId ?? row.assetId ?? nestedImage.assetId,
      TEXT_LIMITS.imageAssetId,
    )
    if (!imageAssetId || !imageAssetIds.has(imageAssetId)) continue
    const directionSource = isRecord(row.direction) ? row.direction : {}
    const direction = normalizeOptionalDirection(directionSource)
    const directionKey = cleanText(
      row.directionKey ?? directionSource.key ?? direction?.key,
      TEXT_LIMITS.directionKey,
    )
    normalized.push({
      imageAssetId,
      directionKey,
      ...(direction ? { direction } : {}),
      prompt: cleanPromptText(row.prompt ?? row.finalPrompt ?? row.promptOverride, TEXT_LIMITS.prompt),
    })
  }
  return normalized
}

function normalizeOptionalDirection(direction: unknown): AiTestDirection | null {
  if (!isRecord(direction)) return null
  const key = cleanText(direction.key, TEXT_LIMITS.directionKey)
  const label = cleanText(direction.label, TEXT_LIMITS.directionLabel)
  const weightText = cleanText(direction.weightText || direction.weight || direction.description, TEXT_LIMITS.directionWeightText)
  if (!key || !label) return null
  return { key, label, weightText }
}

function resolveRowDirection(row: NormalizedAiTestRow, directions: AiTestDirection[], rowIndex: number): AiTestDirection {
  const byKey = row.directionKey
    ? directions.find((direction) => direction.key === row.directionKey)
    : null
  if (byKey) return byKey
  if (row.direction) return row.direction
  return directions[rowIndex % directions.length]
}

function normalizeCategoryFactor(factor: unknown): AiTestCategoryFactor | null {
  if (!isRecord(factor)) return null
  const categoryKey = cleanText(factor.categoryKey, 80)
  const categoryLabel = cleanText(factor.categoryLabel, 120)
  const factorText = cleanText(factor.factorText, 1000)
  if (!categoryKey || !factorText) return null
  return {
    categoryKey,
    categoryLabel: categoryLabel || categoryKey,
    factorText,
  }
}

function fallbackCategoryFactor(categoryKey: string): AiTestCategoryFactor {
  return {
    categoryKey,
    categoryLabel: categoryKey,
    factorText: '',
  }
}

function replaceTemplateVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) => variables[name] ?? '')
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function cleanPromptText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, maxLength)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNormalizedRequest(request: Record<string, unknown> | NormalizedAiTestRequest): request is NormalizedAiTestRequest {
  return isRecord(request)
    && isRecord(request.fields)
    && Array.isArray(request.images)
    && typeof request.modelId === 'string'
    && typeof request.count === 'number'
}
