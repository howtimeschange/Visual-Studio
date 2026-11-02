// Domain runtime only. The host supplies the LLM, image queue and persistence adapters.
// A conversation owns runs; a run owns bounded tasks and their accepted receipts.
export const AGENT_TASK_LIMIT = 8
export const AGENT_PHASE_LABELS = {
  preparing: '准备上下文', planning: '理解与规划', executing: '生成作品',
  completed: '已完成', waiting_input: '等待你的选择', stopped: '已停止后续操作',
  failed: '处理失败', partial_failed: '部分完成', awaiting_result: '结果待确认', interrupted: '运行已中断',
}
const ACTIVE = new Set(['preparing', 'planning', 'executing'])
const TASK_STATES = new Set(['queued', 'running', 'accepted', 'completed', 'failed', 'unknown', 'skipped'])
const clean = (value, max = 240) => typeof value === 'string' ? value.slice(0, max) : ''

export function normalizeAgentMode(value) { return value === 'plan' ? 'plan' : 'auto' }
export function isAgentRunActive(run) { return Boolean(run && ACTIVE.has(run.phase)) }

export function createDesignAgentRun({ id, projectId, conversationId, mode, context = {}, now = Date.now() }) {
  return {
    version: 1, id, projectId, conversationId, mode: normalizeAgentMode(mode),
    phase: 'preparing', startedAt: now, endedAt: null, stopRequested: false,
    context: normalizeContext(context), tasks: [], events: [], error: '', requestId: '', referenceRequestId: '',
  }
}

function normalizeContext(context = {}) {
  if (!context || typeof context !== 'object') context = {}
  const count = (value) => Math.max(0, Math.min(10000, Number(value) || 0))
  return {
    elementCount: count(context.elementCount), selectedCount: count(context.selectedCount),
    referenceCount: count(context.referenceCount),
    referenceLabels: Array.isArray(context.referenceLabels) ? context.referenceLabels.map((item) => clean(item, 80)).slice(0, 6) : [],
    references: Array.isArray(context.references) ? context.references.filter((ref) => ref && typeof ref === 'object').slice(0, 6).map((ref) => ({ assetId: clean(ref.assetId, 160), role: clean(ref.role, 20), label: clean(ref.label, 80) })) : [],
    imageModel: clean(context.imageModel, 160), aspectRatio: clean(context.aspectRatio, 12), resolution: clean(context.resolution, 8),
    size: clean(context.size, 24), quality: clean(context.quality, 12),
  }
}

export function serializeDesignAgentRun(value, { restore = false } = {}) {
  if (!value || typeof value !== 'object' || !['id', 'projectId', 'conversationId'].every((key) => typeof value[key] === 'string' && value[key])) return null
  const phase = Object.hasOwn(AGENT_PHASE_LABELS, value.phase) ? value.phase : 'interrupted'
  const preparingClient = ['preparing', 'uploading', 'submitting'].includes(value.clientStage)
  return {
    version: 1, id: clean(value.id, 80), projectId: clean(value.projectId, 160), conversationId: clean(value.conversationId, 160),
    execution: value.execution === 'server' ? 'server' : 'browser', jobId: clean(value.jobId, 160),
    mode: normalizeAgentMode(value.mode), phase: restore && ACTIVE.has(phase) && preparingClient ? value.clientStage === 'submitting' ? 'awaiting_result' : 'interrupted' : restore && value.execution !== 'server' && ACTIVE.has(phase) ? 'interrupted' : phase,
    ...(!restore && preparingClient ? { clientStage: value.clientStage, clientStageAt: Number(value.clientStageAt) || null } : {}),
    clientTimings: value.clientTimings ? { preparationMs: Math.max(0, Number(value.clientTimings.preparationMs) || 0) } : null,
    startedAt: Number(value.startedAt) || null, endedAt: Number(value.endedAt) || null,
    stopRequested: Boolean(value.stopRequested), context: normalizeContext(value.context),
    requestId: clean(value.requestId, 160), referenceRequestId: clean(value.referenceRequestId, 160), error: clean(value.error, 600),
    timings: value.timings ? Object.fromEntries(['planningMs', 'referenceMs', 'totalMs', 'modelCalls', 'firstImageMs', 'queueMs'].filter(key => value.timings[key] != null).map((key) => [key, Math.max(0, Number(value.timings[key]) || 0)])) : null,
    skill: value.skill ? { id: clean(value.skill.id, 80), label: clean(value.skill.label, 80), source: clean(value.skill.source, 160),
      qualityChecklist: Array.isArray(value.skill.qualityChecklist) ? value.skill.qualityChecklist.slice(0, 8).map((item) => clean(item, 240)) : [] } : null,
    tasks: (Array.isArray(value.tasks) ? value.tasks : []).filter((task) => task && typeof task === 'object').slice(0, AGENT_TASK_LIMIT).map((task) => ({
      id: clean(task.id, 80), mime: clean(task.mime, 80), title: clean(task.title, 100), prompt: clean(task.prompt, 12000),
      aspectRatio: clean(task.aspectRatio, 12), resolution: clean(task.resolution, 8), creativeMode: 'image',
      size: clean(task.size, 24), generationQuality: clean(task.generationQuality, 12),
      status: TASK_STATES.has(task.status) ? task.status : 'unknown',
      delivery: sanitizeReview(task.delivery), quality: sanitizeReview(task.quality),
      timings: task.timings ? Object.fromEntries(['resultTransferMs', 'reviewMs'].filter(key => task.timings[key] != null).map(key => [key, Math.max(0, Number(task.timings[key]) || 0)])) : null,
      jobId: clean(task.jobId, 160), elementId: clean(task.elementId, 160), assetId: clean(task.assetId, 160), error: clean(task.error, 600),
    })),
    events: (Array.isArray(value.events) ? value.events : []).filter((event) => event && typeof event === 'object').slice(-40).map((event) => ({
      type: clean(event.type, 40), at: Number(event.at) || null, label: clean(event.label, 240), taskId: clean(event.taskId, 80),
    })),
  }
}

function sanitizeReview(value) {
  if (!value || typeof value !== 'object') return null
  return { status: clean(value.status, 40), width: Math.max(0, Number(value.width) || 0), height: Math.max(0, Number(value.height) || 0),
    issues: Array.isArray(value.issues) ? value.issues.slice(0, 8).map(v => clean(v, 400)) : [],
    summary: clean(value.summary, 1000), model: clean(value.model, 160), requestId: clean(value.requestId, 160), reviewedAt: clean(value.reviewedAt, 80),
    provider: value.provider ? Object.fromEntries(['requestedModel','reportedModel','requestedQuality','reportedQuality'].map(key => [key, clean(value.provider[key], 160)])) : null,
    targetLongEdge: Math.max(0, Number(value.targetLongEdge) || 0), requestedSize: clean(value.requestedSize, 24), requestedResolution: clean(value.requestedResolution, 8), requestedAspectRatio: clean(value.requestedAspectRatio, 12) }
}

export function requestDesignAgentStop(run) {
  if (!isAgentRunActive(run) || run.stopRequested) return false
  run.stopRequested = true
  return true
}

export function canShowAgentSuggestions(message) {
  return !message.loading && !message.streaming && (!message.run || ['completed', 'waiting_input'].includes(message.run.phase))
}

function isKnownFailure(error) {
  return error?.operationState === 'failed' || [400, 401, 403, 404, 413, 422, 429].includes(Number(error?.status))
}

export async function executeDesignAgentRun(run, adapters) {
  const now = adapters.now || Date.now
  const emit = (type, label, taskId = '') => {
    // Status polling must not evict the acceptance and lifecycle evidence.
    if (type === 'progress') run.events = run.events.filter((event) => event.type !== 'progress')
    run.events.push({ type, label, taskId, at: now() })
    run.events = run.events.slice(-40)
    adapters.onChange?.(run, type)
  }
  const phase = (next, label) => { run.phase = next; emit('phase', label || AGENT_PHASE_LABELS[next]) }
  const assertScope = () => {
    if (adapters.isCurrent && !adapters.isCurrent(run)) throw Object.assign(new Error('运行所属画布或会话已改变，未继续执行。'), { code: 'STALE_AGENT_RUN' })
  }
  const skipRemaining = () => { for (const task of run.tasks) if (task.status === 'queued') task.status = 'skipped' }
  try {
    assertScope()
    phase('preparing')
    await adapters.prepare?.(run)
    assertScope()
    if (run.stopRequested) { phase('stopped'); return run }
    phase('planning')
    const plan = await adapters.plan(run)
    assertScope()
    run.requestId = clean(plan.agentRequestId, 160)
    run.referenceRequestId = clean(plan.referenceRequestId, 160)
    run.skill = plan.skill || null
    adapters.onPlan?.(plan, run)
    if (run.stopRequested) { phase('stopped'); return run }
    if (plan.needsClarification) { phase('waiting_input'); return run }
    if (run.mode === 'plan' || !plan.shouldGenerate) { phase('completed', '方案已整理，未生成图片'); return run }
    const actions = Array.isArray(plan.actions) ? plan.actions.filter((action) => action?.type === 'generate_image' && action.prompt) : []
    if (actions.length > AGENT_TASK_LIMIT) throw Object.assign(new Error(`一次最多生成 ${AGENT_TASK_LIMIT} 张，请拆分需求。`), { operationState: 'failed' })
    if (!actions.length) throw Object.assign(new Error('方案没有可执行的生图任务，未提交图片请求。'), { operationState: 'failed' })
    run.tasks = actions.map((action, index) => ({
      ...action, id: `${run.id}-image-${index + 1}`, status: 'queued', jobId: '', elementId: '', assetId: '', error: '',
    }))
    phase('executing')
    for (const task of run.tasks) {
      assertScope()
      if (run.stopRequested) { skipRemaining(); phase('stopped'); return run }
      task.status = 'running'
      emit('task_started', task.title, task.id)
      try {
        const result = await adapters.execute(task, {
          accepted: (jobId, elementId) => {
            task.jobId = jobId; task.elementId = elementId || task.elementId; task.status = 'accepted'
            emit('task_accepted', '图片任务已受理，正在读取原任务', task.id)
          },
          progress: (label) => emit('progress', label, task.id),
        }, run)
        assertScope()
        if (!result?.assetId) throw new Error('图片尚未保存为可读取的素材，结果待确认。')
        task.assetId = result.assetId; task.status = 'completed'
        emit('task_completed', '作品已保存到画布', task.id)
      } catch (error) {
        task.error = clean(error?.message || String(error), 600)
        const uncertainReceipt = task.jobId && error?.operationState !== 'failed'
        task.status = !uncertainReceipt && isKnownFailure(error) ? 'failed' : 'unknown'
        if (uncertainReceipt) error = Object.assign(error instanceof Error ? error : new Error(String(error)), { awaitingResult: true })
        skipRemaining()
        emit('task_failed', task.error, task.id)
        throw error
      }
    }
    phase('completed', '作品已保存到画布')
  } catch (error) {
    run.error = clean(error?.message || String(error), 600)
    run.requestId = clean(error?.payload?.agentRequestId || run.requestId, 160)
    run.referenceRequestId = clean(error?.payload?.referenceRequestId || run.referenceRequestId, 160)
    skipRemaining()
    const next = error?.code === 'STALE_AGENT_RUN' ? 'interrupted'
      : error?.awaitingResult || !isKnownFailure(error) ? 'awaiting_result'
        : run.tasks.some((task) => task.status === 'completed') ? 'partial_failed' : 'failed'
    phase(next)
  } finally {
    run.endedAt = now()
    emit('settled', AGENT_PHASE_LABELS[run.phase])
  }
  return run
}

export function buildDesignAgentManifest(run) {
  const snapshot = serializeDesignAgentRun(run)
  return { schema: 'visual-studio.design-agent-manifest/v1', ...snapshot,
    semanticReview: snapshot?.tasks.some(t => t.quality) ? 'performed_per_task' : 'not_performed',
    qualityChecklist: (snapshot?.skill?.qualityChecklist || []).map((criterion) => ({ criterion, status: 'needs_review' })),
  }
}
