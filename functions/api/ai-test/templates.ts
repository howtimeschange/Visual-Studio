import { Env, json } from '../../_shared'
import { requireAuth } from '../../_lib/auth'
import { requireAdmin } from '../../_lib/admin'
import {
  activateAiTestPromptVersion,
  createAiTestPromptVersion,
  getActiveAiTestPromptTemplate,
  listAiTestCategoryFactors,
  listAiTestPromptTemplates,
} from '../../_lib/v2-store'

const DEFAULT_TEMPLATE_KEY = 'children_main_image'
const TEMPLATE_KEY_PATTERN = /^[a-z0-9_-]{1,80}$/i

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })

async function readJsonBody(request: Request): Promise<any> {
  try {
    return await request.json()
  } catch {
    const error = new Error('Invalid JSON') as Error & { status?: number }
    error.status = 400
    throw error
  }
}

async function buildTemplatePayload(env: Env, templateKey = DEFAULT_TEMPLATE_KEY) {
  const activeTemplate = await getActiveAiTestPromptTemplate(env, templateKey)
  if (templateKey !== DEFAULT_TEMPLATE_KEY && activeTemplate.key !== templateKey) {
    throw createRouteError(`AI test prompt template not found: ${templateKey}`, 404)
  }
  const [templates, categoryFactors] = await Promise.all([
    listAiTestPromptTemplates(env),
    listAiTestCategoryFactors(env),
  ])

  return {
    activeTemplate,
    active: activeTemplate,
    templates,
    categoryFactors,
    directions: activeTemplate.activeVersion?.directions || [],
  }
}

function createRouteError(message: string, status: number): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  return error
}

function normalizeTemplateKey(value: unknown): string {
  const key = String(value || DEFAULT_TEMPLATE_KEY).trim()
  if (!TEMPLATE_KEY_PATTERN.test(key)) {
    throw createRouteError('Invalid templateKey', 400)
  }
  return key
}

function normalizeVersionId(value: unknown): string {
  const versionId = String(value || '').trim()
  if (!versionId) throw createRouteError('versionId required', 400)
  if (!/^[a-z0-9_-]{1,120}$/i.test(versionId)) throw createRouteError('Invalid versionId', 400)
  return versionId
}

function normalizePromptVersionBody(body: any) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createRouteError('Request body must be an object', 400)
  }
  const title = String(body.title || '').replace(/\s+/g, ' ').trim()
  const promptBody = String(body.promptBody || '').trim()
  if (!title) throw createRouteError('title required', 400)
  if (!promptBody) throw createRouteError('promptBody required', 400)
  return {
    templateKey: normalizeTemplateKey(body.templateKey),
    title,
    promptBody,
    negativePrompt: body.negativePrompt === undefined ? undefined : String(body.negativePrompt),
    directions: body.directions,
    variables: body.variables,
    notes: body.notes === undefined ? undefined : String(body.notes),
  }
}

function errorResponse(error: any, fallback = 'AI test template request failed') {
  const message = String(error?.message || fallback)
  const inferredStatus = /not found/i.test(message) ? 404 : undefined
  return json({ error: message }, error?.status || inferredStatus || 500)
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAuth(env, request)
    const url = new URL(request.url)
    return json(await buildTemplatePayload(env, normalizeTemplateKey(url.searchParams.get('templateKey'))))
  } catch (error: any) {
    return errorResponse(error)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const admin = await requireAdmin(env, request)
    const body = await readJsonBody(request)
    const input = normalizePromptVersionBody(body)
    const created = await createAiTestPromptVersion(env, {
      templateKey: input.templateKey,
      title: input.title,
      promptBody: input.promptBody,
      negativePrompt: input.negativePrompt,
      directions: input.directions,
      variables: input.variables,
      notes: input.notes,
      createdByUserId: admin.id,
    })
    const payload = await buildTemplatePayload(env, input.templateKey)
    return json({ ...payload, createdVersion: created, version: created }, 201)
  } catch (error: any) {
    return errorResponse(error, 'Create AI test prompt version failed')
  }
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAdmin(env, request)
    const body = await readJsonBody(request)
    const action = String(body?.action || '').trim()
    if (!['activate', 'setActive', 'default'].includes(action)) {
      return json({ error: 'Unsupported action' }, 400)
    }

    const versionId = normalizeVersionId(body?.versionId)
    const templateKey = normalizeTemplateKey(body?.templateKey)
    const activeTemplate = await activateAiTestPromptVersion(env, templateKey, versionId)
    const payload = await buildTemplatePayload(env, templateKey)
    return json({ ...payload, activeTemplate, active: activeTemplate })
  } catch (error: any) {
    return errorResponse(error, 'Activate AI test prompt version failed')
  }
}
