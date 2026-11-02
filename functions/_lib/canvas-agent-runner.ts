import type { Env } from '../_shared'
import type { JobRecord, JobItemRecord } from '../../packages/contracts/v2'
import { stableHash } from '../../packages/core/hash'
import { assessImageDelivery } from '../../packages/core/image-delivery'
import { executeCanvasAgentPlan } from '../api/canvas/agent'
import { assertCanEditProject, assertInputAssetAccess } from './permissions'
import { createJob, createJobItems, ensureSession, getJob, listJobItems, updateJob, updateJobItem,
  claimQueuedJobItem, getAsset, insertCanvasAgentElement, listCanvasProjectElements, patchCanvasAgentReview } from './v2-store'
import { maybeSealClientKeys, loadJobClientKeys, scheduleJobExecution, submitGenerateDirectJob } from './v2-runner'
import { reviewGeneratedImage } from './image-quality'
import { publishEvent } from './v2-events'

const terminal = new Set(['completed', 'failed', 'partial_failed', 'cancelled'])
const fault = (message: string, status = 400) => Object.assign(new Error(message), { status })
const clean = (v: unknown, n = 10000) => String(v || '').slice(0, n)
const now = () => new Date().toISOString()

function normalizeRequest(body: any) {
  const message = clean(body.message).trim()
  if (!message) throw fault('message required')
  if (!['1k', '2k', '4k'].includes(body.resolution || '1k')) throw fault('Unsupported resolution')
  if (!['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '1:4', '1:8'].includes(body.aspectRatio || '1:1')) throw fault('Unsupported aspect ratio')
  if (!/^[\w-]{1,80}$/.test(body.runId || '')) throw fault('Valid runId required')
  if (!/^[\w-]{1,160}$/.test(body.conversationId || '')) throw fault('Valid conversationId required')
  return { runId: body.runId, conversationId: body.conversationId, projectId: clean(body.projectId, 160), message,
    modelId: clean(body.modelId || 'nano-banana-2', 160), aspectRatio: clean(body.aspectRatio || '1:1', 10), resolution: clean(body.resolution || '1k', 5),
    skillId: clean(body.skillId || 'auto', 80), referenceStrategy: 'combined', executionPolicy: { mode: 'auto' },
    history: (Array.isArray(body.history) ? body.history : []).filter((m: any) => ['user', 'assistant'].includes(m?.role))
      .slice(-8).map((m: any) => ({ role: m.role, content: clean(m.content, 6000) })),
    canvasContext: { elementCount: Math.max(0, Number(body.canvasContext?.elementCount) || 0),
      elements: (Array.isArray(body.canvasContext?.elements) ? body.canvasContext.elements : []).slice(0, 30).map((e: any) => ({ type: clean(e.type, 40), name: clean(e.name, 200) })) },
    referenceImages: (Array.isArray(body.referenceImages) ? body.referenceImages : []).slice(0, 6).map((r: any) => ({
      assetId: clean(r.assetId, 160), role: ['subject', 'character', 'style', 'scene', 'composition', 'layout'].includes(r.role) ? r.role : 'subject', label: clean(r.label, 200) })).filter((r: any) => r.assetId) }
}

export function publicCanvasAgentJob(job: JobRecord) {
  const run: any = { ...(job.summaryJson.run as any) }
  if (['preparing', 'planning', 'executing'].includes(run.phase) && ['paused', 'failed', 'partial_failed', 'cancelled'].includes(job.status)) {
    run.phase = job.status === 'paused' ? 'awaiting_result' : job.status === 'cancelled' ? 'stopped' : job.status
    run.error = job.summaryJson.error || run.error || '服务端任务已暂停，请检查账号连接和原任务。'
  }
  return { jobId: job.id, sessionId: job.sessionId, status: job.status, createdAt: job.createdAt,
    userMessage: job.configJson.request && (job.configJson.request as any).message,
    referenceImages: (job.configJson.request as any)?.referenceImages || [],
    plan: job.summaryJson.plan || null, run }
}

async function ensureItem(env: Env, job: JobRecord) {
  let items = await listJobItems(env, job.id)
  if (!items.length) {
    try { await createJobItems(env, job.id, [{ id: `item_${job.id}`, jobId: job.id, itemType: 'canvas_agent_run', status: 'queued',
      inputJson: {}, outputJson: {}, attemptCount: 0 }]) } catch (error) {
      if (!(await listJobItems(env, job.id)).length) throw error
    }
    items = await listJobItems(env, job.id)
  }
  return items[0]
}

export async function submitCanvasAgentRun(env: Env, body: any, userId: string, waitUntil?: (p: Promise<unknown>) => void) {
  if (!env.VS_JOBS_QUEUE?.send && !env.VS_LOCAL_QUEUE_ENDPOINT) throw fault('创作助手需要持久化任务队列，请先配置 Queue 或本地队列服务。', 503)
  const request = normalizeRequest(body)
  await assertCanEditProject(env, request.projectId, userId)
  await assertInputAssetAccess(env, request, userId)
  const hash = await stableHash({ request, userId })
  const jobId = `job_agent_${request.runId}`
  let job = await getJob(env, jobId)
  if (job && (job.userId !== userId || job.type !== 'canvas_agent' || job.configJson.configHash !== hash)) throw fault('Run identity already used', 409)
  if (!job) {
    const session = await ensureSession(env, body.sessionId, userId)
    const credentialId = await maybeSealClientKeys(env, jobId, body.clientKeys || {}, 120)
    const run = { version: 1, id: request.runId, jobId, execution: 'server', projectId: request.projectId,
      conversationId: request.conversationId, mode: 'auto', phase: 'preparing', startedAt: Date.now(), endedAt: null,
      stopRequested: false, context: { ...request.canvasContext, referenceCount: request.referenceImages.length,
        references: request.referenceImages, referenceLabels: request.referenceImages.map((r: any) => r.label),
        imageModel: request.modelId, aspectRatio: request.aspectRatio, resolution: request.resolution }, tasks: [], events: [], error: '' }
    try { job = await createJob(env, { id: jobId, sessionId: session.id, userId, type: 'canvas_agent', status: 'queued',
      configJson: { request, inputProjectId: request.projectId, sealedCredentialId: credentialId, configHash: hash },
      summaryJson: { run }, progressTotal: 0, progressDone: 0, progressFailed: 0 }) } catch (error) {
      job = await getJob(env, jobId)
      if (!job || job.userId !== userId || job.configJson.configHash !== hash) throw error
    }
  }
  await ensureItem(env, job)
  if (!terminal.has(job.status)) await scheduleJobExecution(env, job, waitUntil, 'submit')
  return publicCanvasAgentJob(job)
}

function event(run: any, type: string, label: string, taskId = '') {
  run.events = [...(run.events || []), { type, label, taskId, at: Date.now() }].slice(-60)
}

export async function runCanvasAgentJob(env: Env, id: string) {
  const job = await getJob(env, id)
  if (!job || terminal.has(job.status) || job.status === 'paused') return
  await assertCanEditProject(env, String(job.configJson.inputProjectId), job.userId)
  // Waiting for a durable child is read-only. Do not decrypt/refresh tokens,
  // claim an item or rewrite the entire run every time the monitor wakes up.
  const waitingTask = (job.summaryJson.run as any)?.tasks?.find((t: any) => !['completed', 'skipped'].includes(t.status))
  if (job.status === 'queued' && waitingTask?.jobId) {
    const child = await getJob(env, waitingTask.jobId)
    if (child && ['queued', 'running'].includes(child.status)) {
      await scheduleJobExecution(env, job, undefined, 'recover', {}, 3000)
      return
    }
  }
  const item = await ensureItem(env, job)
  const keys = await loadJobClientKeys(env, job)
  const claimed = await claimQueuedJobItem(env, id, item.id, { startedAt: now(), attemptCount: item.attemptCount + 1 })
  if (!claimed) return
  const run: any = structuredClone(job.summaryJson.run)
  let plan: any = job.summaryJson.plan || null
  let output: any = { ...claimed.outputJson }
  const request: any = job.configJson.request
  const save = async (status: any = 'running') => {
    const latest = await getJob(env, id)
    run.stopRequested = Boolean(latest?.configJson.stopRequested)
    run.timings = { ...(run.timings || {}), totalMs: Date.now() - run.startedAt }
    await updateJobItem(env, id, item.id, { outputJson: output })
    await updateJob(env, id, { status, summaryJson: { run, plan }, progressTotal: run.tasks.length,
      progressDone: run.tasks.filter((t: any) => t.status === 'completed').length,
      progressFailed: run.tasks.filter((t: any) => ['failed', 'unknown'].includes(t.status)).length })
    await publishEvent(env, 'job', id, 'progress', { phase: run.phase, completed: run.tasks.filter((t: any) => t.status === 'completed').length })
  }
  const finish = async (phase: string, error = '') => {
    run.phase = phase; run.error = error; run.endedAt = Date.now()
    if (phase !== 'awaiting_result') for (const task of run.tasks) if (task.status === 'queued') task.status = 'skipped'
    event(run, 'phase', ({ completed: '已完成', waiting_input: '等待你的选择', stopped: '已停止后续操作', awaiting_result: '结果待确认' } as any)[phase] || '本轮未完成')
    await save(phase === 'awaiting_result' ? 'paused' : ['completed', 'waiting_input', 'stopped'].includes(phase) ? 'completed' : run.tasks.some((t: any) => t.status === 'completed') ? 'partial_failed' : 'failed')
    await updateJobItem(env, id, item.id, { status: phase === 'awaiting_result' ? 'queued' : ['failed', 'partial_failed'].includes(phase) ? 'failed' : 'completed', finishedAt: now(), startedAt: null })
  }
  try {
    run.phase = plan ? 'executing' : 'planning'
    run.stopRequested = Boolean(job.configJson.stopRequested)
    if (run.stopRequested && !plan) { await finish('stopped'); return }
    if (!plan) {
      if (output.planningIntent) { await finish('awaiting_result', '规划请求结果待确认，未自动重发。'); return }
      output.planningIntent = { requestId: `${run.id}-plan`, at: now() }
      run.requestId = `${run.id}-plan`
      event(run, 'phase', '理解与规划')
      await save()
      const response = await executeCanvasAgentPlan(env, { ...request, sessionId: job.sessionId }, job.userId!, keys)
      const result: any = await response.json()
      if (!response.ok) throw Object.assign(new Error(result.error || '规划未完成'), { status: response.status })
      plan = result; run.timings = { ...result.timings, queueMs: Date.parse(output.planningIntent.at) - run.startedAt }; run.skill = result.skill
      run.referenceRequestId = result.referenceRequestId || ''
      const actions = result.shouldGenerate ? (result.actions || []).filter((a: any) => a.type === 'generate_image' && a.prompt) : []
      if (actions.length > 8) throw fault('单次最多生成 8 张图片')
      run.tasks = actions.map((a: any, i: number) => ({ id: `${run.id}-image-${i + 1}`, title: clean(a.title, 200) || `作品 ${i + 1}`,
        prompt: clean(a.prompt, 16000), aspectRatio: a.aspectRatio || request.aspectRatio, resolution: a.resolution || request.resolution,
        status: 'queued', jobId: `job_agent_image_${run.id}_${i + 1}`, elementId: `agent_image_${run.id}_${i + 1}`, assetId: '', error: '' }))
      run.phase = 'executing'
      await save()
      if (!run.tasks.length) { await finish(result.needsClarification ? 'waiting_input' : 'completed'); return }
    }
    const task = run.tasks.find((t: any) => t.status !== 'completed' && t.status !== 'skipped')
    if (!task) { await finish('completed'); return }
    let child = await getJob(env, task.jobId)
    // Read the stop flag at the boundary before accepting a paid child.
    run.stopRequested = Boolean((await getJob(env, id))?.configJson.stopRequested)
    if (run.stopRequested && !child) { await finish('stopped'); return }
    if (!child) {
      const submitted = await submitGenerateDirectJob(env, { ...request, sessionId: job.sessionId, _authUserId: job.userId,
        prompt: task.prompt, aspectRatio: task.aspectRatio, resolution: task.resolution, useDesignAgent: false, clientKeys: keys }, undefined, task.jobId, job.id)
      task.jobId = submitted.jobId; task.status = 'accepted'
      event(run, 'task_accepted', '图片任务已受理，关闭页面后仍会继续处理', task.id)
      child = await getJob(env, task.jobId)
    }
    if (child?.status === 'completed') {
      const assetId = String(child.summaryJson.resultAssetId || '')
      const asset = assetId ? await getAsset(env, assetId) : null
      if (!asset || asset.userId !== job.userId) throw new Error('生成结果资产尚不可读取')
      task.assetId = asset.id
      task.mime = asset.mime
      task.timings = child.summaryJson.timings || null
      task.delivery = assessImageDelivery({ ...asset, resolution: task.resolution, aspectRatio: task.aspectRatio })
      task.status = 'accepted'
      const i = run.tasks.indexOf(task)
      if (!run.placement) {
        const existing = await listCanvasProjectElements(env, request.projectId)
        run.placement = { x: existing.length ? Math.max(0, ...existing.map(r => (Number(r.dataJson.x) || 0) + (Number(r.dataJson.width) || 0))) + 64 : 0, y: 0 }
        await save()
      }
      const height = Math.round(500 * (asset.height || 1024) / (asset.width || 1024))
      let x = run.placement.x + i % 3 * 540, y = run.placement.y + Math.floor(i / 3) * 580
      const neighbors = (await listCanvasProjectElements(env, request.projectId)).filter(r => r.dataJson.id !== task.elementId)
      if (neighbors.some(({dataJson: e}) => x < Number(e.x || 0) + Number(e.width || 0) + 32 && x + 500 + 32 > Number(e.x || 0)
        && y < Number(e.y || 0) + Number(e.height || 0) + 32 && y + height + 32 > Number(e.y || 0))) {
        x = Math.max(0, ...neighbors.map(r => Number(r.dataJson.x || 0) + Number(r.dataJson.width || 0))) + 64; y = 0
      }
      await insertCanvasAgentElement(env, request.projectId, { id: task.elementId, type: 'image', name: task.title,
        x, y, width: 500, height,
        content: `/api/results/${encodeURIComponent(asset.id)}?projectId=${encodeURIComponent(request.projectId)}`,
        assetId: asset.id, mime: asset.mime, originalWidth: asset.width, originalHeight: asset.height,
        aspectRatio: task.aspectRatio, resolution: task.resolution, prompt: task.prompt, agentRunId: run.id, delivery: task.delivery })
      run.timings = { ...run.timings, firstImageMs: run.timings?.firstImageMs ?? Date.now() - run.startedAt }
      if (!task.quality) {
        if (output.reviewIntent?.taskId === task.id) task.quality = { status: 'unknown', issues: ['质检请求曾中断，未自动重发'], requestId: output.reviewIntent.requestId }
        else {
          output.reviewIntent = { taskId: task.id, requestId: `${run.id}-review-${i + 1}`, at: now() }
          event(run, 'progress', '作品已保存，正在独立检查画面质量', task.id)
          await save()
          const reviewStartedAt = Date.now()
          try { task.quality = await reviewGeneratedImage(env, { userId: job.userId!, projectId: request.projectId, assetId: asset.id,
            references: request.referenceImages, prompt: task.prompt, requestId: output.reviewIntent.requestId, clientKeys: keys }) }
          catch (error: any) { task.quality = { status: 'unknown', issues: [clean(error.message, 400)], requestId: output.reviewIntent.requestId } }
          task.timings = { ...task.timings, reviewMs: Date.now() - reviewStartedAt }
        }
      }
      await patchCanvasAgentReview(env, request.projectId, task.elementId, run.id, task.quality)
      task.status = 'completed'
      event(run, 'task_completed', task.delivery.status === 'passed' && task.quality.status === 'passed' ? '作品已保存，最低像素、比例与视觉检查通过' : '作品已保存，请查看规格和质检提示', task.id)
      if (run.stopRequested) { await finish('stopped'); return }
    } else if (child && ['failed', 'partial_failed', 'cancelled', 'paused'].includes(child.status)) {
      task.status = 'unknown'; task.error = clean(child.summaryJson.error || '图片任务未完成，请先读取原任务')
      await finish('awaiting_result', task.error); return
    }
    if (run.tasks.every((t: any) => t.status === 'completed')) { await finish('completed'); return }
    await save('queued')
    await updateJobItem(env, id, item.id, { status: 'queued', startedAt: null, outputJson: output })
    await scheduleJobExecution(env, { ...job, status: 'queued' }, undefined, 'recover', {}, 3000)
  } catch (error: any) {
    const knownFailure = [400, 401, 403, 404, 413, 422, 429].includes(Number(error.status))
    await finish(output.planningIntent && !plan && !knownFailure ? 'awaiting_result' : 'failed', clean(error.message, 600))
  }
}

export async function recoverCanvasAgentJob(env: Env, job: JobRecord, staleAfterMs: number) {
  const item = await ensureItem(env, job)
  if (item.status === 'running' && Date.now() - Date.parse(item.startedAt || job.updatedAt) < staleAfterMs) return { shouldSchedule: false, previousStatus: job.status }
  await updateJobItem(env, job.id, item.id, { status: 'queued', startedAt: null })
  await updateJob(env, job.id, { status: 'queued' })
  return { shouldSchedule: true, previousStatus: job.status }
}

export async function stopCanvasAgentJob(env: Env, job: JobRecord) {
  if (!terminal.has(job.status)) await updateJob(env, job.id, { configJson: { ...job.configJson, stopRequested: true } })
  return { stopped: true }
}
