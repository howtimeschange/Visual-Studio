import {
  Env, DEFAULT_BASE, VISION_MODEL,
  json, corsPreflight, resolveKeys, callTextModel,
} from '../../_shared'
import { getAuthContext } from '../../_lib/auth'
import { mergeUserClientKeys } from '../../_lib/user-api-keys'
import { ensureSession } from '../../_lib/v2-store'

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
You behave like Lovart-style ChatCanvas: read the user's message, use canvas context, decide whether to generate images now, and produce a concise design response.

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
      "resolution": "1k"
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
  const actions = shouldGenerate
    ? [{
        id: 'image_1',
        type: 'generate_image',
        title: '直接生成',
        prompt: message,
        aspectRatio,
        resolution,
      }]
    : []
  return {
    reply: shouldGenerate
      ? `Agent 暂时没有生成有效改写，我会直接按原始输入以 ${aspectRatio} / ${resolution} 出图。`
      : '我先按当前画布上下文给出设计判断，不会立即生成图片。',
    shouldGenerate,
    prompt: shouldGenerate ? message : '',
    actions,
    mode: shouldGenerate ? 'generate' : 'analyze',
    steps: shouldGenerate
      ? ['读取原始输入', '直接提交生图', '生成并回填画布']
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
    }, 0, fallbackAction)].filter(Boolean)
  }
  return passthrough.actions
}

function normalizeAgentAction(action: any, index: number, fallbackAction: any = {}) {
  const type = action?.type === 'generate_image' || action?.tool === 'generate_image' ? 'generate_image' : ''
  const prompt = String(action?.prompt || action?.input || '').trim()
  if (!type || !prompt) return null
  const aspectRatio = normalizeAgentAspectRatio(action?.aspectRatio || action?.ratio) || fallbackAction?.aspectRatio || ''
  const resolution = normalizeAgentResolution(action?.resolution) || fallbackAction?.resolution || ''
  const id = String(action?.id || `image_${index + 1}`)
    .replace(/[^\w-]/g, '_')
    .slice(0, 48) || `image_${index + 1}`
  const title = String(action?.title || action?.name || `图片 ${index + 1}`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return {
    id,
    type,
    title,
    prompt,
    aspectRatio,
    resolution,
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
