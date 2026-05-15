// POST /api/translate — Two-stage image translation
import {
  Env, DEFAULT_BASE, VISION_MODEL, MODEL_MAP, LANG_NAMES,
  json, corsPreflight, resolveKeys, resolveImageModelOptions, callImageModel, callTextModel,
} from '../_shared'
import { requireAuth } from '../_lib/auth'
import { mergeUserClientKeys } from '../_lib/user-api-keys'

type OcrTextItem = {
  original: string
  translation: string | null
  translations?: Record<string, string | null>
  keep: boolean
  keepReason?: string
  position: string
  size: string
  style: string
}

type TranslateFontMode = 'match_original' | 'reference'

interface OcrResult {
  texts: OcrTextItem[]
  sourceLang: string
  textCount: number
  keepCount: number
  translateCount: number
}

interface OcrReviewResult {
  sourceLang?: string
  texts?: Array<{
    index: number
    translation?: string | null
    translations?: Record<string, string | null>
    keep?: boolean
    keepReason?: string
  }>
}

const OCR_LANG_ALIASES: Record<string, string> = {
  auto: 'auto',
  zh: 'zh',
  'zh-cn': 'zh',
  'zh_hans': 'zh',
  'zh-tw': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh_hant': 'zh-TW',
  en: 'en',
  english: 'en',
  ja: 'ja',
  japanese: 'ja',
  jp: 'ja',
  ko: 'ko',
  korean: 'ko',
  fr: 'fr',
  french: 'fr',
  de: 'de',
  german: 'de',
  es: 'es',
  spanish: 'es',
  pt: 'pt',
  portuguese: 'pt',
  ru: 'ru',
  russian: 'ru',
  ar: 'ar',
  arabic: 'ar',
  th: 'th',
  thai: 'th',
  vi: 'vi',
  vietnamese: 'vi',
  id: 'id',
  indonesian: 'id',
  ms: 'ms',
  malay: 'ms',
  tl: 'tl',
  filipino: 'tl',
  tagalog: 'tl',
  my: 'my',
  burmese: 'my',
  km: 'km',
  khmer: 'km',
  lo: 'lo',
  lao: 'lo',
  中文: 'zh',
  简体中文: 'zh',
  繁体中文: 'zh-TW',
  繁體中文: 'zh-TW',
  英语: 'en',
  英文: 'en',
  日语: 'ja',
  日本语: 'ja',
  日本語: 'ja',
  韩语: 'ko',
  韓語: 'ko',
}

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export async function executeTranslate(body: any, env: Env) {
  const {
    imageBase64, mime = 'image/jpeg',
    sourceLanguage = 'auto', targetLanguage,
    modelId = 'nano-banana-2', preserveBrand = true,
    fontMode = 'match_original', fontFamily = '', fontPrompt = '', fontReferenceImage = null,
    clientKeys = {},
  } = body ?? {}

  if (!imageBase64) throw createTranslateError('imageBase64 required', 400)
  if (!targetLanguage) throw createTranslateError('targetLanguage required', 400)
  if (!MODEL_MAP[modelId]) throw createTranslateError(`Unknown modelId: ${modelId}`, 400)

  const baseUrl = env.RELAY_BASE_URL || DEFAULT_BASE
  const { visionKey, genKey } = resolveKeys(modelId, env, clientKeys)
  const imageModelOptions = resolveImageModelOptions(modelId, env, clientKeys)
  if (!genKey) throw createTranslateError(`Missing API key for ${modelId}`, 400)

  let ocr: OcrResult | null = body?.ocrPlan
    ? selectOcrPlanForTarget(body.ocrPlan as OcrResult, targetLanguage)
    : null
  if (!ocr && visionKey) {
    ocr = await analyzeImageText(baseUrl, visionKey, imageBase64, mime, sourceLanguage, [targetLanguage], preserveBrand)
    if (ocr) {
      ocr.sourceLang = normalizeLanguageCode(ocr.sourceLang, sourceLanguage)
      ocr = await reviewOcrPlan(baseUrl, visionKey, ocr, [targetLanguage], preserveBrand) ?? ocr
      ocr = selectOcrPlanForTarget(ocr, targetLanguage)
    }
  }

  const normalizedFontMode = normalizeTranslateFontMode(fontMode)
  const fontReference = normalizeFontReferenceImage(fontReferenceImage)
  const prompt = buildTranslationPrompt(targetLanguage, sourceLanguage, ocr, preserveBrand, {
    mode: normalizedFontMode,
    family: fontFamily,
    prompt: fontPrompt,
    hasReferenceImage: Boolean(fontReference),
  })
  const imageInputs = [{ base64: imageBase64, mime }]
  if (fontReference) imageInputs.push(fontReference)
  const generated = await callImageModel(
    baseUrl,
    genKey,
    MODEL_MAP[modelId],
    imageInputs,
    prompt,
    imageModelOptions,
  )

  if (!generated.ok) throw createTranslateError(generated.error, generated.status || 502)

  return {
    resultDataUrl: generated.dataUrl,
    ocr: ocr ? {
      textCount: ocr.textCount, keepCount: ocr.keepCount,
      translateCount: ocr.translateCount, sourceLang: ocr.sourceLang,
    } : null,
  }
}

export async function prepareTranslatePlan(body: any, env: Env): Promise<OcrResult | null> {
  const {
    imageBase64, mime = 'image/jpeg',
    sourceLanguage = 'auto',
    modelId = 'nano-banana-2', preserveBrand = true,
    clientKeys = {},
  } = body ?? {}
  const targetLanguages = normalizeTargetLanguages(body?.targetLanguages || body?.targetLanguage)

  if (!imageBase64) throw createTranslateError('imageBase64 required', 400)
  if (targetLanguages.length === 0) throw createTranslateError('targetLanguages required', 400)
  if (!MODEL_MAP[modelId]) throw createTranslateError(`Unknown modelId: ${modelId}`, 400)

  const baseUrl = env.RELAY_BASE_URL || DEFAULT_BASE
  const { visionKey } = resolveKeys(modelId, env, clientKeys)
  if (!visionKey) return null

  let ocr = await analyzeImageText(baseUrl, visionKey, imageBase64, mime, sourceLanguage, targetLanguages, preserveBrand)
  if (!ocr) return null
  ocr.sourceLang = normalizeLanguageCode(ocr.sourceLang, sourceLanguage)
  ocr = await reviewOcrPlan(baseUrl, visionKey, ocr, targetLanguages, preserveBrand) ?? ocr
  return normalizeOcrPlan(ocr, targetLanguages)
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  try {
    const user = await requireAuth(env, request)
    const clientKeys = await mergeUserClientKeys(env, user.id, body?.clientKeys || {})
    return json(await executeTranslate({ ...body, clientKeys }, env))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Translate failed'), status: error?.status || 502 }, error?.status || 502)
  }
}

function createTranslateError(message: string, status = 502) {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  return error
}

async function analyzeImageText(
  baseUrl: string, visionKey: string,
  base64: string, mime: string,
  sourceLanguage: string, targetLanguages: string[], preserveBrand: boolean,
): Promise<OcrResult | null> {
  const targetLangName = formatTargetLanguageNames(targetLanguages)
  const sourceLangHint = sourceLanguage === 'auto'
    ? 'Detect the source language automatically.'
    : `The source language is ${LANG_NAMES[sourceLanguage] ?? sourceLanguage}.`

  const preserveSection = preserveBrand ? `
## BRAND PRESERVATION RULES (CRITICAL)
These text elements MUST be kept in their original form (set "keep": true, "translation": null):
- Brand logos and wordmarks (Nike, Apple, Samsung, any brand name rendered as logo)
- Product names and model numbers (iPhone 15 Pro, Air Max 270, Galaxy S24)
- SKU codes, serial numbers, catalog numbers
- Trademark symbols and registered brand text
- Chemical/ingredient names, patent numbers
- Social media handles (@brand, #hashtag)
- Domain names and URLs
- Certification marks (CE, FDA, ISO, etc.)

ONLY translate: marketing copy, feature descriptions, promotional slogans, instructional text, UI labels, price notes, footnotes, and general descriptive text.

When in doubt about whether something is a brand element → KEEP it (keep=true).` : `
## TRANSLATION MODE: AGGRESSIVE
Translate ALL visible text to ${targetLangName}.
Only keep: chemical formulas, mathematical symbols, URLs.`

  const prompt = `You are a meticulous OCR specialist for e-commerce product images.

TASK: Extract EVERY piece of text visible.
${sourceLangHint}
Target: ${targetLangName}
${preserveSection}

## TEXT SIZE CATEGORIES
- large: headlines, main product name
- medium: subheadings, features
- small: labels, footnotes, legal text
- tiny: micro-text, disclaimers, weight/size labels

## OUTPUT FORMAT (JSON only, no fences)
{
  "sourceLang": "Use one of: auto, zh, zh-TW, en, ja, ko, fr, de, es, pt, ru, ar, th, vi, id, ms, tl, my, km, lo",
  "textCount": <n>, "keepCount": <n>, "translateCount": <n>,
  "texts": [{
    "original": "...", "translation": "..." or null, "keep": true|false,
    "translations": { "ja": "...", "ko": "..." },
    "keepReason": "brand|logo|sku|trademark|product_name|url|certification",
    "position": "topLeft|topCenter|topRight|centerLeft|center|centerRight|bottomLeft|bottomCenter|bottomRight",
    "size": "large|medium|small|tiny", "style": "bold|italic|normal|decorative|outline"
  }]
}
CRITICAL: Do NOT omit ANY text. Small/tiny text must all be listed.
For every item where keep=false, fill "translations" for EACH target language code: ${targetLanguages.join(', ')}.`

  const raw = await callTextModel(
    baseUrl, visionKey, VISION_MODEL,
    [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
      { type: 'text', text: prompt },
    ]}],
    { maxTokens: 4096, temperature: 0.1 },
  )
  if (!raw) return null
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) as OcrResult } catch { return null }
}

async function reviewOcrPlan(
  baseUrl: string,
  visionKey: string,
  ocr: OcrResult,
  targetLanguages: string[],
  preserveBrand: boolean,
): Promise<OcrResult | null> {
  const reviewable = ocr.texts.filter((item) => item.original?.trim())
  if (reviewable.length === 0) return ocr

  const targetLangName = formatTargetLanguageNames(targetLanguages)
  const itemLines = reviewable.map((item, index) => {
    const translated = formatOcrTranslationsForPrompt(item, targetLanguages)
    return `${index + 1}. keep=${item.keep} size=${item.size} position=${item.position} original="${item.original}" proposed=${translated}${item.keepReason ? ` keepReason=${item.keepReason}` : ''}`
  }).join('\n')

  const prompt = `You are reviewing an OCR-to-image translation plan for an e-commerce image.

Target language: ${targetLangName}
Preserve brand mode: ${preserveBrand ? 'ON' : 'OFF'}

For each item below:
- Correct mistranslations, awkward phrasing, terminology, and grammar
- Preserve numbers, currency symbols, units, punctuation, model numbers, and short UI phrasing
- If the text is actually a brand / logo / SKU / product model / URL / certification, set keep=true and translation=null
- Keep the same order and item count
- Do not add explanations

Return JSON only:
{
  "sourceLang": "${ocr.sourceLang}",
  "texts": [
    { "index": 1, "keep": false, "translations": { "ja": "...", "ko": "..." }, "keepReason": "brand|logo|sku|trademark|product_name|url|certification" or null }
  ]
}

ITEMS
${itemLines}`

  const raw = await callTextModel(
    baseUrl,
    visionKey,
    VISION_MODEL,
    [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    { maxTokens: 4096, temperature: 0.1 },
  )
  if (!raw) return ocr

  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return ocr

  try {
    const reviewed = JSON.parse(match[0]) as OcrReviewResult
    return mergeReviewedOcr(ocr, reviewed)
  } catch {
    return ocr
  }
}

function buildTranslationPrompt(
  targetLanguage: string, sourceLanguage: string,
  ocr: OcrResult | null, preserveBrand: boolean,
  fontConfig: {
    mode?: TranslateFontMode
    family?: unknown
    prompt?: unknown
    hasReferenceImage?: boolean
  } = {},
): string {
  const targetLangName = LANG_NAMES[targetLanguage] ?? targetLanguage
  const normalizedSourceLang = normalizeLanguageCode(ocr?.sourceLang, sourceLanguage)
  const promptSourceLang = normalizedSourceLang && normalizedSourceLang !== 'auto'
    ? normalizedSourceLang
    : normalizeLanguageCode(sourceLanguage, 'auto')
  const sourceLangName = formatPromptLanguageName(promptSourceLang)
  const sourceTextLabel = promptSourceLang === 'auto'
    ? 'source-language'
    : sourceLangName
  const sourceLangHint = normalizedSourceLang && normalizedSourceLang !== 'auto'
    ? `The original image text is in ${sourceLangName}.`
    : sourceLanguage !== 'auto'
      ? `The original image text is in ${formatPromptLanguageName(sourceLanguage)}.`
      : 'Detect the source language from the image.'

  let keepList = '', translateList = ''
  if (ocr && ocr.texts.length > 0) {
    const keepItems = ocr.texts.filter(t => t.keep)
    const translateItems = ocr.texts.filter(t => !t.keep)
    if (keepItems.length > 0) {
      keepList = `\n\n## DO NOT TRANSLATE — Keep exactly as-is (${keepItems.length} items)\n` +
        keepItems.map((t, i) => `  ${i + 1}. [${t.position}] "${t.original}"${t.keepReason ? ` (${t.keepReason})` : ''}`).join('\n')
    }
    if (translateItems.length > 0) {
      translateList = `\n\n## TRANSLATE these (${translateItems.length} items)\n` +
        translateItems.map((t, i) => {
          const sizeNote = (t.size === 'small' || t.size === 'tiny') ? ' [SMALL — must not be skipped]' : ''
          return `  ${i + 1}. [${t.position}]${sizeNote} "${t.original}" → "${t.translation}"`
        }).join('\n')
    }
  }

  const preserveSection = preserveBrand ? `
## BRAND & LAYOUT PROTECTION
- NEVER alter: logos, brand wordmarks, product names, SKU codes, trademark text, certification marks
- These must appear pixel-perfect identical to the original
- The product itself, packaging shape, model number must remain unchanged` : ''
  const typographySection = buildTypographyPrompt(fontConfig)
  const omittedTextFallback = ocr
    ? `
## OCR PLAN SAFETY NET
- Treat the TRANSLATE list as the minimum required replacements, not as the only translatable text in the image.
- Also translate any other visible ${sourceTextLabel} marketing copy, feature description, slogan, instruction, UI label, note, or body text that is not listed in the OCR plan.
- Do not translate text explicitly listed in DO NOT TRANSLATE, brand marks, product names, SKU/model codes, URLs, chemical names, patent text, or certification labels.
- Replace source-language text in place. Do not leave the original ${sourceTextLabel} next to, above, or below the translated text unless it is in DO NOT TRANSLATE.`
    : ''

  return `You are a professional e-commerce image localization specialist.

## TASK
Recreate this image with source-language marketing and descriptive text translated to ${targetLangName}.

## IMAGE INPUTS
- Image #1 is the source image to translate.
${fontConfig.hasReferenceImage ? '- Image #2 is a font reference. Use it only for typography: typeface shape, stroke contrast, weight, width, spacing, corners, and decorative treatment. Do NOT copy its words, layout, colors, background, or composition.' : '- No separate font reference image is provided.'}

## SOURCE
${sourceLangHint}
${preserveSection}
${typographySection}
${omittedTextFallback}

## ABSOLUTE REQUIREMENTS
1. PRESERVE: overall layout, composition, background, product visuals, packaging, illustrations
2. PRESERVE: image dimensions, proportions, color grading
3. MATCH: original font style, weight, size, color, shadow for each translated text element
4. TRANSLATE: every item listed in the TRANSLATE section below, plus any other visible source-language descriptive text not protected by the keep rules
5. KEEP VERBATIM: all items in the DO NOT TRANSLATE section
6. Do NOT add watermarks, borders, or any elements not in the original
7. Small/tiny text in the translate list MUST be translated — do not skip them
8. Replace source text with translated text; do not create bilingual duplicates or leave leftover source-language text
9. For right-to-left languages (Arabic, Hebrew), mirror the text direction${keepList}${translateList}

${!ocr ? `Translate all descriptive/marketing text to ${targetLangName}.${preserveBrand ? ' Preserve all logos, brand names, product model numbers, and SKU codes exactly.' : ''}` : ''}

Regenerate the complete image with these precise localization changes only.`
}

function formatPromptLanguageName(language: string): string {
  const normalized = normalizeLanguageCode(language, language)
  const names: Record<string, string> = {
    auto: 'the detected source language',
    zh: 'Simplified Chinese',
    'zh-TW': 'Traditional Chinese',
    en: 'English',
    ja: 'Japanese',
    ko: 'Korean',
    fr: 'French',
    de: 'German',
    es: 'Spanish',
    pt: 'Portuguese',
    ru: 'Russian',
    ar: 'Arabic',
    th: 'Thai',
    vi: 'Vietnamese',
    id: 'Indonesian',
    ms: 'Malay',
    tl: 'Filipino',
    my: 'Burmese',
    km: 'Khmer',
    lo: 'Lao',
  }
  return names[normalized] || LANG_NAMES[normalized] || normalized || 'the source language'
}

function buildTypographyPrompt(fontConfig: {
  mode?: TranslateFontMode
  family?: unknown
  prompt?: unknown
  hasReferenceImage?: boolean
}): string {
  const mode = normalizeTranslateFontMode(fontConfig.mode)
  const prompt = cleanFontText(fontConfig.prompt, 500)
  const extra = prompt ? `\n- Extra typography instruction from the user: ${prompt}` : ''

  if (mode === 'reference') {
    return `
## TYPOGRAPHY STRATEGY
- Use Image #2 as the typography reference only.
- Match its typeface shape, weight, width, letter spacing, stroke contrast, corner radius, and decorative features.
- Do not copy any words or layout from Image #2.
- Preserve the source image layout, text positions, colors, effects, and hierarchy from Image #1.${extra}`
  }

  return `
## TYPOGRAPHY STRATEGY
- Follow Image #1 typography directly: match each original text element's font style, weight, width, size, color, outline, shadow, alignment, and spacing.
- Do not substitute generic default fonts when the original has distinctive typography.${extra}`
}

function normalizeTranslateFontMode(value: unknown): TranslateFontMode {
  return value === 'reference' ? value : 'match_original'
}

function cleanFontText(value: unknown, limit: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function normalizeFontReferenceImage(value: unknown): { base64: string; mime: string } | null {
  if (!value || typeof value !== 'object') return null
  const image = value as { base64?: unknown; mime?: unknown }
  const base64 = String(image.base64 || '').trim()
  if (!base64) return null
  const mime = String(image.mime || 'image/png').trim() || 'image/png'
  return { base64, mime }
}

function mergeReviewedOcr(ocr: OcrResult, reviewed: OcrReviewResult): OcrResult {
  const updates = new Map((reviewed.texts || []).map((item) => [Number(item.index), item]))

  const texts = ocr.texts.map((item, index) => {
    const update = updates.get(index + 1)
    if (!update) return item

    const keep = typeof update.keep === 'boolean' ? update.keep : item.keep
    const translations = keep
      ? {}
      : sanitizeReviewedTranslations(update.translations, item.translations, item.translation, item.original)
    const translation = keep
      ? null
      : sanitizeReviewedTranslation(update.translation, item.translation || firstTranslation(translations), item.original)

    return {
      ...item,
      keep,
      translation,
      translations,
      keepReason: keep
        ? normalizeKeepReason(update.keepReason || item.keepReason || 'brand')
        : undefined,
    }
  })

  return {
    sourceLang: normalizeLanguageCode(reviewed.sourceLang, ocr.sourceLang),
    texts,
    textCount: texts.length,
    keepCount: texts.filter((item) => item.keep).length,
    translateCount: texts.filter((item) => !item.keep).length,
  }
}

function normalizeTargetLanguages(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value]
  return raw
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
}

function formatTargetLanguageNames(targetLanguages: string[]): string {
  return targetLanguages
    .map((language) => `${LANG_NAMES[language] ?? language} (${language})`)
    .join(', ')
}

function formatOcrTranslationsForPrompt(item: OcrTextItem, targetLanguages: string[]): string {
  const translations = item.translations && typeof item.translations === 'object' ? item.translations : {}
  const mapped = targetLanguages.map((language) => {
    const value = translations[language] || (targetLanguages.length === 1 ? item.translation : '')
    return `${language}=${value ? `"${value}"` : 'null'}`
  })
  return `{ ${mapped.join(', ')} }`
}

function firstTranslation(translations: Record<string, string | null> = {}): string {
  for (const value of Object.values(translations)) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function sanitizeReviewedTranslations(
  candidate: unknown,
  fallback: unknown,
  legacyFallback: string | null | undefined,
  original: string,
): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  const candidateMap = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {}
  const fallbackMap = fallback && typeof fallback === 'object' ? fallback as Record<string, unknown> : {}
  for (const key of new Set([...Object.keys(fallbackMap), ...Object.keys(candidateMap)])) {
    out[key] = sanitizeReviewedTranslation(
      typeof candidateMap[key] === 'string' ? candidateMap[key] as string : null,
      typeof fallbackMap[key] === 'string' ? fallbackMap[key] as string : legacyFallback,
      original,
    )
  }
  return out
}

function normalizeOcrPlan(ocr: OcrResult, targetLanguages: string[]): OcrResult {
  const texts = Array.isArray(ocr?.texts) ? ocr.texts : []
  const normalized = texts.map((item) => {
    const keep = Boolean(item.keep)
    const translations = keep
      ? {}
      : sanitizePlanTranslations(item, targetLanguages)
    return {
      ...item,
      keep,
      translation: keep ? null : (firstTranslation(translations) || item.translation || item.original),
      translations,
    }
  })
  return {
    sourceLang: normalizeLanguageCode(ocr?.sourceLang, 'auto'),
    texts: normalized,
    textCount: normalized.length,
    keepCount: normalized.filter((item) => item.keep).length,
    translateCount: normalized.filter((item) => !item.keep).length,
  }
}

function sanitizePlanTranslations(item: OcrTextItem, targetLanguages: string[]): Record<string, string | null> {
  const translations = item.translations && typeof item.translations === 'object' ? item.translations : {}
  const out: Record<string, string | null> = {}
  for (const language of targetLanguages) {
    out[language] = sanitizeReviewedTranslation(
      typeof translations[language] === 'string' ? translations[language] : null,
      targetLanguages.length === 1 ? item.translation : '',
      item.original,
    )
  }
  return out
}

function selectOcrPlanForTarget(ocr: OcrResult, targetLanguage: string): OcrResult | null {
  if (!ocr || !Array.isArray(ocr.texts)) return null
  const texts = ocr.texts.map((item) => {
    const translations = item.translations && typeof item.translations === 'object' ? item.translations : {}
    const translation = item.keep
      ? null
      : sanitizeReviewedTranslation(
          typeof translations[targetLanguage] === 'string' ? translations[targetLanguage] : null,
          item.translation,
          item.original,
        )
    return {
      ...item,
      translation,
    }
  })
  return {
    sourceLang: normalizeLanguageCode(ocr.sourceLang, 'auto'),
    texts,
    textCount: texts.length,
    keepCount: texts.filter((item) => item.keep).length,
    translateCount: texts.filter((item) => !item.keep).length,
  }
}

function sanitizeReviewedTranslation(
  candidate: string | null | undefined,
  fallback: string | null | undefined,
  original: string,
): string {
  const cleaned = String(candidate || '').trim()
  if (cleaned) return cleaned
  const preserved = String(fallback || '').trim()
  return preserved || original
}

function normalizeKeepReason(candidate: string | undefined): string {
  const value = String(candidate || '').trim()
  return ['brand', 'logo', 'sku', 'trademark', 'product_name', 'url', 'certification'].includes(value)
    ? value
    : 'brand'
}

function normalizeLanguageCode(candidate: string | undefined | null, fallback = 'auto'): string {
  if (!candidate) return fallback
  const normalized = String(candidate).trim().replace(/_/g, '-')
  const lowered = normalized.toLowerCase()
  return OCR_LANG_ALIASES[normalized] || OCR_LANG_ALIASES[lowered] || normalized || fallback
}
