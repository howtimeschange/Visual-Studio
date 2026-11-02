import { createUiIcon } from './workspace-ui.js'
import { AGENT_PHASE_LABELS, isAgentRunActive } from './design-agent-harness.js'

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

export function createAgentRunRecord(run, { onFocusTask, onExport, expanded, loadingText, renderLoading, onResume } = {}) {
  const root = element('section', 'agent-run-record')
  root.dataset.phase = run.phase
  const active = isAgentRunActive(run)
  if (['failed', 'partial_failed', 'awaiting_result', 'interrupted'].includes(run.phase)) {
    const notice = element('div', 'agent-run-alert')
    notice.setAttribute('role', 'alert')
    notice.append(element('strong', '', AGENT_PHASE_LABELS[run.phase]))
    notice.append(element('p', '', run.error || '页面离开时运行尚未结束，请先查看原任务状态。'))
    if (['awaiting_result', 'interrupted'].includes(run.phase)) notice.append(element('p', '', '没有自动重发。已受理的图片可在画布任务卡中继续读取。'))
    if (run.phase === 'awaiting_result' && (run.tasks.length || !run.requestId) && onResume) {
      const resume = element('button', 'agent-task-focus', '回查原任务并继续')
      resume.type = 'button'; resume.addEventListener('click', () => { resume.disabled = true; Promise.resolve(onResume()).finally(() => { resume.disabled = false }) }); notice.append(resume)
    }
    root.append(notice)
  }
  if (!active && run.tasks.some(t => t.delivery?.status === 'mismatch' || t.quality?.status === 'needs_review' || t.quality?.status === 'unknown')) {
    const notice = element('p', 'agent-run-alert', '作品已保存，规格或画面有待复核。展开执行记录查看详情。'); root.append(notice)
  }
  const details = element('details', 'agent-run-details')
  details.dataset.runId = run.id
  details.open = expanded ?? false
  const summary = element('summary', 'agent-run-summary')
  const complete = run.tasks.filter((task) => task.status === 'completed').length
  if (active && renderLoading) summary.append(renderLoading(loadingText || AGENT_PHASE_LABELS[run.phase]))
  else {
    summary.append(createUiIcon(run.phase === 'completed' ? 'check' : 'circle-help'))
    summary.append(element('strong', '', run.tasks.length ? `执行记录 · ${complete}/${run.tasks.length} 张` : AGENT_PHASE_LABELS[run.phase]))
  }
  if (run.startedAt && run.endedAt && run.endedAt >= run.startedAt) summary.append(element('span', 'agent-run-duration', run.endedAt - run.startedAt < 1000 ? '不足 1 秒' : `${Math.round((run.endedAt - run.startedAt) / 1000)} 秒`))
  summary.append(createUiIcon('chevron-down'))
  details.append(summary)
  const body = element('div', 'agent-run-body')
  const context = element('div', 'agent-run-context')
  context.append(element('span', '', run.mode === 'plan' ? '仅规划 · 不提交图片' : '自动创作'))
  if (run.skill?.label) context.append(element('span', '', `能力：${run.skill.label}`))
  context.append(element('span', '', `${run.context.referenceCount} 张参考 · ${run.context.elementCount} 个画布元素`))
  body.append(context)
  if (run.execution === 'server') body.append(element('p', 'agent-run-context', '服务端持续执行 · 刷新或关闭页面后可恢复'))
  if (run.timings?.planningMs) body.append(element('p', 'agent-run-context', `规划 ${Math.round(run.timings.planningMs / 1000)} 秒 · ${run.timings.modelCalls} 次模型请求`))
  if (run.tasks.length) {
    const list = element('ol', 'agent-task-list')
    const labels = { queued: '等待', running: '准备提交', accepted: '已受理', completed: '已保存', failed: '失败', unknown: '待确认', skipped: '未执行' }
    for (const task of run.tasks) {
      const row = element('li', 'agent-task-row')
      row.dataset.status = task.status
      const head = element('div', 'agent-task-head')
      head.append(element('span', 'agent-task-status', labels[task.status] || '待确认'), element('strong', '', task.title))
      row.append(head)
      if (task.timings) row.append(element('p', 'agent-delivery', `结果传输 ${(task.timings.resultTransferMs / 1000).toFixed(1)} 秒`))
      if (task.delivery) {
        row.append(element('p', 'agent-delivery', `实际 ${task.delivery.width || '?'}×${task.delivery.height || '?'} px · 所选 ${(task.delivery.requestedResolution || task.resolution || '').toUpperCase()} / ${task.aspectRatio || '1:1'}（检查最低长边 ${task.delivery.targetLongEdge || ({'1k':1024,'2k':2048,'4k':4096})[task.resolution] || 1024}px 与比例）`))
        for (const issue of task.delivery.issues || []) row.append(element('p', 'agent-task-error', issue))
      }
      if (task.quality) {
        row.append(element('p', 'agent-quality', `独立视觉检查：${({passed:'通过',needs_review:'待复核',unknown:'未能确认'})[task.quality.status] || '未能确认'}${task.quality.summary ? ` · ${task.quality.summary}` : ''}`))
        for (const issue of task.quality.issues || []) row.append(element('p', 'agent-task-error', issue))
      }
      if (task.error) row.append(element('p', 'agent-task-error', task.error))
      if (task.elementId && onFocusTask) {
        const button = element('button', 'agent-task-focus', task.status === 'completed' ? '定位作品' : '查看原任务')
        button.type = 'button'
        button.addEventListener('click', () => onFocusTask(task))
        row.append(button)
      }
      list.append(row)
    }
    body.append(list)
  }
  const events = element('ol', 'agent-event-list')
  const meaningful = run.events.filter((event) => event.type !== 'progress' && !(active && event.type === 'phase' && event.label === AGENT_PHASE_LABELS[run.phase])).slice(-12)
  for (const event of meaningful) events.append(element('li', '', event.label))
  if (meaningful.length) body.append(events)
  if (run.requestId || run.referenceRequestId) {
    const ids = element('p', 'agent-request-ids')
    ids.textContent = run.requestId === run.referenceRequestId ? `看图与规划请求：${run.requestId}` : [run.requestId && `规划请求：${run.requestId}`, run.referenceRequestId && `看图请求：${run.referenceRequestId}`].filter(Boolean).join('\n')
    body.append(ids)
  }
  if (!active && onExport) {
    const button = element('button', 'agent-manifest-export', '查看生成清单')
    button.type = 'button'
    button.addEventListener('click', () => onExport(run))
    body.append(button)
  }
  details.append(body)
  root.append(details)
  return root
}

export function createAgentManifestDialog(manifest, { onDownload } = {}) {
  const dialog = element('dialog', 'agent-manifest-dialog')
  dialog.setAttribute('aria-label', '本轮生成清单')
  dialog.append(element('h3', '', '本轮生成清单'))
  const completed = manifest.tasks.filter((task) => task.status === 'completed').length
  dialog.append(element('p', 'hint', `${manifest.skill?.label || '视觉创作'} · 已保存 ${completed}/${manifest.tasks.length} 张作品`))
  dialog.append(element('p', 'hint', '产品保真、文字和卖点仍需人工复核。'))
  if (manifest.qualityChecklist.length) {
    const checks = element('ul', 'agent-manifest-checks')
    for (const item of manifest.qualityChecklist) checks.append(element('li', '', `待复核 · ${item.criterion}`))
    dialog.append(checks)
  }
  const details = element('details', 'agent-manifest-json')
  details.append(element('summary', '', '查看 JSON'))
  details.append(element('pre', '', JSON.stringify(manifest, null, 2)))
  dialog.append(details)
  const actions = element('div', 'dialog-actions')
  if (onDownload) {
    const download = element('button', '', '下载 JSON')
    download.type = 'button'
    download.addEventListener('click', onDownload)
    actions.append(download)
  }
  const close = element('button', 'primary', '关闭')
  close.type = 'button'
  close.addEventListener('click', () => dialog.close())
  actions.append(close)
  dialog.append(actions)
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  return dialog
}
