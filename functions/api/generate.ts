// POST /api/generate — Multi-turn image generation with reference images.
//
// Request body:
// {
//   modelId: 'nano-banana-2' | 'nano-banana-pro' | 'gpt-image-2',
//   userMessage: string,                        // latest user instruction
//   history: [{role, content}],                // prior turns
//   referenceImages: [{ id, base64, mime, role, label }],
//   useDesignAgent: boolean,                   // run Gemini-based design agent first
//   previousResult: { base64, mime } | null,   // optional last assistant image
//   clientKeys?
// }
//
// Stream events (NDJSON):
// { type: 'status', content, activeStep? }
// { type: 'trace', trace, activeStep? }
// { type: 'live_brief', text, activeStep? }
// { type: 'result', resultDataUrl, refinedPrompt, agentNotes, agentTrace }
// { type: 'error', error, status? }

import {
  Env, DEFAULT_BASE, VISION_MODEL, MODEL_MAP,
  json, corsPreflight, resolveKeys, resolveImageModelOptions, callImageModel, callTextModel,
} from '../_shared'
import { getAuthContext } from '../_lib/auth'
import { mergeUserClientKeys } from '../_lib/user-api-keys'

type RefRole = 'character' | 'subject' | 'style' | 'scene' | 'other'
type CommerceTaskType = 'main-image' | 'detail-page' | 'general'

interface RefImage {
  id: string
  base64: string
  mime: string
  role?: RefRole
  label?: string
}

interface PreviousResultPart {
  base64: string
  mime: string
}

interface DesignAgentTrace {
  steps: string[]
  summary: string
  tags: string[]
}

interface DesignAgentResult {
  prompt: string
  notes: string
  trace: DesignAgentTrace
  composition: string
}

interface DesignAgentVisualRef {
  index: number
  role: string
  label: string
  summary: string
  preserve: string
  composition: string
}

interface PreviousFrameAnalysis {
  summary: string
  keep: string
  fix: string
}

interface DesignAgentConfig {
  apiKey: string
  model: string
}

interface DesignRoute {
  useCase: 'campaign' | 'main-image' | 'detail-page' | 'general'
  styleRoute: string
  composition: string
  copySpace: 'required' | 'optional' | 'none'
  platforms: string[]
}

interface PlanningPayload {
  prompt?: string
  composition?: string
  notes?: string
  trace?: unknown
}

interface CritiquePayload {
  prompt?: string
  composition?: string
  notes?: string
  trace?: unknown
}

interface StreamEventBase {
  type: string
  activeStep?: number
}

type StreamEvent =
  | (StreamEventBase & { type: 'status'; content: string })
  | (StreamEventBase & { type: 'trace'; trace: DesignAgentTrace })
  | (StreamEventBase & { type: 'live_brief'; text: string })
  | (StreamEventBase & {
      type: 'result'
      resultDataUrl: string
      refinedPrompt: string
      agentNotes: string
      agentTrace: DesignAgentTrace
    })
  | (StreamEventBase & { type: 'error'; error: string; status?: number })

type GenerateRequestBody = {
  modelId?: string
  userMessage?: string
  history?: Array<{ role: string; content: string }>
  referenceImages?: RefImage[]
  useDesignAgent?: boolean
  previousResult?: PreviousResultPart | null
  aspectRatio?: string
  resolution?: string
  clientKeys?: Record<string, unknown>
}

type GenerateExecutionContext = {
  baseUrl: string
  visionKey: string
  genKey: string
  modelId: string
  userMessage: string
  history: Array<{ role: string; content: string }>
  referenceImages: RefImage[]
  useDesignAgent: boolean
  previousResult: PreviousResultPart | null
  agentConfig: DesignAgentConfig
  imageModelOptions: ReturnType<typeof resolveImageModelOptions>
}

type GenerateExecutionResult = {
  resultDataUrl: string
  refinedPrompt: string
  agentNotes: string
  agentTrace: DesignAgentTrace
}

const DESIGN_AGENT_MODEL = VISION_MODEL
const DEFAULT_AGENT_STEPS = [
  '读取参考图与上一轮结果里的硬约束。',
  '按平台、任务类型和风格路由收束方向。',
  '整理主体、构图、留白和镜头关系。',
  '做一轮反套板自检后再交给生图模型。',
]

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  try {
    const auth = await getAuthContext(env, request)
    const clientKeys = await mergeUserClientKeys(env, auth.user?.id || null, body?.clientKeys || {})
    return streamGenerateResponse(buildGenerateExecutionContext({ ...body, clientKeys }, env))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Generate failed') }, error?.status || 400)
  }
}

function resolveDesignAgentConfig(visionKey: string): DesignAgentConfig {
  return {
    apiKey: String(visionKey || '').trim(),
    model: DESIGN_AGENT_MODEL,
  }
}

export function buildGenerateExecutionContext(body: GenerateRequestBody, env: Env): GenerateExecutionContext {
  const {
    modelId = 'nano-banana-2',
    userMessage = '',
    history = [],
    referenceImages = [],
    useDesignAgent = true,
    previousResult = null,
    aspectRatio = '',
    resolution = '',
    clientKeys = {},
  } = body ?? {}

  if (!String(userMessage || '').trim() && (!Array.isArray(referenceImages) || referenceImages.length === 0)) {
    throw createStatusError('userMessage or referenceImages required', 400)
  }
  if (!MODEL_MAP[modelId]) throw createStatusError(`Unknown modelId: ${modelId}`, 400)

  const baseUrl = env.RELAY_BASE_URL || DEFAULT_BASE
  const { visionKey, genKey } = resolveKeys(modelId, env, clientKeys)
  const imageModelOptions = resolveImageModelOptions(modelId, env, clientKeys)
  imageModelOptions.aspectRatio = normalizeAspectRatio(aspectRatio)
  imageModelOptions.resolution = normalizeResolution(resolution)
  if (!genKey) throw createStatusError(`Missing API key for ${modelId}`, 400)

  const agentConfig = resolveDesignAgentConfig(visionKey)
  if (useDesignAgent && !agentConfig.apiKey) {
    throw createStatusError('Missing Vision Key for design agent', 400)
  }

  return {
    baseUrl,
    visionKey,
    genKey,
    modelId,
    userMessage,
    history: Array.isArray(history) ? history : [],
    referenceImages: Array.isArray(referenceImages) ? referenceImages : [],
    useDesignAgent: Boolean(useDesignAgent),
    previousResult: isImagePart(previousResult) ? previousResult : null,
    agentConfig,
    imageModelOptions,
  }
}

export async function executeGenerate(
  ctx: GenerateExecutionContext,
  emit?: (event: StreamEvent) => Promise<void> | void,
): Promise<GenerateExecutionResult> {
  const normalizedMessage = ctx.userMessage.trim()
    || (ctx.previousResult
      ? 'Refine the previous image into a cleaner and more polished commercial draft.'
      : 'Create a polished first draft based on the attached references.')

  const commerceContext = detectCommerceContext(normalizedMessage, ctx.history)
  const route = deriveDesignRoute(normalizedMessage, commerceContext, ctx.referenceImages)
  const initialTrace = createInitialTrace(route, commerceContext)

  await emit?.({
    type: 'trace',
    trace: initialTrace,
    activeStep: 0,
  })

  let finalPrompt = normalizedMessage
  let agentNotes = ''
  let agentTrace = initialTrace

  if (ctx.useDesignAgent) {
    await emit?.({
      type: 'status',
      content: '正在分析参考图与上一轮画面的可保留约束…',
      activeStep: 0,
    })

    const [visualRefs, previousFrame] = await Promise.all([
      analyzeReferenceImages(ctx.baseUrl, ctx.visionKey, ctx.referenceImages),
      analyzePreviousResult(ctx.baseUrl, ctx.visionKey, ctx.previousResult),
    ])

    await emit?.({
      type: 'status',
      content: '正在按任务路由、平台规范和构图目标生成设计计划…',
      activeStep: 1,
    })

    const designResult = await runDesignAgent(
      ctx.baseUrl,
      ctx.agentConfig,
      {
        userMessage: normalizedMessage,
        history: ctx.history,
        referenceImages: ctx.referenceImages,
        visualRefs,
        previousFrame,
        route,
        commerceContext,
        hasPreviousResult: Boolean(ctx.previousResult),
      },
      async ({ liveBrief, trace, activeStep }) => {
        if (trace) await emit?.({ type: 'trace', trace, activeStep })
        if (liveBrief) await emit?.({ type: 'live_brief', text: liveBrief, activeStep })
      },
    )

    finalPrompt = buildGenPrompt(designResult.prompt, ctx.referenceImages, Boolean(ctx.previousResult), route, designResult)
    agentNotes = designResult.notes
    agentTrace = designResult.trace
  } else {
    finalPrompt = buildDirectPrompt(normalizedMessage, ctx.referenceImages, Boolean(ctx.previousResult))
    agentNotes = ctx.previousResult
      ? '本轮直接按你的修改要求延续上一版。'
      : '本轮跳过设计 Agent，直接按原始需求出图。'
    agentTrace = {
      ...initialTrace,
      summary: agentNotes,
    }
  }

  await emit?.({
    type: 'trace',
    trace: agentTrace,
    activeStep: 3,
  })
  await emit?.({
    type: 'status',
    content: '设计方向已定，正在调用生图模型…',
    activeStep: 3,
  })

  const images = [
    ...(ctx.previousResult ? [ctx.previousResult] : []),
    ...ctx.referenceImages.map((image) => ({ base64: image.base64, mime: image.mime })),
  ]

  const imageResult = await callImageModel(
    ctx.baseUrl,
    ctx.genKey,
    MODEL_MAP[ctx.modelId],
    images,
    finalPrompt,
    ctx.imageModelOptions,
  )

  if (!imageResult.ok) throw createStatusError(imageResult.error, imageResult.status)

  const result = {
    resultDataUrl: imageResult.dataUrl,
    refinedPrompt: finalPrompt,
    agentNotes,
    agentTrace,
  }
  await emit?.({ type: 'result', ...result })
  return result
}

function streamGenerateResponse(ctx: GenerateExecutionContext) {
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()
  const encoder = new TextEncoder()

  const send = async (event: StreamEvent) => {
    await writer.write(encoder.encode(`${JSON.stringify(event)}\n`))
  }

  void (async () => {
    try {
      await executeGenerate(ctx, send)
    } catch (error: any) {
      await send({
        type: 'error',
        error: String(error?.message || 'Generate failed'),
        status: Number(error?.status || 0) || undefined,
      })
    } finally {
      await writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

async function runDesignAgent(
  baseUrl: string,
  config: DesignAgentConfig,
  ctx: {
    userMessage: string
    history: Array<{ role: string; content: string }>
    referenceImages: RefImage[]
    visualRefs: DesignAgentVisualRef[]
    previousFrame: PreviousFrameAnalysis | null
    route: DesignRoute
    commerceContext: {
      detected: boolean
      taskType: CommerceTaskType
      platforms: string[]
    }
    hasPreviousResult: boolean
  },
  onProgress?: (payload: {
    liveBrief?: string
    trace?: DesignAgentTrace
    activeStep?: number
  }) => Promise<void> | void,
): Promise<DesignAgentResult> {
  const seedTrace = createInitialTrace(ctx.route, ctx.commerceContext)
  await onProgress?.({ trace: seedTrace, activeStep: 1 })

  const planningRaw = await callTextModel(
    baseUrl,
    config.apiKey,
    config.model,
    [
      { role: 'system', content: buildDesignPlanningSystemPrompt(ctx) },
      { role: 'user', content: buildDesignPlanningUserPrompt(ctx) },
    ],
    { maxTokens: 2200, temperature: 0.8 },
  )
  if (!planningRaw) throw createStatusError('Design agent planning failed', 502)

  const liveBrief = cleanVisibleBrief(extractTaggedSection(planningRaw, 'live_brief'))
  if (liveBrief) {
    await onProgress?.({
      liveBrief,
      trace: {
        ...seedTrace,
        summary: liveBrief,
      },
      activeStep: 2,
    })
  }

  const plan = parsePlanningPayload(planningRaw)
  const planTrace = normalizeDesignAgentTrace(
    plan.trace,
    String(plan.notes || ''),
    ctx.commerceContext,
    ctx.route,
    cleanVisibleBrief(extractTaggedSection(planningRaw, 'live_brief')),
  )

  await onProgress?.({
    trace: planTrace,
    activeStep: 2,
  })

  const critiqueRaw = await callTextModel(
    baseUrl,
    config.apiKey,
    config.model,
    [
      { role: 'system', content: buildDesignCritiqueSystemPrompt(ctx) },
      { role: 'user', content: buildDesignCritiqueUserPrompt(ctx, plan) },
    ],
    { maxTokens: 1600, temperature: 0.7 },
  )
  if (!critiqueRaw) throw createStatusError('Design agent critique failed', 502)

  const critique = parseCritiquePayload(critiqueRaw)
  const prompt = String(critique.prompt || plan.prompt || '').trim()
  const notes = String(critique.notes || plan.notes || '').trim()
  const trace = normalizeDesignAgentTrace(
    critique.trace || plan.trace,
    notes,
    ctx.commerceContext,
    ctx.route,
    planTrace.summary,
  )

  if (!prompt) {
    throw createStatusError('Design agent returned no prompt', 502)
  }

  const composition = String(critique.composition || plan.composition || '').trim()

  return { prompt, notes, trace, composition }
}

async function analyzeReferenceImages(
  baseUrl: string,
  visionKey: string,
  refs: RefImage[],
): Promise<DesignAgentVisualRef[]> {
  if (refs.length === 0) return []

  return Promise.all(refs.map(async (ref, index) => {
    const fallback = fallbackVisualRef(index, ref)
    if (!visionKey) return fallback

    const raw = await callTextModel(
      baseUrl,
      visionKey,
      VISION_MODEL,
      [
        {
          role: 'system',
          content: `You are a visual reference analyst for an image-generation design agent.
Return JSON only:
{
  "summary": "<concise Chinese summary of visible facts>",
  "preserve": "<what must stay consistent>",
  "composition": "<camera / layout / mood / negative-space cues>"
}

Rules:
- describe only visible facts, no invention
- keep each field under 38 Chinese characters
- focus on subject identity, product details, silhouette, palette, composition`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${ref.mime};base64,${ref.base64}` },
            },
            {
              type: 'text',
              text: `参考角色=${ref.role || 'other'}，标签=${ref.label || `Ref ${index + 1}`}。请按 JSON 输出。`,
            },
          ],
        },
      ],
      { maxTokens: 400, temperature: 0.2 },
    )

    const parsed = safeParseJsonObject(raw)
    if (!parsed) return fallback

    return {
      index,
      role: ref.role || 'other',
      label: ref.label || `Ref ${index + 1}`,
      summary: String(parsed.summary || fallback.summary).trim() || fallback.summary,
      preserve: String(parsed.preserve || fallback.preserve).trim() || fallback.preserve,
      composition: String(parsed.composition || fallback.composition).trim() || fallback.composition,
    }
  }))
}

async function analyzePreviousResult(
  baseUrl: string,
  visionKey: string,
  previousResult: PreviousResultPart | null,
): Promise<PreviousFrameAnalysis | null> {
  if (!previousResult || !visionKey) return null

  const raw = await callTextModel(
    baseUrl,
    visionKey,
    VISION_MODEL,
    [
      {
        role: 'system',
        content: `You analyze the last generated commercial image for iterative editing.
Return JSON only:
{
  "summary": "<what the image currently looks like>",
  "keep": "<elements safe to preserve>",
  "fix": "<stiff / generic / broken parts to improve>"
}

Keep each field concise, factual, and in Chinese.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${previousResult.mime};base64,${previousResult.base64}` },
          },
          {
            type: 'text',
            text: '这是上一轮生成结果。请提炼当前构图、可保留元素和应修正的问题。',
          },
        ],
      },
    ],
    { maxTokens: 360, temperature: 0.2 },
  )

  const parsed = safeParseJsonObject(raw)
  if (!parsed) return null

  return {
    summary: String(parsed.summary || '').trim(),
    keep: String(parsed.keep || '').trim(),
    fix: String(parsed.fix || '').trim(),
  }
}

function buildDesignPlanningSystemPrompt(ctx: {
  route: DesignRoute
  commerceContext: { detected: boolean; taskType: CommerceTaskType; platforms: string[] }
}) {
  return `You are Visual Studio Design Agent, a lightweight single-agent workflow adapted for commercial image generation.

You must behave like a four-step agent loop:
1. Perception — understand references, user intent, prior turn constraints
2. Routing — classify use case, platform fit, style route, and copy-space needs
3. Composition — lock hero subject, camera, depth, lighting, and negative space
4. Self-critique — remove AI-slop and generic layouts before handing off to the image model

Hard rules:
- Public reasoning only. Do not reveal hidden chain-of-thought.
- Banner / KV / hero / poster requests must NOT collapse into flat lays, product lineups, or catalog grids unless explicitly requested.
- No aggressive generic gradients, random decorative clutter, emoji, fake UI chrome, or template-like SaaS hero aesthetics.
- For apparel and product references, preserve silhouette, print scale, trims, color placement, materials, and recognizable details.
- Do NOT default to the same "one hero + breathable negative space" formula every time. Read the actual request and choose the composition that best serves it — asymmetric, off-center, close-up, environmental, editorial spread, top-down, etc.
- Respect marketplace constraints when the task is ecommerce related.
- Output the final image prompt in English, concrete and production-ready, under 240 words.
- The prompt must specify CONCRETE visual details: exact camera angle, lighting direction, color temperature, depth of field, surface materials, spatial relationships. Vague words like "high-quality", "professional", "stunning" are banned.

Output contract:
1. First emit <live_brief>...</live_brief> in Chinese. This is a concise, user-visible running brief that summarizes what you are locking in. It must be readable, high-level, and safe to show.
2. Then emit <json>{...}</json> with strict JSON:
{
  "prompt": "<English prompt — concrete, art-directed, no filler adjectives>",
  "composition": "<one English sentence describing the specific composition approach for this image>",
  "notes": "<one concise Chinese sentence>",
  "trace": {
    "steps": ["<3-5 concise Chinese steps>"],
    "summary": "<one concise Chinese summary>",
    "tags": ["<2-4 short Chinese tags>"]
  }
}

Current route priors:
- use_case: ${ctx.route.useCase}
- style_route: ${ctx.route.styleRoute}
- copy_space: ${ctx.route.copySpace}
- ecommerce_task: ${ctx.commerceContext.taskType}
- platforms: ${ctx.commerceContext.platforms.join(', ') || 'none'}
`
}

function buildDesignPlanningUserPrompt(ctx: {
  userMessage: string
  history: Array<{ role: string; content: string }>
  visualRefs: DesignAgentVisualRef[]
  previousFrame: PreviousFrameAnalysis | null
  route: DesignRoute
  commerceContext: { detected: boolean; taskType: CommerceTaskType; platforms: string[] }
  hasPreviousResult: boolean
}) {
  const historyText = ctx.history
    .slice(-6)
    .map((entry) => `${entry.role}: ${entry.content}`)
    .join('\n')
    || '(no prior turns)'

  const refsText = ctx.visualRefs.length > 0
    ? ctx.visualRefs.map((ref) => [
        `- Ref #${ref.index + 1}`,
        `[role=${ref.role}]`,
        ref.label ? `"${ref.label}"` : '',
        `summary=${ref.summary}`,
        `preserve=${ref.preserve}`,
        `composition=${ref.composition}`,
      ].filter(Boolean).join(' ')).join('\n')
    : 'None'

  const previousText = ctx.previousFrame
    ? `summary=${ctx.previousFrame.summary || 'n/a'}
keep=${ctx.previousFrame.keep || 'n/a'}
fix=${ctx.previousFrame.fix || 'n/a'}`
    : 'None'

  return `## Latest request
${ctx.userMessage}

## Conversation memory
${historyText}

## Detected route
- use_case: ${ctx.route.useCase}
- style_route: ${ctx.route.styleRoute}
- composition: ${ctx.route.composition}
- copy_space: ${ctx.route.copySpace}
- commerce_task: ${ctx.commerceContext.taskType}
- platforms: ${ctx.commerceContext.platforms.join(', ') || 'none'}
- previous_result_mode: ${ctx.hasPreviousResult ? 'yes' : 'no'}

## Reference analysis
${refsText}

## Previous image analysis
${previousText}

Plan the design direction, then produce the final English prompt and concise Chinese trace.`
}

function buildDesignCritiqueSystemPrompt(ctx: {
  route: DesignRoute
  commerceContext: { detected: boolean; taskType: CommerceTaskType; platforms: string[] }
}) {
  return `You are the critique pass of Visual Studio Design Agent.

Your only job: improve the draft prompt so the generated image feels like a strong, distinctive commercial composition instead of a stiff AI collage.

Check aggressively for:
- flat product lineups pretending to be banners
- weak hierarchy or no clear hero
- missing copy-safe space when banner / KV / hero use cases require it
- background and props overpowering the product
- fashion/apparel losing garment details or turning into cutout collages
- ecommerce platform mismatch or unsafe main-image behavior
- vague lighting, camera, or scale instructions
- generic filler adjectives ("high-quality", "professional", "stunning") — replace with concrete visual specs
- composition defaulting to the same center-hero-with-breathing-room pattern — vary it when the brief calls for it

Keep the prompt in English under 240 words.
Return JSON only:
{
  "prompt": "<revised English prompt>",
  "composition": "<one English sentence: the specific composition strategy for THIS image>",
  "notes": "<one concise Chinese sentence>",
  "trace": {
    "steps": ["<3-5 concise Chinese steps>"],
    "summary": "<one concise Chinese summary>",
    "tags": ["<2-4 short Chinese tags>"]
  }
}

Route priors:
- use_case: ${ctx.route.useCase}
- style_route: ${ctx.route.styleRoute}
- commerce_task: ${ctx.commerceContext.taskType}
- platforms: ${ctx.commerceContext.platforms.join(', ') || 'none'}`
}

function buildDesignCritiqueUserPrompt(
  ctx: {
    userMessage: string
    route: DesignRoute
    visualRefs: DesignAgentVisualRef[]
    previousFrame: PreviousFrameAnalysis | null
  },
  plan: PlanningPayload,
) {
  const refsText = ctx.visualRefs.length > 0
    ? ctx.visualRefs.map((ref) =>
        `- [${ref.role}] ${ref.label}: preserve=${ref.preserve}; composition=${ref.composition}`
      ).join('\n')
    : 'None'

  return `## User request
${ctx.userMessage}

## Route
- use_case: ${ctx.route.useCase}
- style_route: ${ctx.route.styleRoute}
- composition: ${ctx.route.composition}
- copy_space: ${ctx.route.copySpace}

## Reference constraints
${refsText}

## Previous image
${ctx.previousFrame ? `keep=${ctx.previousFrame.keep || 'n/a'}\nfix=${ctx.previousFrame.fix || 'n/a'}` : 'None'}

## Draft prompt
${String(plan.prompt || '').trim()}

## Draft notes
${String(plan.notes || '').trim()}

Tighten the prompt so it preserves fidelity, feels art-directed, and avoids AI slop.`
}

function deriveDesignRoute(
  userMessage: string,
  commerceContext: {
    detected: boolean
    taskType: CommerceTaskType
    platforms: string[]
  },
  refs: RefImage[],
): DesignRoute {
  const text = userMessage.toLowerCase()
  const subjectCount = refs.filter((ref) => (ref.role || 'other') === 'subject').length
  const styleCount = refs.filter((ref) => (ref.role || 'other') === 'style').length
  const sceneCount = refs.filter((ref) => (ref.role || 'other') === 'scene').length

  const useCase = commerceContext.taskType === 'main-image'
    ? 'main-image'
    : commerceContext.taskType === 'detail-page'
      ? 'detail-page'
      : /\b(banner|kv|hero|poster|campaign|封面|海报|横幅)\b/i.test(userMessage)
        ? 'campaign'
        : 'general'

  const styleRoute = detectStyleRoute(text, commerceContext, refs)
  const copySpace = /\b(banner|kv|hero|海报|横幅|封面|标题位|logo位|文案位)\b/i.test(userMessage)
    ? 'required'
    : sceneCount > 0 || styleCount > 0
      ? 'optional'
      : 'none'

  const composition = useCase === 'detail-page'
    ? 'modular scroll narrative'
    : useCase === 'main-image'
      ? 'hero-first platform image'
      : useCase === 'campaign'
        ? 'campaign hero with copy-safe negative space'
        : subjectCount > 1
          ? 'one hero plus supporting secondary elements'
          : 'single-hero commercial composition'

  return {
    useCase,
    styleRoute,
    composition,
    copySpace,
    platforms: commerceContext.platforms,
  }
}

function detectStyleRoute(
  text: string,
  commerceContext: {
    detected: boolean
    taskType: CommerceTaskType
    platforms: string[]
  },
  refs: RefImage[],
): string {
  const roles = refs.map((ref) => ref.role || 'other')
  const hasStyleRef = roles.includes('style')

  if (/(插画|手绘|illustration|illustrated|cartoon|漫画|水彩|素描)/i.test(text)) return '手绘插画'
  if (/(3d|三维|渲染|c4d|blender|isometric|等距)/i.test(text)) return '3D 渲染'
  if (/(ugc|种草|带货|vlog|手机随拍|真实感推荐|开箱|测评)/i.test(text)) return 'UGC 快节奏'
  if (/(珠宝|奢|premium|luxury|editorial|高端|精致)/i.test(text)) return '轻奢编辑'
  if (/(minimal|极简|简约|性冷淡|muji|无印)/i.test(text)) return '极简克制'
  if (/(促销|sale|折扣|活力|vibrant|bold|大促|狂欢|618|双11|黑五)/i.test(text)) return '活力促销'
  if (/(白底|纯白|white background|clean white|抠图)/i.test(text)) return '纯白主图'
  if (/(复古|vintage|retro|怀旧|胶片|film)/i.test(text)) return '复古胶片'
  if (/(赛博|科技|cyber|neon|霓虹|未来|futuristic|tech)/i.test(text)) return '科技未来'
  if (/(自然|有机|organic|植物|绿色|清新|田园)/i.test(text)) return '自然有机'
  if (/(美食|food|餐饮|烘焙|咖啡|茶)/i.test(text)) return '美食摄影'
  if (/(服饰|时尚|童装|母婴|美妆|lifestyle|穿搭)/i.test(text)) return '时尚生活'
  if (/(运动|户外|sport|outdoor|健身|跑步)/i.test(text)) return '运动动感'
  if (/(场景图|氛围|mood|情绪|cinematic|电影感)/i.test(text)) return '电影氛围'
  if (commerceContext.taskType === 'main-image' && /(amazon|temu|aliexpress|lazada)/i.test(text)) return '纯白主图'
  if (commerceContext.platforms.some((platform) => ['Shopee', 'TikTok Shop', 'SHEIN'].includes(platform))) return '时尚生活'
  if (hasStyleRef) return '跟随风格参考'
  return '商业写实'
}

function createInitialTrace(
  route: DesignRoute,
  commerceContext: {
    detected: boolean
    taskType: CommerceTaskType
    platforms: string[]
  },
): DesignAgentTrace {
  return {
    steps: [...DEFAULT_AGENT_STEPS],
    summary: route.useCase === 'detail-page'
      ? '先按详情页模块节奏收束信息层次，再整理主次卖点和滚动结构。'
      : route.useCase === 'main-image'
        ? '先锁定平台主图的主体优先级，再控制构图纯度、留白和合规边界。'
        : route.useCase === 'campaign'
          ? '先确定 KV / banner 的主视觉和文案留白，再压缩背景噪声和 AI 套板感。'
          : '先理清参考约束，再把主体、风格和场景收束成一条清晰方向。',
    tags: uniqueStrings([
      route.useCase === 'detail-page'
        ? '详情页路由'
        : route.useCase === 'main-image'
          ? '主图路由'
          : route.useCase === 'campaign'
            ? 'KV / Banner'
            : '创意生成',
      route.styleRoute,
      route.copySpace === 'required' ? '留白位' : '',
      commerceContext.platforms.join(' · '),
      '反套板',
    ]).slice(0, 4),
  }
}

function buildDirectPrompt(userMessage: string, refs: RefImage[], hasPrev: boolean): string {
  const parts: string[] = []

  if (hasPrev) {
    parts.push('Image #1 is the previous result. Apply the user\'s changes on top of it.')
  }

  if (refs.length > 0) {
    const refLines = refs.map((r, i) => {
      const idx = i + 1 + (hasPrev ? 1 : 0)
      const role = r.role || 'other'
      return `Image #${idx}: ${role}${r.label ? ` "${r.label}"` : ''}`
    }).join('\n')
    parts.push(refLines)
  }

  parts.push(userMessage)

  return parts.join('\n\n')
}

function buildGenPrompt(
  refinedPrompt: string,
  refs: RefImage[],
  hasPrev: boolean,
  route: DesignRoute,
  agentResult?: DesignAgentResult,
): string {
  const isCampaign = route.useCase === 'campaign'
  const isMainImage = route.useCase === 'main-image'
  const isDetailPage = route.useCase === 'detail-page'
  const style = route.styleRoute

  const refLines = refs.map((r, i) => {
    const idx = i + 1 + (hasPrev ? 1 : 0)
    const role = r.role || 'other'
    const guide = buildRoleGuide(role, style, route)
    return `Image #${idx} (role=${role}${r.label ? `, "${r.label}"` : ''}): ${guide}`
  }).join('\n')

  const prevNote = hasPrev
    ? 'Image #1 is your previous generated result. Iterate ON TOP of it — refine, adjust, and improve according to the latest instructions rather than starting from scratch.\n'
    : ''

  const compositionNote = buildCompositionNote(route, refs, agentResult)
  const outputNote = buildOutputNote(route, hasPrev)

  return `${prevNote}${refLines ? `## Reference images\n${refLines}\n\n` : ''}## Generation instructions
${refinedPrompt}${compositionNote}

${outputNote}`
}

function buildRoleGuide(role: string, styleRoute: string, route: DesignRoute): string {
  const isWhiteBg = styleRoute === '纯白主图'
  const isMinimal = styleRoute === '极简克制'
  const isEditorial = styleRoute === '轻奢编辑'
  const isLifestyle = styleRoute === '时尚生活'
  const isCinematic = styleRoute === '电影氛围'
  const isFood = styleRoute === '美食摄影'
  const isRetro = styleRoute === '复古胶片'
  const is3D = styleRoute === '3D 渲染'
  const isUGC = styleRoute === 'UGC 快节奏'

  if (role === 'character') {
    if (isUGC) return 'PRESERVE this person\'s identity and natural appearance. Keep the casual, candid energy — avoid stiff studio posing.'
    if (isEditorial) return 'PRESERVE face, hair, and proportions exactly. Style the framing with editorial confidence — strong angles, dramatic lighting.'
    return 'PRESERVE this person\'s identity, face, hair, and body proportions exactly. This is the same individual across turns.'
  }
  if (role === 'subject') {
    if (isWhiteBg) return 'PRESERVE this product\'s silhouette, colorway, branding, and details. Place on a clean white background with even studio lighting and no props or distractions.'
    if (isMinimal) return 'PRESERVE product details exactly. Use generous negative space, muted tones, and restrained composition.'
    if (isEditorial) return 'PRESERVE product details exactly. Elevate with editorial lighting, luxurious surfaces, and considered negative space.'
    if (isFood) return 'PRESERVE this food item\'s appearance and plating. Use appetizing warm lighting, shallow depth of field, and natural textures.'
    if (is3D) return 'PRESERVE product form and branding. Render in clean 3D with soft global illumination and studio-grade material fidelity.'
    if (isLifestyle) return 'PRESERVE product details while integrating into a believable lifestyle context. The product should feel naturally placed, not composited.'
    return 'PRESERVE this object\'s silhouette, colorway, branding, trims, materials, and recognizable details exactly, while allowing creative recomposition.'
  }
  if (role === 'style') {
    if (isRetro) return 'Extract the vintage palette, film grain quality, color cast, and tonal mood. Apply authentically, not as a superficial filter.'
    if (isCinematic) return 'Extract cinematic lighting ratios, color grading, depth of field, and atmospheric mood from this reference.'
    return 'Extract palette, lighting, mood, finish, and composition rhythm from this reference. Do NOT copy its literal content — translate its aesthetic language.'
  }
  if (role === 'scene') {
    if (isCampaign(route)) return 'Use for environment, spatial depth, and copy-safe framing cues. Ensure the scene supports a clear title/logo area.'
    return 'Use for camera angle, environment, spatial depth, and framing cues. Adapt the spatial logic, not the literal scene.'
  }
  return 'Use as a supporting visual reference. Extract relevant visual cues without copying composition literally.'
}

function isCampaign(route: DesignRoute): boolean {
  return route.useCase === 'campaign'
}

function buildCompositionNote(route: DesignRoute, refs: RefImage[], agentResult?: DesignAgentResult): string {
  if (agentResult?.composition) {
    return `\nComposition: ${agentResult.composition}`
  }

  const subjectCount = refs.filter((ref) => (ref.role || 'other') === 'subject').length

  if (route.useCase === 'campaign') {
    return '\nComposition: design a campaign visual with a clear hero subject, intentional negative space for headlines or logos, layered depth, and art-directed lighting. Avoid flat product lineups, catalog grids, or clip-art collage aesthetics.'
  }
  if (route.useCase === 'main-image') {
    return '\nComposition: hero-first product image. The product dominates the frame with maximum clarity. Clean background, controlled lighting, no competing elements. Every pixel serves product recognition.'
  }
  if (route.useCase === 'detail-page') {
    return '\nComposition: create a single image suitable for a product detail narrative — clear subject hierarchy, contextual props that support the product story, readable at mobile scale.'
  }
  if (subjectCount > 1) {
    return '\nComposition: arrange multiple subjects with clear primary/secondary hierarchy. One hero leads, others support. Avoid equal-weight lineups unless explicitly requested.'
  }
  return ''
}

function buildOutputNote(route: DesignRoute, hasPrev: boolean): string {
  const parts: string[] = []

  parts.push('Output: a single image.')

  if (route.useCase === 'campaign') {
    parts.push('Leave clear copy-safe negative space for titles, taglines, or logos.')
    parts.push('No watermark, UI chrome, or collage seams.')
  } else if (route.useCase === 'main-image') {
    parts.push('No text, watermark, border, or decorative elements unless the product itself contains them.')
  } else if (route.useCase === 'detail-page') {
    parts.push('No watermark or UI chrome. Minimal text only if it serves the product narrative.')
  } else {
    parts.push('No watermark, border, or UI chrome unless explicitly requested.')
  }

  if (hasPrev) {
    parts.push('Maintain visual continuity with the previous version — preserve what works, refine what was requested.')
  }

  return parts.join(' ')
}

function detectCommerceContext(
  userMessage: string,
  history: Array<{ role: string; content: string }>,
): {
  detected: boolean
  taskType: CommerceTaskType
  platforms: string[]
} {
  const text = `${userMessage}\n${history.map((item) => item.content).join('\n')}`.toLowerCase()
  const detected = /(跨境|电商|主图|详情页|详情长图|listing|pdp|hero|amazon|shopee|lazada|aliexpress|temu|shein|tiktok shop|tiktok)/i.test(text)

  const platformMatchers: Array<[RegExp, string]> = [
    [/\bamazon\b/i, 'Amazon'],
    [/\bshopee\b/i, 'Shopee'],
    [/\btiktok(?:\s+shop)?\b/i, 'TikTok Shop'],
    [/\blazada\b/i, 'Lazada'],
    [/\bali ?express\b/i, 'AliExpress'],
    [/\btemu\b/i, 'Temu'],
    [/\bshein\b/i, 'SHEIN'],
  ]

  const platforms = platformMatchers
    .filter(([pattern]) => pattern.test(text))
    .map(([, label]) => label)

  const taskType = /(详情|长图|模块|参数|卖点|场景拆解|detail|module|comparison)/i.test(text)
    ? 'detail-page'
    : /(主图|首图|listing|hero|封面|thumbnail)/i.test(text)
      ? 'main-image'
      : 'general'

  return { detected, taskType, platforms }
}

function normalizeDesignAgentTrace(
  rawTrace: any,
  notes: string,
  commerceContext: {
    detected: boolean
    taskType: CommerceTaskType
    platforms: string[]
  },
  route: DesignRoute,
  fallbackSummary = '',
): DesignAgentTrace {
  const steps = Array.isArray(rawTrace?.steps)
    ? rawTrace.steps.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 5)
    : []

  const summary = typeof rawTrace?.summary === 'string' && rawTrace.summary.trim()
    ? rawTrace.summary.trim()
    : notes.trim() || fallbackSummary.trim()

  const tags = uniqueStrings([
    ...(Array.isArray(rawTrace?.tags) ? rawTrace.tags : []).map((item: unknown) => String(item || '').trim()),
    route.useCase === 'detail-page'
      ? '详情页路由'
      : route.useCase === 'main-image'
        ? '主图路由'
        : route.useCase === 'campaign'
          ? 'KV / Banner'
          : '创意生成',
    route.styleRoute,
    route.copySpace === 'required' ? '留白位' : '',
    ...(commerceContext.platforms.length > 0 ? [commerceContext.platforms.join(' · ')] : []),
  ]).slice(0, 4)

  return {
    steps: steps.length > 0 ? steps : [...DEFAULT_AGENT_STEPS],
    summary: summary || '已把主体、构图、风格和平台约束收束为可执行方向。',
    tags,
  }
}

function parsePlanningPayload(raw: string): PlanningPayload {
  const jsonText = extractTaggedSection(raw, 'json')
  const parsed = safeParseJsonObject(jsonText) || safeParseJsonObject(raw) || {}
  return parsed
}

function parseCritiquePayload(raw: string): CritiquePayload {
  return safeParseJsonObject(raw) || {}
}

function fallbackVisualRef(index: number, ref: RefImage): DesignAgentVisualRef {
  const role = ref.role || 'other'
  const label = ref.label || `Ref ${index + 1}`
  const defaults = {
    character: {
      summary: '人物身份与穿着参考',
      preserve: '保留脸部、发型和体态识别',
      composition: '只借用人物姿态和镜头感',
    },
    subject: {
      summary: '主体 / 产品外观参考',
      preserve: '保留轮廓、颜色、材质和细节',
      composition: '重构为更完整的商业构图',
    },
    style: {
      summary: '风格和色调参考',
      preserve: '保留配色、光线和氛围',
      composition: '借用版式节奏与镜头情绪',
    },
    scene: {
      summary: '场景与构图参考',
      preserve: '保留空间层次和镜头关系',
      composition: '借用背景、景深和留白逻辑',
    },
    other: {
      summary: '补充视觉参考',
      preserve: '保留可识别元素',
      composition: '作为次级灵感使用',
    },
  } as const

  return {
    index,
    role,
    label,
    ...defaults[role],
  }
}

function extractTaggedSection(source: string, tag: string): string {
  const startToken = `<${tag}>`
  const endToken = `</${tag}>`
  const start = source.indexOf(startToken)
  if (start === -1) return ''
  const bodyStart = start + startToken.length
  const end = source.indexOf(endToken, bodyStart)
  return end === -1 ? source.slice(bodyStart) : source.slice(bodyStart, end)
}

function cleanVisibleBrief(value: string): string {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeParseJsonObject(source: string | null | undefined): any | null {
  if (!source) return null
  const trimmed = String(source).trim()
  if (!trimmed) return null

  const direct = tryJsonParse(trimmed)
  if (direct && typeof direct === 'object') return direct

  const match = trimmed.match(/\{[\s\S]*\}/)
  if (!match) return null

  const nested = tryJsonParse(match[0])
  return nested && typeof nested === 'object' ? nested : null
}

function tryJsonParse(source: string) {
  try {
    return JSON.parse(source)
  } catch {
    return null
  }
}

function createStatusError(message: string, status = 502) {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  return error
}

function isImagePart(value: any): value is PreviousResultPart {
  return Boolean(value?.base64 && value?.mime)
}

function normalizeAspectRatio(value: unknown): string {
  const ratio = String(value || '').trim()
  return ['1:1', '4:3', '3:4', '16:9', '9:16', '1:4', '1:8'].includes(ratio) ? ratio : ''
}

function normalizeResolution(value: unknown): string {
  const resolution = String(value || '').trim().toLowerCase()
  return ['1k', '2k', '4k'].includes(resolution) ? resolution : ''
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
