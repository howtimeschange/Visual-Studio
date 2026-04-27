import {
  Env, DEFAULT_BASE, VISION_MODEL, MODEL_MAP,
  json, corsPreflight, resolveKeys, resolveImageModelOptions, callImageModel, callTextModel,
} from '../_shared'
import { getAuthContext } from '../_lib/auth'
import { ensureSession, getAssetDataUrl } from '../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const action = String(body?.action || '').trim()
  const auth = await getAuthContext(env, request)
  const requestBody = { ...body, _authUserId: auth.user?.id || null }

  try {
    if (action === 'analyze') {
      return json(await handleAnalyze(env, requestBody))
    }
    if (action === 'generate') {
      return json(await handleGenerate(env, requestBody))
    }
    return json({ error: 'Unknown action. Use "analyze" or "generate".' }, 400)
  } catch (error: any) {
    return json({ error: String(error?.message || 'Style transfer failed') }, error?.status || 502)
  }
}

// ── Style analysis prompt (adapted from image-to-prompt) ────────────────────

const STYLE_ANALYSIS_PROMPT = `你是一个专业视觉分析师，将图像风格拆解为可被 AI 精确复现的结构化 JSON 数据。只输出 JSON，不要任何解释文字，不要 markdown 代码块。输出结构：
{
  "visual_style": {
    "overall_concept": {
      "theme": "核心主题风格名（中英文）",
      "mood": "氛围描述",
      "keywords": ["关键词1", "关键词2", "关键词3", "关键词4", "关键词5"]
    },
    "color_palette": {
      "dominant_colors": [
        { "name": "颜色名（中英）", "hex": "#XXXXXX", "description": "占多少面积、用在哪里、视觉作用" }
      ],
      "accent_colors": [
        { "name": "颜色名（中英）", "hex": "#XXXXXX", "description": "点缀色在哪里、视觉作用" }
      ],
      "background_color": { "name": "颜色名", "hex": "#XXXXXX", "description": "背景色质感描述" },
      "color_harmony": "配色和谐方式（附简短解释）"
    },
    "composition": {
      "layout_type": "构图类型（中心对称/三分法/对角线/满版出血/框架式）",
      "focal_point": "视觉焦点：位置+内容+为什么吸引眼球",
      "camera_angle": "机位描述",
      "depth_of_field": "景深描述"
    },
    "effects_and_textures": {
      "texture": ["质感1", "质感2"],
      "lighting": {
        "type": "光线类型",
        "direction": "光源方向和投影描述"
      },
      "post_processing_vibe": "后期调色风格"
    },
    "reproduction_prompt": {
      "style_essence_en": "一句话英文风格精髓（可直接用作提示词前缀）",
      "style_essence_zh": "一句话中文风格精髓",
      "negative_prompt": "应避免的画面元素",
      "style_tags": ["标签1", "标签2", "标签3", "标签4", "标签5"]
    }
  }
}`

// ── Analyze ─────────────────────────────────────────────────────────────────

async function handleAnalyze(env: Env, body: any) {
  const session = await ensureSession(env, body?.sessionId, body?._authUserId || null)
  const assetId = String(body?.assetId || '').trim()
  if (!assetId) throw createError('assetId required', 400)

  const clientKeys = body?.clientKeys || {}
  const baseUrl = env.RELAY_BASE_URL || DEFAULT_BASE
  const visionKey = String(clientKeys.visionApiKey || env.VISION_API_KEY || '').trim()
  if (!visionKey) throw createError('Missing Vision Key for style analysis', 400)

  const dataUrl = await getAssetDataUrl(env, assetId)
  if (!dataUrl) throw createError(`Asset not found: ${assetId}`, 404)

  const { mime, base64 } = splitDataUrl(dataUrl)

  const raw = await callTextModel(
    baseUrl,
    visionKey,
    VISION_MODEL,
    [
      { role: 'system', content: STYLE_ANALYSIS_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          { type: 'text', text: '请分析这张图片的视觉风格，按 JSON 输出。' },
        ],
      },
    ],
    { maxTokens: 2048, temperature: 0.4 },
  )

  if (!raw) throw createError('Style analysis returned no result', 502)

  const parsed = parseStyleJson(raw)

  return {
    sessionId: session.id,
    visualStyle: parsed.visualStyle,
    styleSummary: parsed.styleSummary,
    colorPalette: parsed.colorPalette,
    tags: parsed.tags,
    rawJson: parsed.rawJson,
  }
}

// ── Generate ────────────────────────────────────────────────────────────────

async function handleGenerate(env: Env, body: any) {
  const session = await ensureSession(env, body?.sessionId, body?._authUserId || null)
  const assetId = String(body?.assetId || '').trim()
  const visualStyle = body?.visualStyle
  const subject = String(body?.subject || '').trim()
  const modelId = String(body?.modelId || 'nano-banana-2')
  const subjectAssetIds = Array.isArray(body?.subjectAssetIds) ? body.subjectAssetIds.filter(Boolean) : []

  if (!subject && subjectAssetIds.length === 0) throw createError('subject or subjectAssetIds required', 400)
  if (!visualStyle) throw createError('visualStyle required', 400)
  if (!MODEL_MAP[modelId]) throw createError(`Unknown modelId: ${modelId}`, 400)

  const clientKeys = body?.clientKeys || {}
  const baseUrl = env.RELAY_BASE_URL || DEFAULT_BASE
  const { genKey } = resolveKeys(modelId, env, clientKeys)
  if (!genKey) throw createError(`Missing API key for ${modelId}`, 400)

  const imageModelOptions = resolveImageModelOptions(modelId, env, clientKeys)

  const images: Array<{ base64: string; mime: string }> = []

  if (assetId) {
    const dataUrl = await getAssetDataUrl(env, assetId)
    if (dataUrl) images.push(splitDataUrl(dataUrl))
  }

  const subjectImages: Array<{ base64: string; mime: string }> = []
  for (const sid of subjectAssetIds) {
    const dataUrl = await getAssetDataUrl(env, String(sid))
    if (dataUrl) subjectImages.push(splitDataUrl(dataUrl))
  }

  const allImages = [...images, ...subjectImages]

  const styleEssence = String(
    visualStyle?.reproduction_prompt?.style_essence_en
    || visualStyle?.overall_concept?.theme
    || '',
  ).trim()

  const styleJson = JSON.stringify(visualStyle, null, 2)

  const imageNotes: string[] = []
  let imgIdx = 1
  if (images.length > 0) {
    imageNotes.push(`Image #${imgIdx} is the STYLE SOURCE. Use it as a visual reference for palette, lighting, texture, and mood — but do NOT copy its subject matter.`)
    imgIdx += 1
  }
  for (let i = 0; i < subjectImages.length; i++) {
    imageNotes.push(`Image #${imgIdx} is a SUBJECT REFERENCE. Preserve the identity, shape, details, and recognizable features of this subject in the generated image.`)
    imgIdx += 1
  }

  const subjectDesc = subject || 'the subject shown in the reference image(s)'

  const prompt = `Generate an image of "${subjectDesc}" strictly following the visual style described below.

Style essence: ${styleEssence}

Apply these exact specifications:
- Color palette: match the dominant and accent colors precisely
- Composition: follow the layout type, camera angle, and focal point approach
- Lighting: replicate the lighting type and direction
- Textures and post-processing: apply the same mood, grain, and color grading
${subjectImages.length > 0 ? '- PRESERVE the subject from the reference image(s): keep its identity, shape, colors, and key details intact while applying the new visual style' : `- Do NOT copy the original subject — only transfer the visual style to the new subject "${subjectDesc}"`}

${imageNotes.length > 0 ? '## Attached images\n' + imageNotes.join('\n') + '\n' : ''}
Style reference JSON:
${styleJson}`

  const result = await callImageModel(
    baseUrl,
    genKey,
    MODEL_MAP[modelId],
    allImages,
    prompt,
    imageModelOptions,
  )

  if (!result.ok) throw createError(result.error, result.status)

  return {
    sessionId: session.id,
    resultDataUrl: result.dataUrl,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function splitDataUrl(dataUrl: string): { mime: string; base64: string } {
  const match = String(dataUrl || '').match(/^data:(image\/[^;]+);base64,(.+)$/)
  if (!match) return { mime: 'image/png', base64: '' }
  return { mime: match[1], base64: match[2] }
}

function parseStyleJson(raw: string) {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  let parsed: any = null
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch { /* ignore */ }
    }
  }

  const vs = parsed?.visual_style || parsed || {}
  const rp = vs?.reproduction_prompt || {}

  const dominantColors = Array.isArray(vs?.color_palette?.dominant_colors)
    ? vs.color_palette.dominant_colors.map((c: any) => ({
        hex: String(c?.hex || '#888888'),
        role: String(c?.name || c?.description || 'dominant'),
      }))
    : []

  const accentColors = Array.isArray(vs?.color_palette?.accent_colors)
    ? vs.color_palette.accent_colors.map((c: any) => ({
        hex: String(c?.hex || '#888888'),
        role: String(c?.name || c?.description || 'accent'),
      }))
    : []

  const bgColor = vs?.color_palette?.background_color?.hex
    ? [{ hex: String(vs.color_palette.background_color.hex), role: String(vs.color_palette.background_color.name || 'background') }]
    : []

  return {
    visualStyle: vs,
    styleSummary: String(rp?.style_essence_zh || vs?.overall_concept?.theme || '').trim(),
    colorPalette: [...dominantColors, ...accentColors, ...bgColor],
    tags: Array.isArray(rp?.style_tags)
      ? rp.style_tags.map((t: any) => String(t))
      : Array.isArray(vs?.overall_concept?.keywords)
        ? vs.overall_concept.keywords.map((t: any) => String(t))
        : [],
    rawJson: JSON.stringify(parsed, null, 2),
  }
}

function createError(message: string, status = 502) {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  return error
}
