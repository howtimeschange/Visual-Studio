import {
  Env, DEFAULT_BASE, VISION_MODEL,
  json, corsPreflight, resolveKeys, callTextModel,
} from '../../_shared'
import { getAuthContext } from '../../_lib/auth'
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
  const { visionKey } = resolveKeys(modelId, env, body?.clientKeys || {})
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
        content: `You are the Canvas AI Designer Agent for a commercial image canvas.
You behave like Lovart-style ChatCanvas: read the user's message, use canvas context, decide whether to generate an image now, and produce a concise design response.

Return strict JSON only:
{
  "reply": "Chinese reply shown in chat",
  "shouldGenerate": true,
  "prompt": "English image-generation prompt if shouldGenerate is true, otherwise empty",
  "mode": "plan|generate|refine|analyze",
  "steps": ["short Chinese step", "..."],
  "suggestions": ["short follow-up", "..."]
}

Rules:
- If the user asks for analysis, advice, planning, critique, or project organization and says not to generate, set shouldGenerate=false.
- If the user asks to create, generate, make, extend, redraw, or produce a poster/image, set shouldGenerate=true.
- The prompt must be concrete and under 180 English words. Include composition, subject, lighting, materials, typography/copy-space if relevant.
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

function buildFallbackAgentResult(body: any, message: string) {
  const shouldGenerate = inferShouldGenerate(message)
  const aspectRatio = String(body?.aspectRatio || '1:1')
  const resolution = String(body?.resolution || '1k')
  return {
    reply: shouldGenerate
      ? `我会先把需求收束成明确的生成方向，再按 ${aspectRatio} / ${resolution} 出一张草稿并放回画布。`
      : '我先按当前画布上下文给出设计判断，不会立即生成图片。',
    shouldGenerate,
    prompt: shouldGenerate
      ? `Create a commercial visual design based on this request: ${message}. Use a clear focal subject, intentional composition, practical copy space, coherent lighting, and polished ecommerce-ready styling. Aspect ratio ${aspectRatio}, ${resolution} class output.`
      : '',
    mode: shouldGenerate ? 'generate' : 'analyze',
    steps: shouldGenerate
      ? ['读取画布上下文', '收束主体与构图', '生成并回填画布']
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

function normalizeAgentResult(value: any, fallback: ReturnType<typeof buildFallbackAgentResult>) {
  if (!value || typeof value !== 'object') return fallback
  const shouldGenerate = typeof value.shouldGenerate === 'boolean' ? value.shouldGenerate : fallback.shouldGenerate
  return {
    reply: typeof value.reply === 'string' && value.reply.trim() ? value.reply.trim() : fallback.reply,
    shouldGenerate,
    prompt: shouldGenerate && typeof value.prompt === 'string' && value.prompt.trim()
      ? value.prompt.trim()
      : (shouldGenerate ? fallback.prompt : ''),
    mode: ['plan', 'generate', 'refine', 'analyze'].includes(value.mode) ? value.mode : fallback.mode,
    steps: Array.isArray(value.steps) ? value.steps.map(String).filter(Boolean).slice(0, 4) : fallback.steps,
    suggestions: Array.isArray(value.suggestions) ? value.suggestions.map(String).filter(Boolean).slice(0, 4) : fallback.suggestions,
  }
}
