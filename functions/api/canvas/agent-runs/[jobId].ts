import { json, type Env } from '../../../_shared'
import { requireAuth } from '../../../_lib/auth'
import { assertCanReadProject, assertCanEditProject } from '../../../_lib/permissions'
import { getJob, updateJob, listJobItems } from '../../../_lib/v2-store'
import { publicCanvasAgentJob, stopCanvasAgentJob } from '../../../_lib/canvas-agent-runner'
import { retryJob, resumeJob, scheduleJobExecution } from '../../../_lib/v2-runner'

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const user = await requireAuth(env, request)
    const job = await getJob(env, String(params.jobId))
    if (!job || job.type !== 'canvas_agent') return json({ error: 'Run not found' }, 404)
    await assertCanReadProject(env, String(job.configJson.inputProjectId), user.id)
    const response = json(publicCanvasAgentJob(job)); response.headers.set('Cache-Control', 'no-store'); return response
  } catch (error: any) { return json({ error: error.message }, error.status || 502) }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  try {
    const user = await requireAuth(env, request)
    const body: any = await request.json()
    const job = await getJob(env, String(params.jobId))
    if (!job || job.type !== 'canvas_agent') return json({ error: 'Run not found' }, 404)
    await assertCanEditProject(env, String(job.configJson.inputProjectId), user.id)
    if (job.userId !== user.id) return json({ error: 'Only the run owner can change it' }, 403)
    if (body.action === 'stop') return json(await stopCanvasAgentJob(env, job))
    if (body.action !== 'resume' || job.status !== 'paused') return json({ error: '此运行没有可安全继续的任务。' }, 409)
    const parentItems = await listJobItems(env, job.id)
    if (!job.summaryJson.plan && parentItems.some(item => item.outputJson.planningIntent)) return json({error:'规划结果不明，禁止重发。'},409)
    const run: any = job.summaryJson.run
    for (const task of run.tasks || []) {
      if (task.status !== 'unknown') continue
      const child = await getJob(env, task.jobId)
      if (!child) return json({ error: '原任务回执缺失，请先回查。' }, 409)
      const items = await listJobItems(env, child.id)
      if (child.status === 'failed' && !items.some(i => i.outputJson.imageTask)) return json({ error: '原任务结果待确认，不能重发。' }, 409)
      if (child.status === 'failed') await retryJob(env, child.id, waitUntil)
      if (child.status === 'paused') await resumeJob(env, child.id, waitUntil)
      task.status = 'accepted'
    }
    const next = await updateJob(env, job.id, { status: 'queued', summaryJson: { ...job.summaryJson, error:'', run: { ...run, endedAt:null, error: '', phase: job.summaryJson.plan ? 'executing' : 'preparing' } } })
    if (next) await scheduleJobExecution(env, next, waitUntil, 'recover')
    return json({ resumed: true })
  } catch (error: any) { return json({ error: error.message }, error.status || 502) }
}
