// The browser observes durable server runs. It never replays model operations.
export function createCanvasAgentWatcher({ getJson, recover, onSnapshot, onError, interval = 3000 }) {
  let scope = '', timer, busy = false, epoch = 0
  async function tick(projectId, ownerId, token) {
    if (token !== epoch || busy) return
    busy = true
    try {
      const data = await getJson(`/api/canvas/projects/${encodeURIComponent(projectId)}/agent-runs`)
      if (token !== epoch) return
      const runs = data.runs || []
      const elements = runs.some(r => r.run?.tasks?.some(t => t.assetId))
        ? (await getJson(`/api/canvas/projects/${encodeURIComponent(projectId)}/elements`)).elements || [] : []
      if (token === epoch) await onSnapshot({ runs, elements, projectId, ownerId })
    } catch (error) { if (token === epoch) onError?.(error) }
    finally {
      busy = false
      if (token === epoch) timer = setTimeout(() => tick(projectId, ownerId, token), interval)
    }
  }
  return {
    start(projectId, ownerId, force = false) {
      const next = `${ownerId}:${projectId}`
      if (!projectId || !ownerId || (scope === next && !force)) return
      const changed = scope !== next
      scope = next; epoch++; clearTimeout(timer)
      if (changed) void recover?.().catch(error => onError?.(error))
      // Wait for the previous read to leave its finally block before switching.
      const token = epoch
      const launch = () => { if (token !== epoch) return; if (busy) timer = setTimeout(launch, 50); else void tick(projectId, ownerId, token) }
      launch()
    },
    stop() { scope = ''; epoch++; clearTimeout(timer) },
  }
}

export function mergeAgentRunMessages(messages, record) {
  const run = record.run
  if (!run) return messages
  const result = [...messages]
  if (!result.some(m => m.id === `${run.id}-user` || m.run?.id === run.id)) result.push({ id: `${run.id}-user`, role: 'user', content: record.userMessage || '', refs: (record.referenceImages || []).map(ref => ({ ...ref, name:ref.label || '参考图', dataUrl:`/api/results/${encodeURIComponent(ref.assetId)}?projectId=${encodeURIComponent(run.projectId)}` })) })
  let assistant = result.find(m => m.run?.id === run.id)
  if (!assistant) { assistant = { id: `${run.id}-assistant`, role: 'assistant' }; result.push(assistant) }
  const plan = record.plan || {}
  // Keep browser preparation time after the first durable server snapshot.
  if (assistant.run?.clientTimings && !run.clientTimings) run.clientTimings = assistant.run.clientTimings
  const active = ['preparing', 'planning', 'executing'].includes(run.phase)
  const completed = run.tasks.filter(t => t.status === 'completed').length
  Object.assign(assistant, { run, loading: active, loadingText: run.events.at(-1)?.label || '正在恢复服务端任务',
    agentModel: plan.agentModel || '', agentProvider: plan.provider || '', steps: plan.steps || [], suggestions: plan.suggestions || [],
    needsClarification: Boolean(plan.needsClarification), styleIntent: plan.styleIntent || null,
    content: (plan.reply || (active ? '' : run.error || '本轮处理结束。')) + (!active && run.tasks.length ? `\n\n已保存 ${completed}/${run.tasks.length} 张作品到画布。` : ''),
    images: run.tasks.filter(t => t.assetId).map(t => ({ assetId: t.assetId, name: t.title, prompt: t.prompt,
      dataUrl: `/api/results/${encodeURIComponent(t.assetId)}?projectId=${encodeURIComponent(run.projectId)}`, actionId: t.id, aspectRatio: t.aspectRatio, mime:t.mime || '' })),
  })
  return result
}
