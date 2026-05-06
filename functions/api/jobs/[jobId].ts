import { Env, json, corsPreflight } from '../../_shared'
import { requireAuth } from '../../_lib/auth'
import { deleteJob } from '../../_lib/v2-runner'
import { getJob } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  let user
  try {
    user = await requireAuth(env, request)
  } catch (error: any) {
    return json({ error: String(error?.message || 'Load job failed') }, error?.status || 502)
  }

  const job = await getJob(env, String(params?.jobId || ''))
  if (!job) return json({ error: 'Job not found' }, 404)
  if (job.userId && job.userId !== user.id) return json({ error: 'No access to this job' }, 403)
  return json({ job })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const user = await requireAuth(env, request)
    const jobId = String(params?.jobId || '')
    const job = await getJob(env, jobId)
    if (!job) return json({ error: 'Job not found' }, 404)
    if (job.userId && job.userId !== user.id) return json({ error: 'No access to this job' }, 403)
    return json(await deleteJob(env, jobId))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Delete job failed') }, error?.status || 502)
  }
}
