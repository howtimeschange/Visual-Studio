// POST /api/generate-direct — Direct image generation with reference images passed directly to image model.
// No intermediate text-based Design Agent — references go as image inputs alongside the prompt.

import {
  Env, DEFAULT_BASE, VISION_MODEL, MODEL_MAP,
  json, corsPreflight, resolveKeys, resolveImageModelOptions, callImageModel, callTextModel,
} from '../_shared'
import {
  createAsset,
  createJob,
  createJobItems,
  createUsageEvent,
  ensureSession,
  getAssetDataUrl,
  updateJob,
  updateJobItem,
} from '../_lib/v2-store'
import { publishEvent } from '../_lib/v2-events'
import { getAuthContext } from '../_lib/auth'
import { mergeUserClientKeys } from '../_lib/user-api-keys'

type RefRole = 'character' | 'subject' | 'style' | 'scene' | 'other'

interface RefEntry {
  assetId: string
  role?: RefRole
  label?: string
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
    const auth = await getAuthContext(env, request)
    const userId = auth.user?.id || null
    const clientKeys = await mergeUserClientKeys(env, userId, body?.clientKeys || {})
    return json(await handleDirectGenerate(env, { ...body, clientKeys, _authUserId: userId }))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Generate failed') }, error?.status || 502)
  }
}

async function handleDirectGenerate(env: Env, body: any) {
  const userId = typeof body?._authUserId === 'string' ? body._authUserId : null
  const session = await ensureSession(env, body?.sessionId, userId)
  const modelId = String(body?.modelId || 'nano-banana-2')
  const prompt = String(body?.prompt || '').trim()
  const aspectRatio = normalizeAspectRatio(body?.aspectRatio)
  const resolution = normalizeResolution(body?.resolution)
  const useDesignAgent = Boolean(body?.useDesignAgent)
  const referenceEntries: RefEntry[] = Array.isArray(body?.referenceImages)
    ? body.referenceImages.filter((r: any) => r?.assetId)
    : []

  if (!prompt) throw createError('prompt required', 400)
  if (!MODEL_MAP[modelId]) throw createError(`Unknown modelId: ${modelId}`, 400)

  const job = await createJob(env, {
    sessionId: session.id,
    userId,
    type: 'generate_batch',
    status: 'running',
    configJson: {
      modelId,
      prompt,
      aspectRatio,
      resolution,
      useDesignAgent,
      referenceAssetIds: referenceEntries.map((entry) => entry.assetId),
    },
    summaryJson: {},
    progressTotal: 1,
    progressDone: 0,
    progressFailed: 0,
  })
  const [item] = await createJobItems(env, job.id, [{
    jobId: job.id,
    itemType: 'generate_batch_item',
    status: 'running',
    inputJson: { prompt, aspectRatio, resolution, modelId },
    outputJson: {},
    attemptCount: 1,
    errorCode: null,
    errorMessage: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }])
  await publishEvent(env, 'job', job.id, 'status', { status: 'running', type: job.type })

  const clientKeys = body?.clientKeys || {}
  const baseUrl = env.RELAY_BASE_URL || DEFAULT_BASE
  const { visionKey, genKey } = resolveKeys(modelId, env, clientKeys)
  const imageModelOptions = resolveImageModelOptions(modelId, env, clientKeys)
  imageModelOptions.aspectRatio = aspectRatio
  imageModelOptions.resolution = resolution

  try {
    if (!genKey) throw createError(`Missing API key for ${modelId}`, 400)

    // Load reference images
    const refImages: Array<{ base64: string; mime: string; role: string; label: string }> = []
    for (const entry of referenceEntries) {
      const dataUrl = await getAssetDataUrl(env, String(entry.assetId))
      if (!dataUrl) continue
      const { base64, mime } = splitDataUrl(dataUrl)
      if (!base64) continue
      refImages.push({
        base64,
        mime,
        role: entry.role || 'other',
        label: entry.label || '',
      })
    }

    let finalPrompt = prompt

    if (useDesignAgent && visionKey) {
      // Design Agent mode: use vision model to refine prompt, but still pass images directly
      const refined = await refineWithDesignAgent(baseUrl, visionKey, prompt, refImages, aspectRatio, resolution)
      if (refined) finalPrompt = refined
    }

    // Build the final prompt with role annotations
    const fullPrompt = buildDirectPrompt(finalPrompt, refImages, aspectRatio, resolution)

    // Pass all reference images directly to the image model
    const images = refImages.map((img) => ({ base64: img.base64, mime: img.mime }))

    const result = await callImageModel(
      baseUrl,
      genKey,
      MODEL_MAP[modelId],
      images,
      fullPrompt,
      imageModelOptions,
    )

    if (!result.ok) throw createError(result.error, result.status)

    const resultAsset = await createAsset(env, {
      sessionId: session.id,
      userId,
      kind: 'result',
      source: 'generate_direct',
      dataUrl: result.dataUrl,
      filename: `${job.id}.png`,
      bucketKind: 'result',
    })

    await updateJobItem(env, job.id, item.id, {
      status: 'completed',
      outputJson: { resultAssetId: resultAsset.id },
      finishedAt: new Date().toISOString(),
    })
    await updateJob(env, job.id, {
      status: 'completed',
      progressDone: 1,
      summaryJson: { resultAssetId: resultAsset.id },
    })
    await publishEvent(env, 'job', job.id, 'job_completed', { status: 'completed', resultAssetId: resultAsset.id })
    await createUsageEvent(env, {
      userId,
      sessionId: session.id,
      jobId: job.id,
      eventType: 'generate_direct_result',
      amount: 1,
      provider: '1xm.ai',
      modelId,
    })

    return {
      sessionId: session.id,
      jobId: job.id,
      resultAsset,
      resultDataUrl: result.dataUrl,
      aspectRatio,
      resolution,
    }
  } catch (error: any) {
    await updateJobItem(env, job.id, item.id, {
      status: 'failed',
      errorCode: 'generate_direct_failed',
      errorMessage: String(error?.message || 'Generate failed'),
      finishedAt: new Date().toISOString(),
    })
    await updateJob(env, job.id, {
      status: 'failed',
      progressFailed: 1,
      summaryJson: { error: String(error?.message || 'Generate failed') },
    })
    await publishEvent(env, 'job', job.id, 'job_completed', {
      status: 'failed',
      error: String(error?.message || 'Generate failed'),
    })
    throw error
  }
}

function buildDirectPrompt(
  userPrompt: string,
  refs: Array<{ role: string; label: string }>,
  aspectRatio: string,
  resolution: string,
): string {
  const parts: string[] = []

  // Reference annotations
  if (refs.length > 0) {
    const refLines = refs.map((ref, i) => {
      const idx = i + 1
      const guide = ({
        character: `Image #${idx}: CHARACTER reference. PRESERVE this person's identity, face, hair, and proportions exactly.`,
        subject: `Image #${idx}: SUBJECT reference. PRESERVE this object's shape, colors, branding, and details. Apply it as the main subject in the new composition.`,
        style: `Image #${idx}: STYLE reference. Extract palette, lighting, mood, and texture. Do NOT copy the subject — only transfer the visual language.`,
        scene: `Image #${idx}: SCENE reference. Use for environment, spatial depth, and framing cues.`,
        other: `Image #${idx}: Visual reference${ref.label ? ` ("${ref.label}")` : ''}. Use relevant visual cues.`,
      } as Record<string, string>)[ref.role] || `Image #${idx}: Reference image.`
      return guide
    }).join('\n')
    parts.push('## Reference images\n' + refLines)
  }

  // User prompt
  parts.push('## Instructions\n' + userPrompt)

  // Aspect ratio hint
  const ratioHint = ({
    '1:1': 'square (1:1)',
    '4:3': 'landscape (4:3)',
    '3:4': 'portrait (3:4)',
    '16:9': 'widescreen (16:9)',
    '9:16': 'tall/vertical (9:16)',
    '1:4': 'extra tall vertical strip (1:4)',
    '1:8': 'ultra tall vertical strip (1:8)',
  } as Record<string, string>)[aspectRatio]
  if (ratioHint) {
    parts.push(`Aspect ratio: ${ratioHint}`)
  }

  const resolutionHint = ({
    '1k': '1k class output, approximately 1024px on the long edge.',
    '2k': '2k class output, approximately 2048px on the long edge.',
    '4k': '4k class output, approximately 4096px on the long edge.',
  } as Record<string, string>)[resolution]
  if (resolutionHint) {
    parts.push(`Resolution target: ${resolutionHint}`)
  }

  // Minimal output constraint — no bloat
  parts.push('Output: a single image. No watermark, border, or UI chrome.')

  return parts.join('\n\n')
}

async function refineWithDesignAgent(
  baseUrl: string,
  visionKey: string,
  prompt: string,
  refs: Array<{ base64: string; mime: string; role: string; label: string }>,
  aspectRatio: string,
  resolution: string,
): Promise<string | null> {
  const refSummary = refs.length > 0
    ? refs.map((r, i) => `- Image ${i + 1}: role=${r.role}${r.label ? `, "${r.label}"` : ''}`).join('\n')
    : 'No reference images.'

  const raw = await callTextModel(
    baseUrl,
    visionKey,
    'gemini-3-flash-preview',
    [
      {
        role: 'system',
        content: `You are a concise image prompt engineer. The user wants to generate an image.
Given their description and reference image roles, output ONLY a refined English image prompt (under 200 words).
Be concrete: specify camera angle, lighting direction, color temperature, materials, spatial relationships.
Ban vague fillers: "high-quality", "professional", "stunning", "beautiful".
The references will be passed directly as images — you only need to describe the scene, not the references themselves.`,
      },
      {
        role: 'user',
        content: `User request: ${prompt}\n\nReferences:\n${refSummary}\n\nAspect ratio: ${aspectRatio}\nResolution: ${resolution}\n\nOutput the refined prompt only, no explanation.`,
      },
    ],
    { maxTokens: 600, temperature: 0.7 },
  )

  return raw?.trim() || null
}

function normalizeAspectRatio(value: unknown): string {
  const ratio = String(value || '').trim()
  return ['1:1', '4:3', '3:4', '16:9', '9:16', '1:4', '1:8'].includes(ratio) ? ratio : '1:1'
}

function normalizeResolution(value: unknown): string {
  const resolution = String(value || '').trim().toLowerCase()
  return ['1k', '2k', '4k'].includes(resolution) ? resolution : '1k'
}

function splitDataUrl(dataUrl: string): { mime: string; base64: string } {
  const match = String(dataUrl || '').match(/^data:(image\/[^;]+);base64,(.+)$/)
  if (!match) return { mime: 'image/png', base64: '' }
  return { mime: match[1], base64: match[2] }
}

function createError(message: string, status = 502) {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  return error
}
