// POST /api/outfit-swap — Apply one or more clothing items onto a model image.
// Request:
// {
//   modelId,
//   model:    { base64, mime, label?, instructions? },     // person photo
//   garment?: { base64, mime },     // legacy single clothing photo
//   garments?: [{ base64, mime, role?, label?, instructions? }],
//   garmentType?: 'top'|'bottom'|'dress'|'outerwear'|'full_outfit'|'shoes'|'accessory',
//   instructions?: string,          // legacy global free-form extra requests
//   clientKeys?
// }
// Returns: { resultDataUrl }

import {
  Env, DEFAULT_BASE, MODEL_MAP, VISION_MODEL,
  json, corsPreflight, resolveKeys, resolveImageModelOptions, callImageModel, callTextModel,
} from '../_shared'
import { requireAuth } from '../_lib/auth'
import { mergeUserClientKeys } from '../_lib/user-api-keys'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export async function executeOutfitSwap(body: any, env: Env) {
  const {
    modelId = 'nano-banana-pro',
    model, garment, garments,
    garmentType = 'full_outfit',
    instructions = '',
    clientKeys = {},
  } = body ?? {}

  if (!model?.base64) throw createOutfitError('model image required', 400)
  if (!MODEL_MAP[modelId]) throw createOutfitError(`Unknown modelId: ${modelId}`, 400)

  const garmentItems = normalizeGarments(garments, garment, garmentType)
  if (garmentItems.length === 0) throw createOutfitError('at least one garment image required', 400)

  const baseUrl = env.RELAY_BASE_URL || DEFAULT_BASE
  const { genKey, visionKey } = resolveKeys(modelId, env, clientKeys)
  const imageModelOptions = resolveImageModelOptions(modelId, env, clientKeys)
  if (!genKey) throw createOutfitError(`Missing API key for ${modelId}`, 400)

  const analysis = body?.analysis || await prepareOutfitAnalysis({
    modelId,
    model,
    garments: garmentItems,
    clientKeys,
  }, env)

  const prompt = buildSwapPrompt(model, garmentItems, instructions, analysis)
  const result = await callImageModel(
    baseUrl, genKey, MODEL_MAP[modelId],
    [
      { base64: model.base64, mime: model.mime || 'image/jpeg' },
      ...garmentItems.map((item) => ({
        base64: item.base64,
        mime: item.mime || 'image/jpeg',
      })),
    ],
    prompt,
    imageModelOptions,
  )
  if (!result.ok) throw createOutfitError(result.error, result.status || 502)
  return { resultDataUrl: result.dataUrl }
}

export async function prepareOutfitAnalysis(body: any, env: Env): Promise<OutfitAnalysis | null> {
  const {
    modelId = 'nano-banana-pro',
    model, garment, garments,
    garmentType = 'full_outfit',
    clientKeys = {},
  } = body ?? {}

  if (!model?.base64) throw createOutfitError('model image required', 400)
  if (!MODEL_MAP[modelId]) throw createOutfitError(`Unknown modelId: ${modelId}`, 400)

  const garmentItems = normalizeGarments(garments, garment, garmentType)
  if (garmentItems.length === 0) throw createOutfitError('at least one garment image required', 400)

  const baseUrl = env.RELAY_BASE_URL || DEFAULT_BASE
  const { visionKey } = resolveKeys(modelId, env, clientKeys)
  return visionKey
    ? await analyzeOutfitReferences(baseUrl, visionKey, model, garmentItems)
    : null
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  try {
    const user = await requireAuth(env, request)
    const clientKeys = await mergeUserClientKeys(env, user.id, body?.clientKeys || {})
    return json(await executeOutfitSwap({ ...body, clientKeys }, env))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Outfit swap failed') }, error?.status || 502)
  }
}

function createOutfitError(message: string, status = 502) {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  return error
}

type GarmentItem = {
  base64: string
  mime?: string
  role?: string
  label?: string
  instructions?: string
}

type OutfitAnalysis = {
  model?: {
    framing?: string
    pose?: string
    background?: string
    lighting?: string
    notes?: string[]
  }
  garments?: Array<{
    index: number
    role?: string
    category?: string
    colors?: string[]
    pattern?: string
    silhouette?: string
    material?: string
    keyDetails?: string[]
    layering?: string
  }>
}

function normalizeGarments(
  garments: any,
  garment: any,
  garmentType: string,
): GarmentItem[] {
  if (Array.isArray(garments) && garments.length > 0) {
    return garments
      .filter((item) => item?.base64)
      .map((item) => ({
        base64: item.base64,
        mime: item.mime || 'image/jpeg',
        role: item.role || garmentType || 'full_outfit',
        label: item.label || '',
        instructions: cleanGarmentInstructions(item.instructions),
      }))
  }

  if (garment?.base64) {
    return [{
      base64: garment.base64,
      mime: garment.mime || 'image/jpeg',
      role: garmentType || 'full_outfit',
      label: '',
      instructions: '',
    }]
  }

  return []
}

async function analyzeOutfitReferences(
  baseUrl: string,
  visionKey: string,
  model: any,
  garments: GarmentItem[],
): Promise<OutfitAnalysis | null> {
  const content: any[] = [
    { type: 'image_url', image_url: { url: `data:${model.mime || 'image/jpeg'};base64,${model.base64}` } },
    ...garments.map((item) => ({
      type: 'image_url',
      image_url: { url: `data:${item.mime || 'image/jpeg'};base64,${item.base64}` },
    })),
    {
      type: 'text',
      text: `You are a fashion reference analyst preparing a virtual try-on prompt.

Image #1 is the MODEL. Images #2+ are GARMENT references.

Return JSON only:
{
  "model": {
    "framing": "full-body|three-quarter|upper-body|close-up",
    "pose": "...",
    "background": "...",
    "lighting": "...",
    "notes": ["..."]
  },
  "garments": [
    {
      "index": 2,
      "role": "top|bottom|dress|outerwear|full_outfit|shoes|accessory|other",
      "category": "...",
      "colors": ["..."],
      "pattern": "...",
      "silhouette": "...",
      "material": "...",
      "keyDetails": ["logos", "closures", "trim", "ruffles", "prints", "collar", "hem", "pockets", "toe shape", "sole", "heel", "laces"],
      "layering": "base|outer|shoes|accessory"
    }
  ]
}

Rules:
- Capture only visible facts
- Call out logos, graphics, embroidery, trims, seams, buttons, zippers, hems, pockets, prints, toe shape, soles, heels, laces, and color blocking
- Keep item indices aligned with the provided images
- If unsure, use short conservative descriptions`,
    },
  ]

  const raw = await callTextModel(
    baseUrl,
    visionKey,
    VISION_MODEL,
    [{ role: 'user', content }],
    { maxTokens: 4096, temperature: 0.1 },
  )
  if (!raw) return null

  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null

  try {
    return JSON.parse(match[0]) as OutfitAnalysis
  } catch {
    return null
  }
}

function buildSwapPrompt(
  model: any,
  garments: GarmentItem[],
  instructions: string,
  analysis: OutfitAnalysis | null,
): string {
  const garmentLines = garments.map((item, index) => {
    const role = describeGarmentRole(item.role || 'full_outfit')
    const label = item.label ? ` · 文件名参考: ${item.label}` : ''
    return `- Image #${index + 2}: ${role}${label}`
  }).join('\n')

  const modelAnalysis = analysis?.model
    ? `
## MODEL ANALYSIS
- Framing: ${analysis.model?.framing || 'preserve original framing'}
- Pose: ${analysis.model?.pose || 'preserve original pose'}
- Background: ${analysis.model?.background || 'preserve original background'}
- Lighting: ${analysis.model?.lighting || 'match original scene lighting'}${Array.isArray(analysis.model?.notes) && analysis.model.notes.length ? `\n- Notes: ${analysis.model.notes.join('; ')}` : ''}`
    : ''

  const garmentAnalysis = Array.isArray(analysis?.garments) && analysis.garments.length
    ? `
## GARMENT ANALYSIS
${analysis.garments.map((item) => {
  const details = [
    item.category ? `category=${item.category}` : '',
    Array.isArray(item.colors) && item.colors.length ? `colors=${item.colors.join('/')}` : '',
    item.pattern ? `pattern=${item.pattern}` : '',
    item.silhouette ? `silhouette=${item.silhouette}` : '',
    item.material ? `material=${item.material}` : '',
    item.layering ? `layering=${item.layering}` : '',
    Array.isArray(item.keyDetails) && item.keyDetails.length ? `details=${item.keyDetails.join(', ')}` : '',
  ].filter(Boolean).join(' · ')
  return `- Image #${item.index}: ${details || 'preserve all visible garment details'}`
}).join('\n')}`
    : ''
  const perGarmentInstructions = buildPerGarmentInstructions(garments)
  const modelInstructions = cleanGarmentInstructions(model?.instructions)

  return `# VIRTUAL TRY-ON / OUTFIT SWAP

You are given multiple images:
- Image #1: the MODEL (a person). Preserve their identity, face, hair, skin tone, body proportions, and pose.
${garmentLines}

Each garment image is a separate clothing item that must be combined onto the SAME person in one coherent final outfit.

## TASK
Generate one single new image of the SAME PERSON from Image #1 wearing ALL provided garment items together.
${modelAnalysis}
${garmentAnalysis}

## ABSOLUTE REQUIREMENTS
1. Identity: face, hair, skin tone, eye color, expression, body proportions, and camera framing of Image #1 person — UNCHANGED
2. OUTPUT IMAGE DIMENSIONS AND ASPECT RATIO: MUST match Image #1 (the model photo). Do NOT adopt the aspect ratio or dimensions of garment reference images
3. Garment fidelity: replicate every provided garment exactly — colors, patterns, prints, logos, trims, silhouette, fabric texture, closures, and proportion
3. Dress the model with ALL garments together as one coordinated layered look:
   - full outfit / dress items are the base look
   - top and bottom should be worn together when both exist
   - outerwear must layer above the base clothing
   - shoes should be placed on the feet, replacing only the original footwear or bare-foot region
   - accessories should complement the outfit naturally without replacing garments
4. Replace ONLY the relevant clothing regions; do not alter unrelated body parts, identity cues, hairstyle, hands, or background layout unless explicitly requested
5. Realistic fit: drape, folds, shadows, seam placement, and layering must look natural on the model's body and pose
6. Preserve visible branding, prints, trims, stitching, closures, hems, pockets, collars, ruffles, embroidery, toe boxes, soles, heels, laces, straps, and special details from every garment reference
7. If garment references conflict, prioritize a plausible styling solution that keeps each role recognizable and faithful
8. Background: keep Image #1 background (or use a clean studio background if Image #1 background is messy)
9. Lighting: relight the garments to match the scene lighting of Image #1
10. Output: photorealistic, e-commerce / lookbook quality, no watermarks, no text, no borders. The output image MUST use the same aspect ratio and framing as Image #1 (the model photo)

## GARMENT REFERENCES
${garmentLines}

## STYLING INTENT
- Keep the outfit commercially usable, realistic, and ready for catalog / lookbook review
- Do not invent extra garments unless needed to make the provided items wearable together
- Do not silently drop a supplied garment; the final image should clearly reflect all provided items
- If a garment reference is a flat-lay or product cutout, transfer the garment itself only; do not import its background or mannequin

${instructions ? `## ADDITIONAL INSTRUCTIONS\n${instructions}\n` : ''}
${modelInstructions ? `## MODEL ADDITIONAL INSTRUCTIONS\nApply only to Image #1, the model${model?.label ? ` (${model.label})` : ''}: ${modelInstructions}\n` : ''}
${perGarmentInstructions ? `## PER-GARMENT ADDITIONAL INSTRUCTIONS\n${perGarmentInstructions}\n` : ''}
Return one final composed image.`
}

function cleanGarmentInstructions(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 800)
}

function buildPerGarmentInstructions(garments: GarmentItem[]): string {
  return garments
    .map((item, index) => {
      const text = cleanGarmentInstructions(item.instructions)
      if (!text) return ''
      const role = describeGarmentRole(item.role || 'full_outfit')
      const label = item.label ? ` · ${item.label}` : ''
      return `- Image #${index + 2}: ${role}${label}\n  Apply only to this garment: ${text}`
    })
    .filter(Boolean)
    .join('\n')
}

function describeGarmentRole(role: string): string {
  const typeMap: Record<string, string> = {
    top: 'GARMENT role: top / shirt / t-shirt',
    bottom: 'GARMENT role: bottom / pants / skirt / shorts',
    dress: 'GARMENT role: dress',
    outerwear: 'GARMENT role: outerwear / jacket / coat',
    shoes: 'GARMENT role: shoes / footwear',
    full_outfit: 'GARMENT role: full outfit',
    accessory: 'GARMENT role: accessory',
  }
  return typeMap[role] || `GARMENT role: ${role}`
}
