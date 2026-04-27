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
  deleteSealedCredential,
  ensureSession,
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
import { executeTranslate } from '../api/translate'
import { executeOutfitSwap } from '../api/outfit-swap'
import { buildGenerateExecutionContext, executeGenerate } from '../api/generate'

type WaitUntil = (promise: Promise<unknown>) => void

type ClientKeys = Record<string, unknown>
const AUTO_RETRY_LIMIT = 2
const AUTO_RETRY_DELAY_MS = 1200

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

async function maybeSealClientKeys(env: Env, jobId: string, clientKeys: ClientKeys): Promise<string | null> {
  if (!clientKeys || Object.keys(clientKeys).length === 0) return null
  const ciphertext = await sealJson(clientKeys, env.CREDENTIAL_KEK)
  const record = await createSealedCredential(env, jobId, ciphertext, addMinutes(30))
  return record.id
}

async function loadClientKeys(env: Env, credentialId?: string | null): Promise<ClientKeys> {
  if (!credentialId) return {}
  const record = await getSealedCredential(env, credentialId)
  if (!record) return {}
  return unsealJson<ClientKeys>(record.ciphertext, env.CREDENTIAL_KEK)
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
  const items = (await listJobItems(env, jobId)).filter((item) => item.status === 'queued')
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
    finishedAt: null,
  })))
}

async function scheduleJobExecution(
  env: Env,
  job: JobRecord,
  waitUntil: WaitUntil | undefined,
  reason: 'submit' | 'retry' | 'recover',
) {
  return dispatchQueuedJob(
    env,
    waitUntil,
    createJobQueueMessage({ jobId: job.id, jobType: job.type, reason }),
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
  const configJson = {
    modelId: body?.modelId || 'nano-banana-2',
    sourceLanguage: body?.sourceLanguage || 'auto',
    targetLanguages,
    preserveBrand: body?.preserveBrand !== false,
    concurrency: Math.max(1, Number(body?.concurrency || 2)),
    assetIds,
    configHash: await stableHash({
      modelId: body?.modelId || 'nano-banana-2',
      sourceLanguage: body?.sourceLanguage || 'auto',
      targetLanguages,
      preserveBrand: body?.preserveBrand !== false,
      assetIds,
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

  await scheduleJobExecution(env, job, waitUntil, 'submit')

  return { jobId: job.id, sessionId: session.id, itemCount: items.length }
}

async function runTranslateBatchJob(env: Env, jobId: string) {
  const initialJob = await getJob(env, jobId)
  if (!initialJob) return
  const clientKeys = await loadClientKeys(env, String(initialJob.configJson?.sealedCredentialId || ''))
  await updateJob(env, jobId, { status: 'running' })
  await publishEvent(env, 'job', jobId, 'status', { status: 'running' })

  const items = (await listJobItems(env, jobId)).filter((item) => item.status === 'queued')
  for (const item of items) {
    const job = await getJob(env, jobId)
    if (!job || job.status === 'cancelled') break

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
      const dataUrl = await getAssetDataUrl(env, assetId)
      if (!dataUrl) throw createRunnerError(`Asset not found: ${assetId}`, 404)
      const { mime, base64 } = splitDataUrl(dataUrl)
      const { result, attempts } = await runWithAutoRetry(() => executeTranslate({
        imageBase64: base64,
        mime,
        sourceLanguage: job.configJson.sourceLanguage,
        targetLanguage: item.inputJson.targetLanguage,
        modelId: job.configJson.modelId,
        preserveBrand: job.configJson.preserveBrand,
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

    const nextJob = await updateJobCounts(env, jobId)
    if (nextJob) await publishJobProgress(env, nextJob)
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
  const modelAssetIds = Array.isArray(body?.modelAssetIds) ? body.modelAssetIds.filter(Boolean) : []
  const garments = Array.isArray(body?.garments) ? body.garments.filter((item) => item?.assetId) : []
  if (modelAssetIds.length === 0) throw createRunnerError('modelAssetIds required', 400)
  if (garments.length === 0) throw createRunnerError('garments required', 400)

  const looks = buildOutfitLooks(garments.map((item: any) => ({
    id: String(item.assetId),
    role: item.role || 'full_outfit',
    assetId: String(item.assetId),
    label: String(item.label || item.assetId),
  })))
  if (looks.length === 0) throw createRunnerError('No outfit looks could be built', 400)

  const jobId = createId('job')
  const sealedCredentialId = await maybeSealClientKeys(env, jobId, body?.clientKeys || {})
  const job = await createJob(env, {
    id: jobId,
    sessionId: session.id,
    userId,
    type: 'outfit_batch',
    status: 'queued',
    configJson: {
      modelId: body?.modelId || 'nano-banana-pro',
      instructions: body?.instructions || '',
      garmentRoles: garments.map((item: any) => `${item.assetId}:${item.role || 'full_outfit'}`).sort(),
      sealedCredentialId,
      configHash: await stableHash({
        modelId: body?.modelId || 'nano-banana-pro',
        instructions: body?.instructions || '',
        garments,
        modelAssetIds,
      }),
    },
    summaryJson: { lookCount: looks.length },
    progressTotal: modelAssetIds.length * looks.length,
    progressDone: 0,
    progressFailed: 0,
  })

  const items = await createJobItems(env, job.id, modelAssetIds.flatMap((modelAssetId: string) =>
    looks.map((look) => ({
      jobId: job.id,
      itemType: 'outfit_cell',
      status: 'queued',
      inputJson: {
        modelAssetId,
        lookAssetIds: look.items.map((item) => item.assetId || item.id),
        lookRoles: look.roles,
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

  await scheduleJobExecution(env, job, waitUntil, 'submit')

  return { jobId: job.id, sessionId: session.id, lookCount: looks.length, itemCount: items.length }
}

async function runOutfitBatchJob(env: Env, jobId: string) {
  const initialJob = await getJob(env, jobId)
  if (!initialJob) return
  const clientKeys = await loadClientKeys(env, String(initialJob.configJson?.sealedCredentialId || ''))
  await updateJob(env, jobId, { status: 'running' })
  await publishEvent(env, 'job', jobId, 'status', { status: 'running' })

  const items = await listJobItems(env, jobId)
  for (const item of items) {
    const job = await getJob(env, jobId)
    if (!job || job.status === 'cancelled') break

    await updateJobItem(env, jobId, item.id, {
      status: 'running',
      attemptCount: item.attemptCount + 1,
      startedAt: nowIso(),
      errorCode: null,
      errorMessage: null,
    })
    await publishEvent(env, 'item', item.id, 'item_started', { jobId, itemType: item.itemType })

    try {
      const modelDataUrl = await getAssetDataUrl(env, String(item.inputJson.modelAssetId || ''))
      if (!modelDataUrl) throw createRunnerError(`Model asset not found: ${item.inputJson.modelAssetId}`, 404)
      const garmentUrls = await Promise.all(
        (Array.isArray(item.inputJson.lookAssetIds) ? item.inputJson.lookAssetIds : [])
          .map((assetId) => getAssetDataUrl(env, String(assetId))),
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
          label: Array.isArray(item.inputJson.lookAssetIds) ? String(item.inputJson.lookAssetIds[index]) : '',
        }
      })

      const { result, attempts } = await runWithAutoRetry(() => executeOutfitSwap({
        modelId: job.configJson.modelId,
        model: modelImage,
        garments,
        instructions: job.configJson.instructions,
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

    const nextJob = await updateJobCounts(env, jobId)
    if (nextJob) await publishJobProgress(env, nextJob)
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

  await scheduleJobExecution(env, job, waitUntil, 'submit')

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
  const turnId = String(job.configJson.turnId || '')
  const turn = await getConversationTurn(env, turnId)
  if (!turn) return

  const clientKeys = await loadClientKeys(env, String(job.configJson?.sealedCredentialId || ''))
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

export async function runQueuedJob(env: Env, jobId: string) {
  const job = await getJob(env, jobId)
  if (!job) return { jobId, status: 'missing' }
  if (['completed', 'partial_failed', 'failed', 'cancelled'].includes(job.status)) {
    return { jobId: job.id, status: job.status, skipped: true }
  }

  if (job.type === 'translate_batch') {
    await runTranslateBatchJob(env, job.id)
  } else if (job.type === 'outfit_batch') {
    await runOutfitBatchJob(env, job.id)
  } else if (job.type === 'generate_turn') {
    await runGenerateTurnJob(env, job.id)
  } else {
    await updateJob(env, job.id, {
      status: 'failed',
      summaryJson: { error: `No runner registered for ${job.type}` },
    })
  }

  return { jobId: job.id, status: (await getJob(env, job.id))?.status || job.status }
}

export async function recoverJobs(env: Env, waitUntil?: WaitUntil) {
  const jobs = await listJobsByStatus(env, ['queued', 'running'])
  const scheduled: Array<Record<string, unknown>> = []

  for (const job of jobs) {
    if (job.status === 'running') {
      const items = await listJobItems(env, job.id)
      const runningItems = items.filter((item) => item.status === 'running')
      if (runningItems.length) await requeueItems(env, job.id, runningItems)
      await updateJob(env, job.id, { status: 'queued' })
      if (job.type === 'generate_turn' && typeof job.configJson?.turnId === 'string') {
        await updateConversationTurn(env, String(job.configJson.turnId), { status: 'queued' })
      }
    }

    const dispatchMode = await scheduleJobExecution(env, { ...job, status: 'queued' }, waitUntil, 'recover')
    scheduled.push({
      jobId: job.id,
      type: job.type,
      previousStatus: job.status,
      dispatchMode,
    })
  }

  return { recovered: scheduled.length, jobs: scheduled }
}

export async function retryJob(env: Env, jobId: string, waitUntil?: WaitUntil) {
  const job = await getJob(env, jobId)
  if (!job) throw createRunnerError('Job not found', 404)

  if (job.type === 'translate_batch') {
    const items = (await listJobItems(env, job.id)).filter((item) => item.status === 'failed')
    await requeueItems(env, job.id, items)
    await updateJob(env, job.id, { status: 'queued', progressFailed: 0 })
    await scheduleJobExecution(env, job, waitUntil, 'retry')
    return { jobId: job.id, type: job.type }
  }

  if (job.type === 'outfit_batch') {
    const items = (await listJobItems(env, job.id)).filter((item) => item.status === 'failed')
    await requeueItems(env, job.id, items)
    await updateJob(env, job.id, { status: 'queued', progressFailed: 0 })
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

  await requeueItems(env, job.id, [item])
  await updateJob(env, job.id, { status: 'queued' })

  await scheduleJobExecution(env, job, waitUntil, 'retry')

  return { jobId: job.id, itemId: item.id, type: job.type }
}

export async function cancelJob(env: Env, jobId: string) {
  const job = await getJob(env, jobId)
  if (!job) throw createRunnerError('Job not found', 404)
  await updateJob(env, job.id, { status: 'cancelled' })
  await publishEvent(env, 'job', job.id, 'status', { status: 'cancelled' })
  return { jobId: job.id, status: 'cancelled' }
}

function createRunnerError(message: string, status = 502) {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  return error
}
