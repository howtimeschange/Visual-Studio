import {
  Env, DEFAULT_BASE, VISION_MODEL,
  json, corsPreflight, resolveKeys, callTextModel,
} from '../../_shared'
import { getAuthContext } from '../../_lib/auth'
import { mergeUserClientKeys } from '../../_lib/user-api-keys'
import { ensureSession } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

type AgentMode = 'plan' | 'generate' | 'refine' | 'analyze'

type StyleIntent = {
  category: string
  medium: string
  visualLanguage: string
  reason: string
}

type AgentResult = {
  reply: string
  shouldGenerate: boolean
  prompt: string
  mode: AgentMode
  steps: string[]
  suggestions: string[]
  needsClarification: boolean
  styleIntent: StyleIntent
}

const DEFAULT_STYLE_INTENT: StyleIntent = {
  category: 'adaptive_visual',
  medium: 'mixed',
  visualLanguage: 'purpose-led visual language',
  reason: '根据用户需求选择合适的视觉语言',
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const auth = await getAuthContext(env, request)
  const session = await ensureSession(env, body?.sessionId, auth.user?.id || null)
  const message = String(body?.message || '').trim()
  if (!message) return json({ error: 'message required' }, 400)

  const modelId = String(body?.modelId || 'nano-banana-2')
  const baseUrl = env.RELAY_BASE_URL || DEFAULT_BASE
  const clientKeys = await mergeUserClientKeys(env, auth.user?.id || null, body?.clientKeys || {})
  const { visionKey } = resolveKeys(modelId, env, clientKeys)
  const fallback = buildFallbackAgentResult(body, message)

  if (!visionKey) {
    return json({ sessionId: session.id, ...fallback, usedModel: false })
  }

  const raw = await callTextModel(
    baseUrl,
    visionKey,
    VISION_MODEL,
    [
      {
        role: 'system',
        content: `You are the Canvas AI Designer Agent, an adaptive visual prompt designer for a creative image canvas.
You behave like Lovart-style ChatCanvas: read the user's message and canvas context, identify the design intent, choose an appropriate visual language, decide whether to generate now, and produce a concise design response.

Return strict JSON only:
{
  "reply": "Chinese reply shown in chat",
  "shouldGenerate": true,
  "prompt": "English image-generation prompt if shouldGenerate is true, otherwise empty",
  "mode": "plan|generate|refine|analyze",
  "steps": ["short Chinese step", "..."],
  "suggestions": ["complete Chinese follow-up prompt users can click", "..."],
  "needsClarification": false,
  "styleIntent": {
    "category": "ecommerce_product|campaign_poster|social_post|editorial_photography|illustration|packaging|three_d_render|infographic|art_concept|other",
    "medium": "photography|illustration|3d_render|graphic_design|mixed|undecided",
    "visualLanguage": "short English visual style label",
    "reason": "short Chinese reason"
  }
}

Rules:
- If the user asks for analysis, advice, planning, critique, or project organization and says not to generate, set shouldGenerate=false.
- If the user asks to create, generate, make, extend, redraw, or produce a poster/image, set shouldGenerate=true.
- First classify the request type: ecommerce main image, campaign poster, social post, editorial photography, illustration, packaging, 3D render, infographic/UI, art concept, or other.
- Choose a distinct visual language from the user's words, canvas context, references, and purpose. Do not default to ecommerce styling unless the user explicitly asks for ecommerce, product listing, main image, white background, marketplace, SKU, or product detail visuals.
- Avoid unsupported default phrases such as "clean background", "ecommerce-ready", "polished commercial", "centered product", or "soft studio lighting" unless the user specifically requests that direction.
- If the user wants an image but the style/medium is missing and the choice would strongly affect the result, set needsClarification=true, shouldGenerate=false, prompt="", ask one short Chinese question, and provide 2-4 complete clickable suggestions with different style directions.
- When generating, reply in Chinese with one concise sentence naming the chosen style direction.
- The prompt must be concrete and under 180 English words. Reflect the user's intent, medium, visual language, composition, palette, material/texture, lighting, and typography/copy-space when relevant.
- Do not mention internal JSON, tools, APIs, or model limitations.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          message,
          history: Array.isArray(body?.history) ? body.history.slice(-8) : [],
          canvasContext: body?.canvasContext || {},
          aspectRatio: body?.aspectRatio || '1:1',
          resolution: body?.resolution || '1k',
          hasReferenceImages: Boolean(body?.hasReferenceImages),
        }),
      },
    ],
    { maxTokens: 900, temperature: 0.45 },
  )

  const parsed = normalizeAgentResult(parseJsonObject(raw), fallback)
  return json({ sessionId: session.id, ...parsed, usedModel: true })
}

export function buildFallbackAgentResult(body: any, message: string): AgentResult {
  const shouldGenerate = inferShouldGenerate(message)
  const aspectRatio = String(body?.aspectRatio || '1:1')
  const resolution = String(body?.resolution || '1k')
  const styleRoute = resolveFallbackStyleRoute(message)
  const needsClarification = shouldGenerate && styleRoute.needsClarification
  const reply = !shouldGenerate
    ? '我先按当前画布上下文给出设计判断，不会立即生成图片。'
    : needsClarification
      ? '这个需求可以走几种完全不同的视觉方向，你想先选哪一种？'
      : `我会按${styleRoute.chineseLabel}方向来做，并根据 ${aspectRatio} / ${resolution} 生成一版。`

  return {
    reply,
    shouldGenerate: shouldGenerate && !needsClarification,
    prompt: shouldGenerate && !needsClarification
      ? buildFallbackPrompt(message, styleRoute, aspectRatio, resolution)
      : '',
    mode: needsClarification ? 'plan' : (shouldGenerate ? 'generate' : 'analyze'),
    steps: needsClarification
      ? ['识别需求类型', '补齐风格方向', '等待用户选择']
      : shouldGenerate
        ? ['识别需求类型', '选择视觉语言', '生成并回填画布']
        : ['读取画布元素', '梳理视觉问题', '给出下一步建议'],
    suggestions: needsClarification
      ? styleRoute.suggestions
      : shouldGenerate
        ? styleRoute.followups
        : ['继续生成一版明确风格的图片', '先整理画布结构', '上传参考图增强一致性'],
    needsClarification,
    styleIntent: styleRoute.styleIntent,
  }
}

function resolveFallbackStyleRoute(message: string) {
  const text = message.toLowerCase()
  const has = (pattern: RegExp) => pattern.test(message) || pattern.test(text)

  if (has(/(主图|电商|商品|白底|详情页|sku|listing|marketplace|product\s*(main|listing|shot))/i)) {
    return createStyleRoute({
      category: 'ecommerce_product',
      medium: 'photography',
      visualLanguage: 'ecommerce product visual',
      reason: '用户明确提到电商、商品或主图用途',
      chineseLabel: '电商商品视觉',
      promptDirection: 'ecommerce product visual with accurate product form, controlled shadows, practical selling-point space, and marketplace-ready composition',
    })
  }

  if (has(/(插画|可爱|儿童|卡通|绘本|手绘|illustration|cartoon|cute|kid|children)/i)) {
    return createStyleRoute({
      category: 'illustration',
      medium: 'illustration',
      visualLanguage: 'playful visual language',
      reason: '用户提到插画、儿童、可爱或卡通语义',
      chineseLabel: '插画视觉',
      promptDirection: 'playful illustration with expressive shapes, friendly color rhythm, readable scene hierarchy, and handcrafted details',
    })
  }

  if (has(/(3d|三维|模型|渲染|质感|材质|立体|c4d|blender|render)/i)) {
    return createStyleRoute({
      category: 'three_d_render',
      medium: '3d_render',
      visualLanguage: 'material-focused 3D render',
      reason: '用户提到 3D、模型、渲染、质感或材质',
      chineseLabel: '3D 材质渲染',
      promptDirection: '3D render with tactile material detail, dimensional lighting, sculpted geometry, and a deliberate advertising layout',
    })
  }

  if (has(/(写实|摄影|照片|场景|镜头|棚拍|街拍|photo|photography|realistic|camera|shot)/i)) {
    return createStyleRoute({
      category: 'editorial_photography',
      medium: 'photography',
      visualLanguage: 'editorial photography',
      reason: '用户要求写实、摄影、镜头或场景感',
      chineseLabel: '编辑摄影',
      promptDirection: 'editorial photography with a specific camera viewpoint, grounded environment, natural texture, and intentional light direction',
    })
  }

  if (has(/(海报|banner|活动|促销|广告|campaign|poster|key visual|kv|launch)/i)) {
    return createStyleRoute({
      category: 'campaign_poster',
      medium: 'graphic_design',
      visualLanguage: 'campaign poster graphic layout',
      reason: '用户提到海报、banner、活动或广告用途',
      chineseLabel: '活动海报版式',
      promptDirection: 'campaign poster graphic layout with a memorable visual hook, purposeful typography area, layered composition, and a distinct campaign mood',
    })
  }

  return createStyleRoute({
    category: 'other',
    medium: 'undecided',
    visualLanguage: 'needs user choice',
    reason: '用户没有提供足够风格或媒介信息',
    chineseLabel: '自适应视觉',
    promptDirection: 'choose a visual style that best fits the requested purpose, avoiding generic commercial polish',
    needsClarification: has(/(生成|出图|做一张|画一张|创建|海报|banner|poster|generate|create|make|render)/i),
  })
}

function createStyleRoute(config: {
  category: string
  medium: string
  visualLanguage: string
  reason: string
  chineseLabel: string
  promptDirection: string
  needsClarification?: boolean
}) {
  return {
    ...config,
    needsClarification: Boolean(config.needsClarification),
    styleIntent: {
      category: config.category,
      medium: config.medium,
      visualLanguage: config.visualLanguage,
      reason: config.reason,
    },
    suggestions: [
      '做成杂志摄影风格，强调真实场景、明确光线和高级留白。',
      '做成扁平插画风格，强调图形节奏、轻快配色和清晰信息层级。',
      '做成 3D 材质广告风格，强调立体质感、戏剧光影和产品冲击力。',
      '做成品牌海报风格，强调大标题区域、活动氛围和强记忆点。',
    ],
    followups: [
      `继续按${config.chineseLabel}方向生成一个不同构图版本。`,
      '换一种更大胆的视觉语言再生成一版。',
      '基于当前结果延展一张社媒海报。',
    ],
  }
}

function buildFallbackPrompt(
  message: string,
  styleRoute: ReturnType<typeof resolveFallbackStyleRoute>,
  aspectRatio: string,
  resolution: string,
) {
  return [
    `Create an image based on this request: ${message}.`,
    `Visual language: ${styleRoute.visualLanguage}.`,
    `Visual direction: ${styleRoute.promptDirection}.`,
    'Make the style choice specific to the requested purpose; avoid generic default polish.',
    `Aspect ratio ${aspectRatio}, ${resolution} class output.`,
  ].join(' ')
}

function inferShouldGenerate(message: string) {
  const text = message.toLowerCase()
  if (/(不要出图|先不要出图|不出图|不要生成|先不要生成|不生成|别生成)/i.test(message)) return false
  const planningOnly = /(分析|建议|方案|计划|思路|评价|检查|review|不要出图|先不要生成|不生成|如何|怎么)/i.test(message)
  const generate = /(生成|出图|做一张|画一张|创建|延展|改成|重绘|海报|主图|banner|poster|generate|create|make|render)/i.test(text)
  return generate || !planningOnly
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

function sanitizeStyleIntent(value: any, fallback: StyleIntent): StyleIntent {
  if (!value || typeof value !== 'object') return fallback
  return {
    category: cleanShortText(value.category, fallback.category),
    medium: cleanShortText(value.medium, fallback.medium),
    visualLanguage: cleanShortText(value.visualLanguage, fallback.visualLanguage),
    reason: cleanShortText(value.reason, fallback.reason),
  }
}

function cleanShortText(value: unknown, fallback: string) {
  const text = String(value || '').trim()
  return text ? text.slice(0, 160) : fallback
}

function normalizeSuggestions(value: unknown, fallback: string[]) {
  const source = Array.isArray(value) ? value : fallback
  return source
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 4)
}

function isAgentMode(value: unknown): value is AgentMode {
  return value === 'plan' || value === 'generate' || value === 'refine' || value === 'analyze'
}

export function normalizeAgentResult(value: any, fallback: AgentResult): AgentResult {
  if (!value || typeof value !== 'object') return fallback
  const needsClarification = value.needsClarification === true
  const shouldGenerate = needsClarification
    ? false
    : (typeof value.shouldGenerate === 'boolean' ? value.shouldGenerate : fallback.shouldGenerate)
  return {
    reply: typeof value.reply === 'string' && value.reply.trim() ? value.reply.trim() : fallback.reply,
    shouldGenerate,
    prompt: shouldGenerate && typeof value.prompt === 'string' && value.prompt.trim()
      ? value.prompt.trim()
      : (shouldGenerate ? fallback.prompt : ''),
    mode: isAgentMode(value.mode) ? value.mode : (needsClarification ? 'plan' : fallback.mode),
    steps: Array.isArray(value.steps) ? value.steps.map(String).filter(Boolean).slice(0, 4) : fallback.steps,
    suggestions: normalizeSuggestions(value.suggestions, fallback.suggestions),
    needsClarification,
    styleIntent: sanitizeStyleIntent(value.styleIntent, fallback.styleIntent || DEFAULT_STYLE_INTENT),
  }
}
