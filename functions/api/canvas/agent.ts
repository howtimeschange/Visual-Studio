import {
  Env, DEFAULT_BASE, VISION_MODEL,
  json, corsPreflight, resolveKeys, callTextModel,
} from '../../_shared'
import { getAuthContext } from '../../_lib/auth'
import { mergeUserClientKeys } from '../../_lib/user-api-keys'
import { ensureSession } from '../../_lib/v2-store'

type CreativeMode = 'image' | 'poster_banner'

type PosterBrief = {
  format: string
  headline: string
  subheadline: string
  cta: string
  badges: string[]
  layout: string
  copySafeArea: string
  aspectRatio: string
  resolution: string
  sourceRequest: string
}

export const onRequestOptions: PagesFunction = async () => corsPreflight()

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
  const creativeMode = normalizeCreativeMode(body?.creativeMode)
  const posterBrief = normalizePosterBrief({
    ...(body?.posterBrief || {}),
    aspectRatio: body?.aspectRatio || body?.posterBrief?.aspectRatio,
    resolution: body?.resolution || body?.posterBrief?.resolution,
    sourceRequest: message,
  })
  const baseUrl = env.RELAY_BASE_URL || DEFAULT_BASE
  const clientKeys = await mergeUserClientKeys(env, auth.user?.id || null, body?.clientKeys || {})
  const { visionKey } = resolveKeys(modelId, env, clientKeys)
  const passthrough = buildPassthroughAgentResult(body, message)

  if (!visionKey) {
    return json({ sessionId: session.id, ...passthrough, usedModel: false, agentPassthrough: true, passthroughReason: 'missing_vision_key' })
  }

  const raw = await callTextModel(
    baseUrl,
    visionKey,
    VISION_MODEL,
    [
      {
        role: 'system',
        content: `You are the Canvas AI Designer Agent for a commercial image canvas.
You behave like Lovart-style ChatCanvas: read the user's message, use canvas context, decide whether to generate an image now, and produce a concise design response.

Return strict JSON only:
{
  "reply": "Chinese reply shown in chat",
  "shouldGenerate": true,
  "prompt": "Legacy first image-generation prompt if shouldGenerate is true, otherwise empty",
  "mode": "plan|generate|refine|analyze",
  "steps": ["short Chinese step", "..."],
  "suggestions": ["short follow-up", "..."],
  "actions": [
    {
      "id": "image_1",
      "type": "generate_image",
      "title": "short Chinese image title",
      "prompt": "complete image-generation prompt for this one output",
      "aspectRatio": "1:1",
      "resolution": "1k",
      "creativeMode": "image|poster_banner",
      "promptStyle": "visual_base",
      "posterBrief": {
        "headline": "short exact local overlay headline",
        "subheadline": "short exact local overlay subheadline",
        "cta": "short CTA",
        "badges": ["short badge"],
        "layout": "left|right|top|bottom|center",
        "copySafeArea": "left 42%"
      }
    }
  ]
}

Rules:
- If the user asks for analysis, advice, planning, critique, or project organization and says not to generate, set shouldGenerate=false.
- If the user asks to create, generate, make, extend, redraw, or produce a poster/image, set shouldGenerate=true.
- When the user asks for multiple images, variants, a list of prompts, or a series, return one generate_image action per intended output.
- Do not combine multiple requested outputs into one image unless the user explicitly asks for a collage, contact sheet, grid, or one combined image.
- Each action must describe exactly one image output and be independently generatable.
- The prompt must be concrete, complete, and image-model-ready. Include composition, subject, lighting, materials, typography/copy-space if relevant; do not force a short prompt when useful detail matters.
- If creativeMode is "poster_banner", behave like the local banner-generation and 大森运营图 workflows: create a unified, text-free visual base prompt for each action and a posterBrief for local composition. The image prompt must reserve the requested copy safe area and must say no readable words, no numbers, no letter-like marks, no pseudo-text, no watermark, no border, and no UI chrome. Put actual headline/subheadline/CTA/badges into posterBrief, not into the image prompt.
- Poster/banner visual bases must be one coherent hero scene with one clear focal subject, not a collage. Avoid split-screen composition, contact sheets, tiled panels, multiple unrelated scenes, before/after layouts, floating sticker clusters, frame-within-frame graphics, and decorative card piles. Use depth, lighting, architecture, props, silhouettes, and restrained abstract shapes instead.
- The reserved copy-safe area is a real layout region. Keep faces, hands, logos, high-contrast props, and the primary subject out of it. Make that region calm, dark or low-detail enough for crisp local typography.
- In poster_banner mode, avoid all text-bearing objects in the visual base: no signboards, billboards, posters, street signs, store signs, license plates, newspaper pages, documents, interface panels, captions, subtitles, logos, chip labels, or screen text. If the scene normally has signage or screens, render blank glowing panels or abstract light shapes with zero glyphs. Do not describe neon signage; describe abstract neon reflections, architecture, color, and lighting instead.
- In poster_banner mode, use the user's selected aspectRatio and resolution unless the request explicitly names a different output format. Do not turn multiple posters/banners into one collage.
- Return raw JSON only, without Markdown fences.
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
          creativeMode,
          posterBrief,
        }),
      },
    ],
    { maxTokens: 4000, temperature: 0.45 },
  )

  const parsedJson = parseJsonObject(raw)
  const parsed = normalizeAgentResult(parsedJson, passthrough)
  return json({
    sessionId: session.id,
    ...parsed,
    usedModel: true,
    agentPassthrough: !parsedJson,
    passthroughReason: parsedJson ? '' : (raw ? 'invalid_agent_json' : 'empty_agent_response'),
  })
}

export function buildPassthroughAgentResult(body: any, message: string) {
  const shouldGenerate = inferShouldGenerate(message)
  const aspectRatio = String(body?.aspectRatio || '1:1')
  const resolution = String(body?.resolution || '1k')
  const creativeMode = normalizeCreativeMode(body?.creativeMode)
  const posterBrief = normalizePosterBrief({
    ...(body?.posterBrief || {}),
    aspectRatio,
    resolution,
    sourceRequest: message,
  })
  const prompt = creativeMode === 'poster_banner'
    ? buildPosterBannerBasePrompt(message, posterBrief, aspectRatio, resolution)
    : message
  const actions = shouldGenerate
    ? [{
        id: 'image_1',
        type: 'generate_image',
        title: '直接生成',
        prompt,
        aspectRatio,
        resolution,
        creativeMode,
        promptStyle: creativeMode === 'poster_banner' ? 'visual_base' : '',
        posterBrief: creativeMode === 'poster_banner' ? posterBrief : null,
      }]
    : []
  return {
    reply: shouldGenerate
      ? (creativeMode === 'poster_banner'
          ? `Agent 暂时没有生成有效改写，我会按海报/banner模式生成无字主视觉，并在本地合成文案。`
          : `Agent 暂时没有生成有效改写，我会直接按原始输入以 ${aspectRatio} / ${resolution} 出图。`)
      : '我先按当前画布上下文给出设计判断，不会立即生成图片。',
    shouldGenerate,
    prompt: shouldGenerate ? prompt : '',
    actions,
    mode: shouldGenerate ? 'generate' : 'analyze',
    steps: shouldGenerate
      ? (creativeMode === 'poster_banner'
          ? ['读取原始输入', '生成无字主视觉', '本地合成海报文案']
          : ['读取原始输入', '直接提交生图', '生成并回填画布'])
      : ['读取画布元素', '梳理视觉问题', '给出下一步建议'],
    suggestions: ['继续生成同风格变体', '上传参考图增强一致性', '先整理画布结构'],
  }
}

function inferShouldGenerate(message: string) {
  const text = message.toLowerCase()
  if (/(不要出图|先不要出图|不出图|不要生成|先不要生成|不生成|别生成)/i.test(message)) return false
  const planningOnly = /(分析|建议|方案|计划|思路|评价|检查|review|不要出图|先不要生成|不生成|如何|怎么)/i.test(message)
  const generate = /(生成|出图|做一张|画一张|创建|延展|改成|重绘|海报|主图|banner|poster|generate|create|make|render)/i.test(text)
  return generate || !planningOnly
}

export function normalizeCreativeMode(value: unknown): CreativeMode {
  return String(value || '') === 'poster_banner' ? 'poster_banner' : 'image'
}

export function normalizePosterBrief(value: any = {}): PosterBrief {
  const layout = ['left', 'right', 'top', 'bottom', 'center'].includes(String(value?.layout || ''))
    ? String(value.layout)
    : defaultPosterLayout(value?.aspectRatio)
  const aspectRatio = normalizeAgentAspectRatio(value?.aspectRatio) || '1:1'
  const resolution = normalizeAgentResolution(value?.resolution) || '1k'
  return {
    format: ['poster', 'banner'].includes(String(value?.format || '')) ? String(value.format) : defaultPosterFormat(aspectRatio),
    headline: cleanPosterText(value?.headline || inferPosterHeadline(value?.sourceRequest), 36),
    subheadline: cleanPosterText(value?.subheadline, 72),
    cta: cleanPosterText(value?.cta, 18),
    badges: Array.isArray(value?.badges)
      ? value.badges.map((item: any) => cleanPosterText(item, 16)).filter(Boolean).slice(0, 4)
      : [],
    layout,
    copySafeArea: cleanPosterText(value?.copySafeArea, 32) || defaultCopySafeArea(layout),
    aspectRatio,
    resolution,
    sourceRequest: cleanPosterText(value?.sourceRequest, 200),
  }
}

export function buildPosterBannerBasePrompt(message: string, brief: PosterBrief, aspectRatio: string, resolution: string): string {
  const safeArea = brief.copySafeArea || defaultCopySafeArea(brief.layout)
  const format = brief.format === 'poster' ? 'poster' : 'banner'
  return hardenPosterBannerBasePrompt([
    'Use case: ads-marketing',
    `Asset type: text-free visual base for a ${format} that will receive local typography overlays`,
    `Primary request: ${message}`,
    `Scene/backdrop: create one coherent commercial hero scene that supports the request, with a clear focal subject and campaign-ready production quality.`,
    `Scene safety: if the request references Hong Kong, city streets, cinema neon, chips, data centers, or screens, express them through blank light panels, architecture, reflections, cables, glow, and silhouettes; do not use signs, written labels, or readable displays.`,
    `Composition/framing: reserve clean, low-detail copy space in the ${safeArea}; keep the focal subject, face, hands, logos, and high-contrast props outside that text-safe region; use a single cinematic camera viewpoint.`,
    `Lighting/mood: coherent cinematic/commercial lighting, controlled contrast, refined color harmony, restrained premium finish.`,
    `Aspect ratio: ${aspectRatio}; ${resolution} class output.`,
    'Text: render no readable words, no numbers, no letter-like marks, no pseudo-text; all typography will be added locally after image generation.',
    'Avoid: watermark, border, UI chrome, fake captions, cluttered collage, split-screen, tiled panels, multiple unrelated vignettes, decorative card piles, distorted logos, unreadable tiny text, and any object that normally carries writing.',
  ].join('\n'))
}

export function hardenPosterBannerBasePrompt(prompt: string): string {
  const text = sanitizePosterBannerBasePrompt(prompt)
  const hardRules = [
    'Hard text-free base constraints:',
    '- Do not include signboards, billboards, posters-within-poster, street signs, store signs, road markings, license plates, newspapers, documents, captions, subtitles, labels, logos, emblems, badges, screen UI, terminal code, chip labels, product labels, or any written marks.',
    '- If the scene would normally contain signage, screens, chips, storefronts, or documents, make those surfaces completely blank, blurred, abstract, or out of focus with zero glyph-like strokes.',
    '- Use architecture, lighting, silhouettes, props, facial expression, color, and composition to communicate the idea; reserve every real word for the local compositor.',
  ]
  return `${text}\n\n${getPosterBannerCompositionRules()}\n\n${hardRules.join('\n')}`
}

export function sanitizePosterBannerBasePrompt(prompt: string): string {
  return String(prompt || '')
    .replace(/\bneon-lit\s+(hong kong\s+)?street(s)?\b/gi, 'abstract neon-lit architecture with blank light panels and no signage')
    .replace(/\bneon\s+sign(age|s)?\b/gi, 'abstract neon reflections with no glyphs')
    .replace(/\bsignboards?\b/gi, 'blank light panels')
    .replace(/\bbillboards?\b/gi, 'blank architectural light panels')
    .replace(/\bstreet signs?\b/gi, 'unmarked street fixtures')
    .replace(/\bstore signs?\b/gi, 'blank storefront glow')
    .replace(/\bscreen text\b/gi, 'blank screen glow')
    .replace(/\bchip labels?\b/gi, 'unmarked chip surfaces')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getPosterBannerCompositionRules(): string {
  return [
    'Unified poster/banner composition rules:',
    '- Build one integrated hero image, not a puzzle, collage, grid, moodboard, contact sheet, or multi-panel layout.',
    '- Use one primary focal subject and one continuous environment; secondary details must support depth and atmosphere instead of becoming separate mini-scenes.',
    '- Keep the reserved copy area calm, low-detail, and contrast-controlled so local typography sits naturally on top.',
    '- Keep faces, hands, logos, high-contrast props, and the primary subject out of the reserved copy area.',
    '- For Hong Kong, street, cinema, technology, chip, or data-center themes, use blank luminous surfaces, abstract circuitry, architecture, atmosphere, and reflections; avoid neon signboards entirely.',
    '- Avoid split-screen, before-after comparisons, repeated portraits, floating stickers, nested frames, isolated cards, and unrelated object clusters.',
  ].join('\n')
}

function inferPosterHeadline(value: unknown): string {
  const text = cleanPosterText(value, 80)
  if (!text) return '主题海报'
  return cleanPosterText(text.split(/[，。！？,.!?；;：:\n]/)[0], 28) || '主题海报'
}

function cleanPosterText(value: unknown, maxLength: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function defaultPosterFormat(aspectRatio: string): string {
  return ['9:16', '3:4', '1:4', '1:8'].includes(aspectRatio) ? 'poster' : 'banner'
}

function defaultPosterLayout(aspectRatio: unknown): string {
  const ratio = normalizeAgentAspectRatio(aspectRatio) || '1:1'
  return ['9:16', '3:4', '1:4', '1:8'].includes(ratio) ? 'bottom' : 'left'
}

function defaultCopySafeArea(layout: string): string {
  return ({
    left: 'left 42%',
    right: 'right 42%',
    top: 'top 32%',
    bottom: 'bottom 35%',
    center: 'center 52%',
  })[layout] || 'left 42%'
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

function normalizeAgentResult(value: any, passthrough: ReturnType<typeof buildPassthroughAgentResult>) {
  if (!value || typeof value !== 'object') return passthrough
  const shouldGenerate = typeof value.shouldGenerate === 'boolean' ? value.shouldGenerate : passthrough.shouldGenerate
  const actions = shouldGenerate ? normalizeAgentActions(value, passthrough) : []
  return {
    reply: typeof value.reply === 'string' && value.reply.trim() ? value.reply.trim() : passthrough.reply,
    shouldGenerate,
    prompt: actions[0]?.prompt || '',
    actions,
    mode: ['plan', 'generate', 'refine', 'analyze'].includes(value.mode) ? value.mode : passthrough.mode,
    steps: Array.isArray(value.steps) ? value.steps.map(String).filter(Boolean).slice(0, 4) : passthrough.steps,
    suggestions: Array.isArray(value.suggestions) ? value.suggestions.map(String).filter(Boolean).slice(0, 4) : passthrough.suggestions,
  }
}

function normalizeAgentActions(value: any, passthrough: ReturnType<typeof buildPassthroughAgentResult>) {
  const fallbackAction = passthrough.actions[0] || {}
  const rawActions = Array.isArray(value?.actions)
    ? value.actions
    : Array.isArray(value?.tasks)
      ? value.tasks
      : []
  const actions = rawActions
    .map((action: any, index: number) => normalizeAgentAction(action, index, fallbackAction))
    .filter(Boolean)
    .slice(0, 8)
  if (actions.length) return actions
  if (typeof value?.prompt === 'string' && value.prompt.trim()) {
    return [normalizeAgentAction({
      id: 'image_1',
      type: 'generate_image',
      title: '生成图片',
      prompt: value.prompt,
      aspectRatio: value.aspectRatio,
      resolution: value.resolution,
      creativeMode: value.creativeMode,
      promptStyle: value.promptStyle,
      posterBrief: value.posterBrief,
    }, 0, fallbackAction)].filter(Boolean)
  }
  return passthrough.actions
}

function normalizeAgentAction(action: any, index: number, fallbackAction: any = {}) {
  const type = action?.type === 'generate_image' || action?.tool === 'generate_image' ? 'generate_image' : ''
  const prompt = String(action?.prompt || action?.input || '').trim()
  if (!type || !prompt) return null
  const aspectRatio = normalizeAgentAspectRatio(action?.aspectRatio || action?.ratio)
  const resolution = normalizeAgentResolution(action?.resolution)
  const id = String(action?.id || `image_${index + 1}`)
    .replace(/[^\w-]/g, '_')
    .slice(0, 48) || `image_${index + 1}`
  const title = String(action?.title || action?.name || `图片 ${index + 1}`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  const creativeMode = normalizeCreativeMode(action?.creativeMode || fallbackAction?.creativeMode)
  return {
    id,
    type,
    title,
    prompt: creativeMode === 'poster_banner' ? hardenPosterBannerBasePrompt(prompt) : prompt,
    aspectRatio,
    resolution,
    creativeMode,
    promptStyle: action?.promptStyle === 'visual_base' || (creativeMode === 'poster_banner' && fallbackAction?.promptStyle === 'visual_base') ? 'visual_base' : '',
    posterBrief: creativeMode === 'poster_banner' ? normalizePosterBrief({
      ...(fallbackAction?.posterBrief || {}),
      ...(action?.posterBrief || action?.brief || {}),
      aspectRatio: aspectRatio || fallbackAction?.aspectRatio,
      resolution: resolution || fallbackAction?.resolution,
    }) : null,
  }
}

function normalizeAgentAspectRatio(value: unknown): string {
  const text = String(value || '').trim()
  return ['1:1', '4:3', '3:4', '16:9', '9:16', '1:4', '1:8'].includes(text) ? text : ''
}

function normalizeAgentResolution(value: unknown): string {
  const text = String(value || '').trim().toLowerCase()
  return ['1k', '2k', '4k'].includes(text) ? text : ''
}
