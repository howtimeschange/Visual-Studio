export function agentRunProgress(run, loadingText = '', now = Date.now()) {
  const tasks = run.tasks || [], events = run.events || []
  const active = ['preparing', 'planning', 'executing'].includes(run.phase)
  const task = tasks.find(task => !['completed', 'skipped'].includes(task.status))
  let stage = run.clientStage || (run.phase === 'preparing' ? 'queue' : run.phase === 'planning' ? 'planning' : 'generating')
  if (!run.clientStage && task?.assetId) stage = 'review'
  if (!active) stage = 'done'
  const labels = { preparing: '准备画布', uploading: '上传参考图', submitting: '提交任务', queue: '等待开始', planning: '理解与规划', generating: '正在生成图片', review: '图片已保存，正在检查', done: '处理结束' }
  const hints = { preparing: '消息已显示，正在准备本轮画布。', uploading: '正在保存参考图，上传完成后自动继续。', submitting: '正在确认任务是否受理，请保留当前页面。', queue: '任务已受理，正在等待开始。', planning: 'Agent 正在结合参考图和你的要求制定方案。', generating: '图片任务已受理，生成完成后会自动显示。', review: '现在就可以查看和下载作品，无需等待检查结束。' }
  const stageEvent = [...events].reverse().find(event => stage === 'review' ? event.type === 'progress' && /检查/.test(event.label) : stage === 'generating' ? event.type === 'task_accepted' : stage === 'planning' ? event.type === 'phase' && /规划/.test(event.label) : false)
  const startedAt = Number(run.clientStageAt || stageEvent?.at || run.startedAt) || now
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
  const index = ['preparing', 'uploading', 'submitting', 'queue'].includes(stage) ? 0 : stage === 'planning' ? 1 : stage === 'generating' ? 2 : 3
  return { active, stage, index, elapsed, label: run.clientStage && loadingText ? loadingText : labels[stage], hint: (hints[stage] || '') + (active && elapsed >= 30 && !run.clientStage ? ' 仍在等待原任务，请勿重复提交。' : ''), startedAt }
}

export const formatAgentElapsed = seconds => seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
