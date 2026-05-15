import type { Env } from '../_shared'
import type {
  ConversationRecord,
  ConversationTurnRecord,
  JobItemRecord,
  JobRecord,
} from '../../packages/contracts/v2'
import { buildOutfitLooks } from '../../packages/core/outfit-looks'
import { createId, nowIso } from '../../packages/core/id'
import { stableHash } from '../../packages/core/hash'
import { sealJson, unsealJson } from '../../packages/core/crypto'
import {
  createAsset,
  createConversation,
  createConversationTurn,
  createJob,
  createJobItems,
  createSealedCredential,
  createUsageEvent,
  deleteJobRecord,
  deleteSealedCredential,
  ensureSession,
  getAsset,
  getAssetDataUrl,
  getConversation,
  getConversationTurn,
  getJob,
  getSealedCredential,
  listConversationTurns,
  listJobItems,
  listJobsByStatus,
  updateConversationTurn,
  updateJob,
  updateJobItem,
} from './v2-store'
import { publishEvent } from './v2-events'
import { createJobQueueMessage, dispatchQueuedJob } from './v2-queue'
import { loadUserClientKeys, sanitizeClientKeys } from './user-api-keys'
import { executeTranslate, prepareTranslatePlan } from '../api/translate'
import { executeOutfitSwap, prepareOutfitAnalysis } from '../api/outfit-swap'
import { buildGenerateExecutionContext, executeGenerate } from '../api/generate'
import { executeDirectGenerate, normalizeDirectGenerateRequest } from '../api/generate-direct'

type WaitUntil = (promise: Promise<unknown>) => void

type ClientKeys = Record<string, unknown>
type TranslateFontMode = 'match_original' | 'reference'
const AUTO_RETRY_LIMIT = 2
const AUTO_RETRY_DELAY_MS = 1200
const DEFAULT_STALE_JOB_ITEM_MS = 30 * 60_000
const MAX_JOB_ITEM_ATTEMPTS = AUTO_RETRY_LIMIT + 1
const TERMINAL_JOB_STATUSES = new Set(['completed', 'partial_failed', 'failed', 'cancelled'])
const STOPPED_JOB_STATUSES = new Set(['paused', 'cancelled'])

function splitDataUrl(dataUrl: string): { mime: string; base64: string } {
  const match = String(dataUrl || '').match(/^data:(image\/[^;]+);base64,(.+)$/)
  if (!match) return { mime: 'image/png', base64: '' }
  return { mime: match[1], base64: match[2] }
}

function addMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Math.floor(Number(value))
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

function clampMs(value: unknown, fallback: number): number {
  const numeric = Math.floor(Number(value))
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.min(24 * 60 * 60_000, Math.max(60_000, numeric))
}

function cleanInstruction(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 800)
}

function normalizeTranslateFontMode(value: unknown): TranslateFontMode {
  return value === 'reference' ? value : 'match_original'
}

function cleanFontReferenceAssetId(value: unknown): string {
  return String(value || '').trim().slice(0, 120)
}

function normalizeTranslateFontConfig(body: any): {
  fontMode: TranslateFontMode
  fontFamily: string
  fontReferenceAssetId: string
  fontPrompt: string
} {
  const fontMode = normalizeTranslateFontMode(body?.fontMode)
  return {
    fontMode,
    fontFamily: '',
    fontReferenceAssetId: fontMode === 'reference' ? cleanFontReferenceAssetId(body?.fontReferenceAssetId) : '',
    fontPrompt: fontMode === 'reference' ? cleanInstruction(body?.fontPrompt) : '',
  }
}

function getOutfitGarmentFingerprint(
  garments: Array<{ assetId: string; role: string; instructions: string }>,
): string {
  return garments
    .map((item) => `${item.assetId}:${item.role || 'full_outfit'}:${cleanInstruction(item.instructions)}`)
    .sort()
    .join('|')
}

function normalizeOutfitModels(body: any): Array<{ assetId: string; label: string; instructions: string }> {
  if (Array.isArray(body?.models) && body.models.length > 0) {
    return body.models
      .filter((item: any) => item?.assetId || item?.id)
      .map((item: any) => {
        const assetId = String(item.assetId || item.id)
        return {
          assetId,
          label: String(item.label || item.name || assetId),
          instructions: cleanInstruction(item.instructions),
        }
      })
  }

  return (Array.isArray(body?.modelAssetIds) ? body.modelAssetIds : [])
    .filter(Boolean)
    .map((assetId: any) => ({
      assetId: String(assetId),
      label: String(assetId),
      instructions: '',
    }))
}

function createAssetDataUrlCache(env: Env) {
  const cache = new Map<string, Promise<string | null>>()
  return (assetId: string) => {
    const id = String(assetId || '').trim()
    if (!id) return Promise.resolve(null)
    if (!cache.has(id)) cache.set(id, getAssetDataUrl(env, id))
    return cache.get(id) as Promise<string | null>
  }
}

function createTranslationPlanCache(env: Env, job: JobRecord, clientKeys: ClientKeys, getCachedAssetDataUrl: (assetId: string) => Promise<string | null>) {
  const cache = new Map<string, Promise<any | null>>()
  return async (assetId: string) => {
    const id = String(assetId || '').trim()
    if (!id) return null
    if (!cache.has(id)) {
      cache.set(id, (async () => {
        const dataUrl = await getCachedAssetDataUrl(id)
        if (!dataUrl) throw createRunnerError(`Asset not found: ${id}`, 404)
        const { mime, base64 } = splitDataUrl(dataUrl)
        return prepareTranslatePlan({
          imageBase64: base64,
          mime,
          sourceLanguage: job.configJson.sourceLanguage,
          targetLanguages: job.configJson.targetLanguages,
          modelId: job.configJson.modelId,
          preserveBrand: job.configJson.preserveBrand,
          clientKeys,
        }, env)
      })())
    }
    return cache.get(id) as Promise<any | null>
  }
}

function createOutfitAnalysisCache(env: Env, job: JobRecord, clientKeys: ClientKeys) {
  const cache = new Map<string, Promise<any | null>>()
  return (key: string, model: { base64: string; mime: string }, garments: Array<Record<string, unknown>>) => {
    const cacheKey = String(key || '').trim()
    if (!cacheKey) return Promise.resolve(null)
    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, prepareOutfitAnalysis({
        modelId: job.configJson.modelId,
        model,
        garments,
        clientKeys,
      }, env))
    }
    return cache.get(cacheKey) as Promise<any | null>
  }
}

function getOutfitAnalysisCacheKey(item: JobItemRecord): string {
  return JSON.stringify({
    modelAssetId: String(item.inputJson.modelAssetId || ''),
    lookAssetIds: Array.isArray(item.inputJson.lookAssetIds) ? item.inputJson.lookAssetIds.map(String) : [],
    lookRoles: Array.isArray(item.inputJson.lookRoles) ? item.inputJson.lookRoles.map(String) : [],
    lookInstructions: Array.isArray(item.inputJson.lookInstructions) ? item.inputJson.lookInstructions.map(String) : [],
  })
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index]
      index += 1
      await worker(item)
    }
  })
  await Promise.all(workers)
}

function queueProgressPublisher(env: Env, jobId: string) {
  let chain = Promise.resolve()
  return {
    publish() {
      chain = chain
        .catch(() => undefined)
        .then(async () => {
          const nextJob = await updateJobCounts(env, jobId)
          if (nextJob) await publishJobProgress(env, nextJob)
        })
    },
    async drain() {
      await chain.catch(() => undefined)
    },
  }
}

async function maybeSealClientKeys(env: Env, jobId: string, clientKeys: ClientKeys): Promise<string | null> {
  if (!clientKeys || Object.keys(clientKeys).length === 0) return null
  const ciphertext = await sealJson(clientKeys, jobCredentialSecret(env))
  const record = await createSealedCredential(env, jobId, ciphertext, addMinutes(30))
  return record.id
}

function jobCredentialSecret(env: Env): string | undefined {
  return env.VS_JOB_CREDENTIAL_KEK || env.CREDENTIAL_KEK
}

function jobCredentialSecrets(env: Env): string[] {
  return [...new Set([
    String(env.VS_JOB_CREDENTIAL_KEK || '').trim(),
    String(env.CREDENTIAL_KEK || '').trim(),
  ].filter(Boolean))]
}

async function loadClientKeys(env: Env, credentialId?: string | null): Promise<ClientKeys> {
  if (!credentialId) return {}
  const record = await getSealedCredential(env, credentialId)
  if (!record) return {}
  const secrets = jobCredentialSecrets(env)
  if (secrets.length === 0) {
    return unsealJson<ClientKeys>(record.ciphertext, undefined)
  }

  let lastError: unknown = null
  for (const secret of secrets) {
    try {
      return await unsealJson<ClientKeys>(record.ciphertext, secret)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}

async function loadJobClientKeys(env: Env, job: JobRecord): Promise<ClientKeys> {
  const sealedKeys = await loadClientKeys(env, String(job.configJson?.sealedCredentialId || ''))
  if (Object.keys(sealedKeys).length > 0) return sealedKeys
  return loadUserClientKeys(env, job.userId || null)
}

async function finalizeCredential(env: Env, credentialId?: string | null): Promise<void> {
  if (credentialId) await deleteSealedCredential(env, credentialId)
}

async function publishJobProgress(env: Env, job: JobRecord) {
  await publishEvent(env, 'job', job.id, 'job_progress', {
    status: job.status,
    progressTotal: job.progressTotal,
    progressDone: job.progressDone,
    progressFailed: job.progressFailed,
  })
}

async function updateJobCounts(env: Env, jobId: string): Promise<JobRecord | null> {
  const items = await listJobItems(env, jobId)
  const progressDone = items.filter((item) => item.status === 'completed').length
  const progressFailed = items.filter((item) => item.status === 'failed').length
  return updateJob(env, jobId, { progressDone, progressFailed })
}

function createJobSummary(items: JobItemRecord[]): Record<string, unknown> {
  return {
    total: items.length,
    completed: items.filter((item) => item.status === 'completed').length,
    failed: items.filter((item) => item.status === 'failed').length,
  }
}

function isRetryableError(error: any): boolean {
  const status = Number(error?.status || error?.payload?.status || 0)
  return [408, 409, 425, 429].includes(status) || status >= 500 || status === 0
}

async function runWithAutoRetry<T>(task: () => Promise<T>): Promise<{ result: T; attempts: number }> {
  let attempt = 1
  let lastError: any = null

  while (attempt <= AUTO_RETRY_LIMIT + 1) {
    try {
      const result = await task()
      return { result, attempts: attempt }
    } catch (error: any) {
      lastError = error
      if (attempt > AUTO_RETRY_LIMIT || !isRetryableError(error)) {
        error.attempts = attempt
        throw error
      }
      await wait(AUTO_RETRY_DELAY_MS * attempt)
      attempt += 1
    }
  }

  throw lastError || createRunnerError('Retry failed', 502)
}

async function requeueItems(env: Env, jobId: string, items: JobItemRecord[]): Promise<void> {
  await Promise.all(items.map((item) => updateJobItem(env, jobId, item.id, {
    status: 'queued',
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
  })))
}

async function scheduleJobExecution(
  env: Env,
  job: JobRecord,
  waitUntil: WaitUntil | undefined,
  reason: 'submit' | 'retry' | 'recover',
  clientKeys: ClientKeys = {},
) {
  return dispatchQueuedJob(
    env,
    waitUntil,
    createJobQueueMessage({
      jobId: job.id,
      jobType: job.type,
      reason,
      clientKeys: Object.keys(clientKeys || {}).length ? sanitizeClientKeys(clientKeys) : undefined,
    }),
    () => runQueuedJob(env, job.id),
  )
}

export async function submitTranslateBatch(
  env: Env,
  body: any,
  waitUntil?: WaitUntil,
) {
  const userId = typeof body?._authUserId === 'string' ? body._authUserId : null
  const session = await ensureSession(env, body?.sessionId, userId)
  const assetIds = Array.isArray(body?.assetIds) ? body.assetIds.filter(Boolean) : []
  const targetLanguages = Array.isArray(body?.targetLanguages) ? body.targetLanguages.filter(Boolean) : []
  if (assetIds.length === 0) throw createRunnerError('assetIds required', 400)
  if (targetLanguages.length === 0) throw createRunnerError('targetLanguages required', 400)

  const jobId = createId('job')
  const fontConfig = normalizeTranslateFontConfig(body)
  const configJson = {
    modelId: body?.modelId || 'nano-banana-2',
    sourceLanguage: body?.sourceLanguage || 'auto',
    targetLanguages,
    preserveBrand: body?.preserveBrand !== false,
    concurrency: Math.max(1, Number(body?.concurrency || 3)),
    assetIds,
    ...fontConfig,
    configHash: await stableHash({
      modelId: body?.modelId || 'nano-banana-2',
      sourceLanguage: body?.sourceLanguage || 'auto',
      targetLanguages,
      preserveBrand: body?.preserveBrand !== false,
      assetIds,
      ...fontConfig,
    }),
  }
  const sealedCredentialId = await maybeSealClientKeys(env, jobId, body?.clientKeys || {})

  const job = await createJob(env, {
    id: jobId,
    sessionId: session.id,
    userId,
    type: 'translate_batch',
    status: 'queued',
    configJson: { ...configJson, sealedCredentialId },
    summaryJson: {},
    progressTotal: assetIds.length * targetLanguages.length,
    progressDone: 0,
    progressFailed: 0,
  })

  const items = await createJobItems(env, job.id, assetIds.flatMap((assetId: string) =>
    targetLanguages.map((targetLanguage: string) => ({
      jobId: job.id,
      itemType: 'translate_cell',
      status: 'queued',
      inputJson: { assetId, targetLanguage },
      outputJson: {},
      attemptCount: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
    }))))

  await publishEvent(env, 'job', job.id, 'status', { status: 'queued', type: job.type })
  await publishJobProgress(env, job)

  await scheduleJobExecution(env, job, waitUntil, 'submit', body?.clientKeys || {})

  return { jobId: job.id, sessionId: session.id, itemCount: items.length }
}

async function runTranslateBatchJob(env: Env, jobId: string) {
  const initialJob = await getJob(env, jobId)
  if (!initialJob) return
  if (STOPPED_JOB_STATUSES.has(initialJob.status)) return
  const clientKeys = await loadJobClientKeys(env, initialJob)
  await updateJob(env, jobId, { status: 'running' })
  await publishEvent(env, 'job', jobId, 'status', { status: 'running' })

  const items = (await listJobItems(env, jobId)).filter((item) => item.status === 'queued')
  const concurrency = clampInt(initialJob.configJson?.concurrency, 1, 6, 2)
  const progress = queueProgressPublisher(env, jobId)
  const getCachedAssetDataUrl = createAssetDataUrlCache(env)
  const getCachedTranslatePlan = createTranslationPlanCache(env, initialJob, clientKeys, getCachedAssetDataUrl)

  await runPool(items, concurrency, async (item) => {
    const job = await getJob(env, jobId)
    if (!job || STOPPED_JOB_STATUSES.has(job.status)) return

    await updateJobItem(env, jobId, item.id, {
      status: 'running',
      attemptCount: item.attemptCount + 1,
      startedAt: nowIso(),
      errorCode: null,
      errorMessage: null,
    })
    await publishEvent(env, 'item', item.id, 'item_started', { jobId, itemType: item.itemType })

    try {
      const assetId = String(item.inputJson.assetId || '')
      const fontReferenceAssetId = String(job.configJson.fontReferenceAssetId || '').trim()
      const [sourceAsset, dataUrl, ocrPlan, fontReferenceDataUrl] = await Promise.all([
        getAsset(env, assetId),
        getCachedAssetDataUrl(assetId),
        getCachedTranslatePlan(assetId),
        fontReferenceAssetId ? getCachedAssetDataUrl(fontReferenceAssetId) : Promise.resolve(null),
      ])
      if (!dataUrl) throw createRunnerError(`Asset not found: ${assetId}`, 404)
      const { mime, base64 } = splitDataUrl(dataUrl)
      const fontReferenceImage = fontReferenceDataUrl ? splitDataUrl(fontReferenceDataUrl) : null
      const { result, attempts } = await runWithAutoRetry(() => executeTranslate({
        imageBase64: base64,
        mime,
        sourceLanguage: job.configJson.sourceLanguage,
        targetLanguage: item.inputJson.targetLanguage,
        modelId: job.configJson.modelId,
        preserveBrand: job.configJson.preserveBrand,
        fontMode: job.configJson.fontMode,
        fontFamily: job.configJson.fontFamily,
        fontReferenceImage,
        fontPrompt: job.configJson.fontPrompt,
        sourceWidth: sourceAsset?.width || null,
        sourceHeight: sourceAsset?.height || null,
        ocrPlan,
        clientKeys,
      }, env))

      const resultAsset = await createAsset(env, {
        sessionId: job.sessionId,
        userId: job.userId || null,
        kind: 'result',
        source: 'translate_batch',
        dataUrl: result.resultDataUrl,
        filename: `${assetId}.${item.inputJson.targetLanguage}.png`,
      })

      await updateJobItem(env, jobId, item.id, {
        status: 'completed',
        attemptCount: attempts,
        outputJson: {
          resultAssetId: resultAsset.id,
          ocr: result.ocr || null,
          targetLanguage: item.inputJson.targetLanguage,
        },
        finishedAt: nowIso(),
      })
      await publishEvent(env, 'item', item.id, 'item_completed', {
        jobId,
        resultAssetId: resultAsset.id,
        targetLanguage: item.inputJson.targetLanguage,
      })
      await createUsageEvent(env, {
        userId: job.userId || null,
        sessionId: job.sessionId,
        jobId,
        eventType: 'translate_result',
        amount: 1,
        provider: '1xm.ai',
        modelId: String(job.configJson.modelId || ''),
      })
    } catch (error: any) {
      await updateJobItem(env, jobId, item.id, {
        status: 'failed',
        attemptCount: Number(error?.attempts || item.attemptCount || 1),
        errorCode: 'translate_failed',
        errorMessage: String(error?.message || 'Translate failed'),
        finishedAt: nowIso(),
      })
      await publishEvent(env, 'item', item.id, 'item_failed', {
        jobId,
        error: String(error?.message || 'Translate failed'),
      })
    }

    progress.publish()
  })

  await progress.drain()

  const latestJob = await getJob(env, jobId)
  if (latestJob?.status === 'paused') {
    return
  }
  if (latestJob?.status === 'cancelled') {
    await markRemainingItemsCancelled(env, jobId)
    await finalizeCredential(env, String(initialJob.configJson?.sealedCredentialId || ''))
    return
  }

  const finalItems = await listJobItems(env, jobId)
  const failed = finalItems.filter((item) => item.status === 'failed').length
  const completed = finalItems.filter((item) => item.status === 'completed').length
  const status = completed === 0 ? 'failed' : failed > 0 ? 'partial_failed' : 'completed'
  const finalJob = await updateJob(env, jobId, {
    status,
    summaryJson: createJobSummary(finalItems),
  })
  if (finalJob) {
    await publishEvent(env, 'job', jobId, 'job_completed', {
      status: finalJob.status,
      summary: finalJob.summaryJson,
    })
  }

  await finalizeCredential(env, String(initialJob.configJson?.sealedCredentialId || ''))
}

export async function submitOutfitBatch(
  env: Env,
  body: any,
  waitUntil?: WaitUntil,
) {
  const userId = typeof body?._authUserId === 'string' ? body._authUserId : null
  const session = await ensureSession(env, body?.sessionId, userId)
  const models = normalizeOutfitModels(body)
  const garments = Array.isArray(body?.garments)
    ? body.garments
      .filter((item) => item?.assetId)
      .map((item: any) => ({
        assetId: String(item.assetId),
        role: item.role || 'full_outfit',
        label: String(item.label || item.assetId),
        instructions: cleanInstruction(item.instructions),
      }))
    : []
  if (models.length === 0) throw createRunnerError('modelAssetIds required', 400)
  if (garments.length === 0) throw createRunnerError('garments required', 400)

  const looks = buildOutfitLooks(garments.map((item) => ({
    id: item.assetId,
    role: item.role,
    assetId: item.assetId,
    label: item.label,
    instructions: item.instructions,
  })))
  if (looks.length === 0) throw createRunnerError('No outfit looks could be built', 400)

  const jobId = createId('job')
  const sealedCredentialId = await maybeSealClientKeys(env, jobId, body?.clientKeys || {})
  const garmentFingerprint = getOutfitGarmentFingerprint(garments)
  const job = await createJob(env, {
    id: jobId,
    sessionId: session.id,
    userId,
    type: 'outfit_batch',
    status: 'queued',
    configJson: {
      modelId: body?.modelId || 'nano-banana-2',
      instructions: cleanInstruction(body?.instructions),
      modelInstructions: models.map((item) => `${item.assetId}:${item.instructions}`).sort(),
      garmentRoles: garments.map((item) => `${item.assetId}:${item.role}`).sort(),
      garmentInstructions: garments.map((item) => `${item.assetId}:${item.instructions}`).sort(),
      garmentFingerprint,
      concurrency: clampInt(body?.concurrency, 1, 4, 3),
      sealedCredentialId,
      configHash: await stableHash({
        modelId: body?.modelId || 'nano-banana-2',
        instructions: cleanInstruction(body?.instructions),
        garments,
        models,
      }),
    },
    summaryJson: { lookCount: looks.length },
    progressTotal: models.length * looks.length,
    progressDone: 0,
    progressFailed: 0,
  })

  const items = await createJobItems(env, job.id, models.flatMap((model) =>
    looks.map((look) => ({
      jobId: job.id,
      itemType: 'outfit_cell',
      status: 'queued',
      inputJson: {
        modelAssetId: model.assetId,
        modelLabel: model.label,
        modelInstructions: model.instructions,
        lookAssetIds: look.items.map((item) => item.assetId || item.id),
        lookRoles: look.roles,
        lookLabels: look.items.map((item) => item.label || item.assetId || item.id),
        lookInstructions: look.items.map((item) => cleanInstruction(item.instructions)),
        lookId: look.id,
      },
      outputJson: {},
      attemptCount: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
    }))))

  await publishEvent(env, 'job', job.id, 'status', { status: 'queued', type: job.type })
  await publishJobProgress(env, job)

  await scheduleJobExecution(env, job, waitUntil, 'submit', body?.clientKeys || {})

  return { jobId: job.id, sessionId: session.id, lookCount: looks.length, itemCount: items.length }
}

async function runOutfitBatchJob(env: Env, jobId: string) {
  const initialJob = await getJob(env, jobId)
  if (!initialJob) return
  if (STOPPED_JOB_STATUSES.has(initialJob.status)) return
  const clientKeys = await loadJobClientKeys(env, initialJob)
  await updateJob(env, jobId, { status: 'running' })
  await publishEvent(env, 'job', jobId, 'status', { status: 'running' })

  const items = (await listJobItems(env, jobId)).filter((item) => item.status === 'queued')
  const concurrency = clampInt(initialJob.configJson?.concurrency, 1, 4, 2)
  const progress = queueProgressPublisher(env, jobId)
  const getCachedAssetDataUrl = createAssetDataUrlCache(env)
  const getCachedOutfitAnalysis = createOutfitAnalysisCache(env, initialJob, clientKeys)

  await runPool(items, concurrency, async (item) => {
    const job = await getJob(env, jobId)
    if (!job || STOPPED_JOB_STATUSES.has(job.status)) return

    await updateJobItem(env, jobId, item.id, {
      status: 'running',
      attemptCount: item.attemptCount + 1,
      startedAt: nowIso(),
      errorCode: null,
      errorMessage: null,
    })
    await publishEvent(env, 'item', item.id, 'item_started', { jobId, itemType: item.itemType })

    try {
      const modelDataUrl = await getCachedAssetDataUrl(String(item.inputJson.modelAssetId || ''))
      if (!modelDataUrl) throw createRunnerError(`Model asset not found: ${item.inputJson.modelAssetId}`, 404)
      const garmentUrls = await Promise.all(
        (Array.isArray(item.inputJson.lookAssetIds) ? item.inputJson.lookAssetIds : [])
          .map((assetId) => getCachedAssetDataUrl(String(assetId))),
      )
      if (garmentUrls.some((value) => !value)) {
        throw createRunnerError('One or more garment assets are missing', 404)
      }

      const modelImage = splitDataUrl(modelDataUrl)
      const garments = garmentUrls.map((dataUrl, index) => {
        const image = splitDataUrl(String(dataUrl))
        return {
          base64: image.base64,
          mime: image.mime,
          role: Array.isArray(item.inputJson.lookRoles) ? item.inputJson.lookRoles[index] : 'full_outfit',
          label: Array.isArray(item.inputJson.lookLabels)
            ? String(item.inputJson.lookLabels[index] || '')
            : (Array.isArray(item.inputJson.lookAssetIds) ? String(item.inputJson.lookAssetIds[index]) : ''),
          instructions: Array.isArray(item.inputJson.lookInstructions)
            ? cleanInstruction(item.inputJson.lookInstructions[index])
            : '',
        }
      })
      const analysis = await getCachedOutfitAnalysis(getOutfitAnalysisCacheKey(item), modelImage, garments)

      const { result, attempts } = await runWithAutoRetry(() => executeOutfitSwap({
        modelId: job.configJson.modelId,
        model: {
          ...modelImage,
          label: String(item.inputJson.modelLabel || item.inputJson.modelAssetId || ''),
          instructions: cleanInstruction(item.inputJson.modelInstructions),
        },
        garments,
        instructions: job.configJson.instructions,
        analysis,
        clientKeys,
      }, env))

      const resultAsset = await createAsset(env, {
        sessionId: job.sessionId,
        userId: job.userId || null,
        kind: 'result',
        source: 'outfit_batch',
        dataUrl: result.resultDataUrl,
        filename: `${String(item.inputJson.modelAssetId)}__${String(item.inputJson.lookId)}.png`,
      })

      await updateJobItem(env, jobId, item.id, {
        status: 'completed',
        attemptCount: attempts,
        outputJson: {
          resultAssetId: resultAsset.id,
          lookId: item.inputJson.lookId,
        },
        finishedAt: nowIso(),
      })
      await publishEvent(env, 'item', item.id, 'item_completed', {
        jobId,
        resultAssetId: resultAsset.id,
        lookId: item.inputJson.lookId,
      })
      await createUsageEvent(env, {
        userId: job.userId || null,
        sessionId: job.sessionId,
        jobId,
        eventType: 'outfit_result',
        amount: 1,
        provider: '1xm.ai',
        modelId: String(job.configJson.modelId || ''),
      })
    } catch (error: any) {
      await updateJobItem(env, jobId, item.id, {
        status: 'failed',
        attemptCount: Number(error?.attempts || item.attemptCount || 1),
        errorCode: 'outfit_failed',
        errorMessage: String(error?.message || 'Outfit failed'),
        finishedAt: nowIso(),
      })
      await publishEvent(env, 'item', item.id, 'item_failed', {
        jobId,
        error: String(error?.message || 'Outfit failed'),
      })
    }

    progress.publish()
  })

  await progress.drain()

  const latestJob = await getJob(env, jobId)
  if (latestJob?.status === 'paused') {
    return
  }
  if (latestJob?.status === 'cancelled') {
    await markRemainingItemsCancelled(env, jobId)
    await finalizeCredential(env, String(initialJob.configJson?.sealedCredentialId || ''))
    return
  }

  const finalItems = await listJobItems(env, jobId)
  const failed = finalItems.filter((item) => item.status === 'failed').length
  const completed = finalItems.filter((item) => item.status === 'completed').length
  const status = completed === 0 ? 'failed' : failed > 0 ? 'partial_failed' : 'completed'
  const finalJob = await updateJob(env, jobId, {
    status,
    summaryJson: {
      ...createJobSummary(finalItems),
      lookCount: initialJob.summaryJson.lookCount || 0,
    },
  })
  if (finalJob) {
    await publishEvent(env, 'job', jobId, 'job_completed', {
      status: finalJob.status,
      summary: finalJob.summaryJson,
    })
  }

  await finalizeCredential(env, String(initialJob.configJson?.sealedCredentialId || ''))
}

export async function submitGenerateTurn(
  env: Env,
  body: any,
  waitUntil?: WaitUntil,
) {
  const userId = typeof body?._authUserId === 'string' ? body._authUserId : null
  const session = await ensureSession(env, body?.sessionId, userId)
  const conversation = body?.conversationId
    ? await getConversation(env, String(body.conversationId))
    : await createConversation(env, session.id, userId)
  if (!conversation) throw createRunnerError('Conversation not found', 404)

  const jobId = createId('job')
  const sealedCredentialId = await maybeSealClientKeys(env, jobId, body?.clientKeys || {})
  const requestJson = {
    modelId: body?.modelId || 'nano-banana-2',
    userMessage: body?.userMessage || '',
    useDesignAgent: body?.useDesignAgent !== false,
    referenceAssets: Array.isArray(body?.referenceAssets) ? body.referenceAssets : [],
    history: Array.isArray(body?.history) ? body.history : [],
    previousTurnId: body?.previousTurnId || null,
  }

  const turn = await createConversationTurn(env, {
    conversationId: conversation.id,
    userMessage: String(body?.userMessage || ''),
    modelId: String(body?.modelId || 'nano-banana-2'),
    useDesignAgent: body?.useDesignAgent !== false,
    previousTurnId: body?.previousTurnId || null,
    requestJson,
    traceJson: null,
    status: 'queued',
    resultAssetId: null,
  })

  const job = await createJob(env, {
    id: jobId,
    sessionId: session.id,
    userId,
    type: 'generate_turn',
    status: 'queued',
    configJson: {
      turnId: turn.id,
      conversationId: conversation.id,
      sealedCredentialId,
      configHash: await stableHash(requestJson),
    },
    summaryJson: {},
    progressTotal: 1,
    progressDone: 0,
    progressFailed: 0,
  })

  await createJobItems(env, job.id, [{
    jobId: job.id,
    itemType: 'generate_turn_step',
    status: 'queued',
    inputJson: { turnId: turn.id },
    outputJson: {},
    attemptCount: 0,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
  }])

  await publishEvent(env, 'job', job.id, 'status', { status: 'queued', type: job.type, turnId: turn.id })
  await publishEvent(env, 'turn', turn.id, 'status', { status: 'queued' })

  await scheduleJobExecution(env, job, waitUntil, 'submit', body?.clientKeys || {})

  return { jobId: job.id, sessionId: session.id, conversationId: conversation.id, turnId: turn.id }
}

async function buildConversationHistory(env: Env, conversationId: string): Promise<Array<{ role: string; content: string }>> {
  const turns = await listConversationTurns(env, conversationId)
  const history: Array<{ role: string; content: string }> = []
  for (const turn of turns) {
    history.push({ role: 'user', content: turn.userMessage })
    const summary = typeof turn.traceJson?.summary === 'string'
      ? String(turn.traceJson.summary)
      : typeof turn.requestJson?.agentNotes === 'string'
        ? String(turn.requestJson.agentNotes)
        : ''
    if (summary && turn.status === 'completed') {
      history.push({ role: 'assistant', content: summary })
    }
  }
  return history.slice(-8)
}

async function runGenerateTurnJob(env: Env, jobId: string) {
  const job = await getJob(env, jobId)
  if (!job) return
  if (STOPPED_JOB_STATUSES.has(job.status)) return
  const turnId = String(job.configJson.turnId || '')
  const turn = await getConversationTurn(env, turnId)
  if (!turn) return

  const clientKeys = await loadJobClientKeys(env, job)
  await updateJob(env, jobId, { status: 'running' })
  await updateConversationTurn(env, turn.id, { status: 'running' })
  await publishEvent(env, 'job', job.id, 'status', { status: 'running', turnId: turn.id })
  await publishEvent(env, 'turn', turn.id, 'status', { status: 'running' })

  const requestHistory = Array.isArray(turn.requestJson.history) && turn.requestJson.history.length > 0
    ? turn.requestJson.history as Array<{ role: string; content: string }>
    : await buildConversationHistory(env, turn.conversationId)

  const referenceAssets = Array.isArray(turn.requestJson.referenceAssets) ? turn.requestJson.referenceAssets : []
  const referenceImages = (await Promise.all(referenceAssets.map(async (entry: any) => {
    const assetId = String(entry?.assetId || '')
    if (!assetId) return null
    const dataUrl = await getAssetDataUrl(env, assetId)
    if (!dataUrl) return null
    const image = splitDataUrl(dataUrl)
    return {
      id: assetId,
      base64: image.base64,
      mime: image.mime,
      role: entry?.role || 'other',
      label: entry?.label || assetId,
    }
  }))).filter(Boolean)

  let previousResult: { base64: string; mime: string } | null = null
  if (turn.previousTurnId) {
    const previousTurn = await getConversationTurn(env, String(turn.previousTurnId))
    if (previousTurn?.resultAssetId) {
      const previousDataUrl = await getAssetDataUrl(env, previousTurn.resultAssetId)
      if (previousDataUrl) previousResult = splitDataUrl(previousDataUrl)
    }
  }

  try {
    const context = buildGenerateExecutionContext({
      modelId: turn.modelId,
      userMessage: turn.userMessage,
      history: requestHistory.filter((entry) => entry.content !== turn.userMessage),
      referenceImages,
      useDesignAgent: turn.useDesignAgent,
      previousResult,
      clientKeys,
    }, env)

    const { result, attempts } = await runWithAutoRetry(() => executeGenerate(context, async (event) => {
      if (event.type === 'trace') {
        await updateConversationTurn(env, turn.id, { traceJson: event.trace })
      }
      await publishEvent(env, 'turn', turn.id, event.type, { ...event })
    }))

    const resultAsset = await createAsset(env, {
      sessionId: job.sessionId,
      userId: job.userId || null,
      kind: 'result',
      source: 'generate_turn',
      dataUrl: result.resultDataUrl,
      filename: `${turn.id}.png`,
    })

    await updateConversationTurn(env, turn.id, {
      status: 'completed',
      resultAssetId: resultAsset.id,
      traceJson: result.agentTrace,
      requestJson: {
        ...turn.requestJson,
        refinedPrompt: result.refinedPrompt,
        agentNotes: result.agentNotes,
      },
    })
    await updateJob(env, jobId, {
      status: 'completed',
      progressDone: 1,
      summaryJson: { resultAssetId: resultAsset.id },
    })
    const items = await listJobItems(env, jobId)
    if (items[0]) {
      await updateJobItem(env, jobId, items[0].id, {
        status: 'completed',
        attemptCount: attempts,
        finishedAt: nowIso(),
        outputJson: { resultAssetId: resultAsset.id },
      })
    }
    await publishEvent(env, 'job', job.id, 'job_completed', { status: 'completed', resultAssetId: resultAsset.id })
    await createUsageEvent(env, {
      userId: job.userId || null,
      sessionId: job.sessionId,
      jobId,
      eventType: 'generate_result',
      amount: 1,
      provider: '1xm.ai',
      modelId: turn.modelId,
    })
  } catch (error: any) {
    await updateConversationTurn(env, turn.id, { status: 'failed' })
    await updateJob(env, jobId, {
      status: 'failed',
      progressFailed: 1,
      summaryJson: { error: String(error?.message || 'Generate failed') },
    })
    const items = await listJobItems(env, jobId)
    if (items[0]) {
      await updateJobItem(env, jobId, items[0].id, {
        status: 'failed',
        attemptCount: Number(error?.attempts || items[0].attemptCount || 1),
        finishedAt: nowIso(),
        errorCode: 'generate_failed',
        errorMessage: String(error?.message || 'Generate failed'),
      })
    }
    await publishEvent(env, 'turn', turn.id, 'error', {
      error: String(error?.message || 'Generate failed'),
      status: Number(error?.status || 0) || undefined,
    })
    await publishEvent(env, 'job', job.id, 'job_completed', {
      status: 'failed',
      error: String(error?.message || 'Generate failed'),
    })
  } finally {
    await finalizeCredential(env, String(job.configJson?.sealedCredentialId || ''))
  }
}

export async function submitGenerateDirectJob(
  env: Env,
  body: any,
  waitUntil?: WaitUntil,
) {
  const userId = typeof body?._authUserId === 'string' ? body._authUserId : null
  const session = await ensureSession(env, body?.sessionId, userId)
  const request = normalizeDirectGenerateRequest(body)
  if (!request.prompt) throw createRunnerError('prompt required', 400)

  const jobId = createId('job')
  const sealedCredentialId = await maybeSealClientKeys(env, jobId, body?.clientKeys || {})
  const job = await createJob(env, {
    id: jobId,
    sessionId: session.id,
    userId,
    type: 'generate_batch',
    status: 'queued',
    configJson: {
      ...request,
      referenceAssetIds: request.referenceEntries.map((entry) => entry.assetId),
      sealedCredentialId,
      configHash: await stableHash({
        ...request,
        referenceAssetIds: request.referenceEntries.map((entry) => entry.assetId),
      }),
    },
    summaryJson: {},
    progressTotal: 1,
    progressDone: 0,
    progressFailed: 0,
  })

  await createJobItems(env, job.id, [{
    jobId: job.id,
    itemType: 'generate_batch_item',
    status: 'queued',
    inputJson: {
      prompt: request.prompt,
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      modelId: request.modelId,
    },
    outputJson: {},
    attemptCount: 0,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
  }])

  await publishEvent(env, 'job', job.id, 'status', { status: 'queued', type: job.type })
  await publishJobProgress(env, job)

  await scheduleJobExecution(env, job, waitUntil, 'submit', body?.clientKeys || {})

  return { jobId: job.id, sessionId: session.id, itemCount: 1 }
}

async function runGenerateBatchJob(env: Env, jobId: string) {
  const initialJob = await getJob(env, jobId)
  if (!initialJob) return
  if (STOPPED_JOB_STATUSES.has(initialJob.status)) return
  const clientKeys = await loadJobClientKeys(env, initialJob)
  await updateJob(env, jobId, { status: 'running' })
  await publishEvent(env, 'job', jobId, 'status', { status: 'running', type: initialJob.type })

  const items = (await listJobItems(env, jobId)).filter((item) => item.status === 'queued')
  const item = items[0]
  if (!item) return

  await updateJobItem(env, jobId, item.id, {
    status: 'running',
    attemptCount: item.attemptCount + 1,
    startedAt: nowIso(),
    errorCode: null,
    errorMessage: null,
  })
  await publishEvent(env, 'item', item.id, 'item_started', { jobId, itemType: item.itemType })

  try {
    const request = normalizeDirectGenerateRequest({
      ...initialJob.configJson,
      referenceImages: initialJob.configJson.referenceEntries,
    })
    const { result, attempts } = await runWithAutoRetry(() => executeDirectGenerate(env, request, clientKeys))
    const resultAsset = await createAsset(env, {
      sessionId: initialJob.sessionId,
      userId: initialJob.userId || null,
      kind: 'result',
      source: 'generate_direct',
      dataUrl: result.dataUrl,
      filename: `${initialJob.id}.png`,
      width: result.width,
      height: result.height,
      bucketKind: 'result',
    })

    await updateJobItem(env, jobId, item.id, {
      status: 'completed',
      attemptCount: attempts,
      outputJson: {
        resultAssetId: resultAsset.id,
        finalPrompt: result.finalPrompt,
      },
      finishedAt: nowIso(),
    })
    await updateJob(env, jobId, {
      status: 'completed',
      progressDone: 1,
      summaryJson: { resultAssetId: resultAsset.id },
    })
    await publishEvent(env, 'item', item.id, 'item_completed', {
      jobId,
      resultAssetId: resultAsset.id,
    })
    await publishEvent(env, 'job', jobId, 'job_completed', {
      status: 'completed',
      resultAssetId: resultAsset.id,
    })
    await createUsageEvent(env, {
      userId: initialJob.userId || null,
      sessionId: initialJob.sessionId,
      jobId,
      eventType: 'generate_direct_result',
      amount: 1,
      provider: '1xm.ai',
      modelId: String(initialJob.configJson.modelId || ''),
    })
  } catch (error: any) {
    await updateJobItem(env, jobId, item.id, {
      status: 'failed',
      attemptCount: Number(error?.attempts || item.attemptCount || 1),
      errorCode: 'generate_direct_failed',
      errorMessage: String(error?.message || 'Generate failed'),
      finishedAt: nowIso(),
    })
    await updateJob(env, jobId, {
      status: 'failed',
      progressFailed: 1,
      summaryJson: { error: String(error?.message || 'Generate failed') },
    })
    await publishEvent(env, 'item', item.id, 'item_failed', {
      jobId,
      error: String(error?.message || 'Generate failed'),
    })
    await publishEvent(env, 'job', jobId, 'job_completed', {
      status: 'failed',
      error: String(error?.message || 'Generate failed'),
    })
  } finally {
    await finalizeCredential(env, String(initialJob.configJson?.sealedCredentialId || ''))
  }
}

async function failQueuedJobSetup(env: Env, job: JobRecord, error: any) {
  const latestJob = await getJob(env, job.id)
  if (latestJob?.status === 'paused') {
    await publishEvent(env, 'job', job.id, 'status', { status: 'paused' })
    return
  }

  const message = String(error?.message || 'Job failed before processing started')
  const items = await listJobItems(env, job.id)
  const activeItems = items.filter((item) => !['completed', 'failed', 'cancelled'].includes(item.status))

  await Promise.all(activeItems.map(async (item) => {
    await updateJobItem(env, job.id, item.id, {
      status: 'failed',
      attemptCount: Math.max(1, Number(item.attemptCount || 0)),
      errorCode: 'job_setup_failed',
      errorMessage: message,
      finishedAt: nowIso(),
    })
    await publishEvent(env, 'item', item.id, 'item_failed', {
      jobId: job.id,
      error: message,
    })
  }))

  const finalItems = await listJobItems(env, job.id)
  const progressDone = finalItems.filter((item) => item.status === 'completed').length
  const progressFailed = finalItems.filter((item) => item.status === 'failed').length
  const finalJob = await updateJob(env, job.id, {
    status: 'failed',
    progressDone,
    progressFailed,
    summaryJson: { ...job.summaryJson, error: message },
  })

  if (job.type === 'generate_turn' && job.configJson?.turnId) {
    await updateConversationTurn(env, String(job.configJson.turnId), { status: 'failed' })
    await publishEvent(env, 'turn', String(job.configJson.turnId), 'error', { error: message })
  }

  if (finalJob) {
    await publishEvent(env, 'job', job.id, 'job_completed', {
      status: finalJob.status,
      error: message,
    })
  }

  await finalizeCredential(env, String(job.configJson?.sealedCredentialId || ''))
}

export async function runQueuedJob(env: Env, jobId: string, inlineClientKeys?: ClientKeys) {
  const job = await getJob(env, jobId)
  if (!job) return { jobId, status: 'missing' }
  if (TERMINAL_JOB_STATUSES.has(job.status) || job.status === 'paused') {
    return { jobId: job.id, status: job.status, skipped: true }
  }

  if (inlineClientKeys && Object.keys(inlineClientKeys).length > 0) {
    const record = await maybeSealClientKeys(env, job.id, inlineClientKeys)
    if (record) {
      await updateJob(env, job.id, {
        configJson: {
          ...job.configJson,
          sealedCredentialId: record,
        },
      })
    }
  }

  try {
    if (job.type === 'translate_batch') {
      await runTranslateBatchJob(env, job.id)
    } else if (job.type === 'outfit_batch') {
      await runOutfitBatchJob(env, job.id)
    } else if (job.type === 'generate_turn') {
      await runGenerateTurnJob(env, job.id)
    } else if (job.type === 'generate_batch') {
      await runGenerateBatchJob(env, job.id)
    } else {
      await updateJob(env, job.id, {
        status: 'failed',
        summaryJson: { error: `No runner registered for ${job.type}` },
      })
    }
  } catch (error) {
    await failQueuedJobSetup(env, job, error)
  }

  return { jobId: job.id, status: (await getJob(env, job.id))?.status || job.status }
}

export async function recoverJobs(env: Env, waitUntil?: WaitUntil) {
  const jobs = await listJobsByStatus(env, ['queued', 'running'])
  const scheduled: Array<Record<string, unknown>> = []
  const staleAfterMs = clampMs((env as Env & { VS_JOB_ITEM_TIMEOUT_MS?: string }).VS_JOB_ITEM_TIMEOUT_MS, DEFAULT_STALE_JOB_ITEM_MS)

  for (const job of jobs) {
    const recovered = job.status === 'running'
      ? await recoverRunningJob(env, job, staleAfterMs)
      : { shouldSchedule: true, previousStatus: job.status }

    if (!recovered.shouldSchedule) {
      continue
    }

    const dispatchMode = await scheduleJobExecution(env, { ...job, status: 'queued' }, waitUntil, 'recover')
    scheduled.push({
      jobId: job.id,
      type: job.type,
      previousStatus: recovered.previousStatus,
      dispatchMode,
    })
  }

  return { recovered: scheduled.length, jobs: scheduled }
}

async function recoverRunningJob(env: Env, job: JobRecord, staleAfterMs: number): Promise<{ shouldSchedule: boolean; previousStatus: string }> {
  const items = await listJobItems(env, job.id)
  const runningItems = items.filter((item) => item.status === 'running')
  const staleItems = runningItems.filter((item) => isStaleItem(item, job, staleAfterMs))

  if (runningItems.length && staleItems.length === 0) {
    return { shouldSchedule: false, previousStatus: job.status }
  }

  for (const item of staleItems) {
    if (item.attemptCount >= MAX_JOB_ITEM_ATTEMPTS) {
      await updateJobItem(env, job.id, item.id, {
        status: 'failed',
        errorCode: 'job_item_timeout',
        errorMessage: `Job item timed out after ${MAX_JOB_ITEM_ATTEMPTS} attempts.`,
        finishedAt: nowIso(),
      })
    } else {
      await requeueItems(env, job.id, [item])
    }
  }

  const latestItems = await listJobItems(env, job.id)
  const nonTerminal = latestItems.filter((item) => !['completed', 'failed'].includes(item.status))

  if (nonTerminal.length === 0) {
    await finalizeRecoveredJob(env, job, latestItems)
    return { shouldSchedule: false, previousStatus: job.status }
  }

  await updateJob(env, job.id, { status: 'queued' })
  await updateJobCounts(env, job.id)
  if (job.type === 'generate_turn' && typeof job.configJson?.turnId === 'string') {
    await updateConversationTurn(env, String(job.configJson.turnId), { status: 'queued' })
  }
  return { shouldSchedule: true, previousStatus: job.status }
}

async function finalizeRecoveredJob(env: Env, job: JobRecord, items: JobItemRecord[]): Promise<void> {
  const failed = items.filter((item) => item.status === 'failed').length
  const completed = items.filter((item) => item.status === 'completed').length
  const status = completed === 0 ? 'failed' : failed > 0 ? 'partial_failed' : 'completed'
  await updateJob(env, job.id, {
    status,
    progressDone: completed,
    progressFailed: failed,
    summaryJson: {
      ...job.summaryJson,
      ...createJobSummary(items),
      recoveredAt: nowIso(),
    },
  })
  if (job.type === 'generate_turn' && typeof job.configJson?.turnId === 'string') {
    await updateConversationTurn(env, String(job.configJson.turnId), { status })
  }
  await publishEvent(env, 'job', job.id, 'job_completed', {
    status,
    summary: createJobSummary(items),
  })
}

function isStaleItem(item: JobItemRecord, job: JobRecord, staleAfterMs: number): boolean {
  const startedAt = Date.parse(String(item.startedAt || ''))
  const fallbackAt = Date.parse(String(job.updatedAt || job.createdAt || ''))
  const reference = Number.isFinite(startedAt) ? startedAt : fallbackAt
  if (!Number.isFinite(reference)) return true
  return Date.now() - reference >= staleAfterMs
}

export async function retryJob(env: Env, jobId: string, waitUntil?: WaitUntil) {
  const job = await getJob(env, jobId)
  if (!job) throw createRunnerError('Job not found', 404)

  if (job.type === 'translate_batch') {
    const items = (await listJobItems(env, job.id)).filter((item) => item.status === 'failed')
    await requeueItems(env, job.id, items)
    await updateJob(env, job.id, { status: 'queued' })
    await updateJobCounts(env, job.id)
    await scheduleJobExecution(env, job, waitUntil, 'retry')
    return { jobId: job.id, type: job.type }
  }

  if (job.type === 'outfit_batch') {
    const items = (await listJobItems(env, job.id)).filter((item) => item.status === 'failed')
    await requeueItems(env, job.id, items)
    await updateJob(env, job.id, { status: 'queued' })
    await updateJobCounts(env, job.id)
    await scheduleJobExecution(env, job, waitUntil, 'retry')
    return { jobId: job.id, type: job.type }
  }

  if (job.type === 'generate_turn') {
    await updateJob(env, job.id, { status: 'queued', progressDone: 0, progressFailed: 0 })
    const items = await listJobItems(env, job.id)
    if (items[0]) {
      await updateJobItem(env, job.id, items[0].id, {
        status: 'queued',
        errorCode: null,
        errorMessage: null,
        finishedAt: null,
      })
    }
    await scheduleJobExecution(env, job, waitUntil, 'retry')
    return { jobId: job.id, type: job.type }
  }

  throw createRunnerError(`Retry not supported for ${job.type}`, 400)
}

export async function retryJobItem(env: Env, jobId: string, itemId: string, waitUntil?: WaitUntil) {
  const job = await getJob(env, jobId)
  if (!job) throw createRunnerError('Job not found', 404)
  const item = (await listJobItems(env, job.id)).find((entry) => entry.id === itemId)
  if (!item) throw createRunnerError('Job item not found', 404)
  if (!['translate_batch', 'outfit_batch'].includes(job.type)) {
    throw createRunnerError(`Item retry not supported for ${job.type}`, 400)
  }
  if (item.status !== 'failed') {
    throw createRunnerError('Only failed items can be retried', 400)
  }
  if (!['partial_failed', 'failed'].includes(job.status)) {
    throw createRunnerError('Wait for the batch to finish before retrying an item', 409)
  }

  await requeueItems(env, job.id, [item])
  await updateJob(env, job.id, { status: 'queued' })
  await updateJobCounts(env, job.id)

  await scheduleJobExecution(env, job, waitUntil, 'retry')

  return { jobId: job.id, itemId: item.id, type: job.type }
}

async function markRemainingItemsCancelled(env: Env, jobId: string) {
  const items = (await listJobItems(env, jobId)).filter((item) => !['completed', 'failed', 'cancelled'].includes(item.status))
  for (const item of items) {
    await updateJobItem(env, jobId, item.id, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
    })
  }
}

export async function cancelJob(env: Env, jobId: string) {
  const job = await getJob(env, jobId)
  if (!job) throw createRunnerError('Job not found', 404)
  await updateJob(env, job.id, { status: 'cancelled' })
  await markRemainingItemsCancelled(env, job.id)
  await publishEvent(env, 'job', job.id, 'status', { status: 'cancelled' })
  return { jobId: job.id, status: 'cancelled' }
}

export async function pauseJob(env: Env, jobId: string) {
  const job = await getJob(env, jobId)
  if (!job) throw createRunnerError('Job not found', 404)
  if (TERMINAL_JOB_STATUSES.has(job.status)) {
    throw createRunnerError('Finished jobs cannot be paused', 409)
  }
  if (job.status !== 'paused') {
    await updateJob(env, job.id, { status: 'paused' })
    if (job.type === 'generate_turn' && typeof job.configJson?.turnId === 'string') {
      await updateConversationTurn(env, String(job.configJson.turnId), { status: 'paused' })
    }
    await publishEvent(env, 'job', job.id, 'status', { status: 'paused' })
  }
  return { jobId: job.id, status: 'paused' }
}

export async function resumeJob(env: Env, jobId: string, waitUntil?: WaitUntil) {
  const job = await getJob(env, jobId)
  if (!job) throw createRunnerError('Job not found', 404)
  if (job.status !== 'paused') {
    throw createRunnerError('Only paused jobs can be resumed', 409)
  }

  const nextJob = await updateJob(env, job.id, { status: 'queued' })
  if (job.type === 'generate_turn' && typeof job.configJson?.turnId === 'string') {
    await updateConversationTurn(env, String(job.configJson.turnId), { status: 'queued' })
  }
  await updateJobCounts(env, job.id)
  await publishEvent(env, 'job', job.id, 'status', { status: 'queued' })
  await scheduleJobExecution(env, nextJob || { ...job, status: 'queued' }, waitUntil, 'retry')
  return { jobId: job.id, status: 'queued' }
}

export async function deleteJob(env: Env, jobId: string) {
  const job = await getJob(env, jobId)
  if (!job) throw createRunnerError('Job not found', 404)
  if (!TERMINAL_JOB_STATUSES.has(job.status) && job.status !== 'paused') {
    await updateJob(env, job.id, { status: 'cancelled' })
  }
  const deleted = await deleteJobRecord(env, job.id)
  return { jobId: job.id, deleted }
}

function createRunnerError(message: string, status = 502) {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  return error
}
