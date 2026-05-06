import { Env, json, corsPreflight } from '../../../_shared'
import { requireAuth } from '../../../_lib/auth'
import { retryJob } from '../../../_lib/v2-runner'
import { getJob } from '../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  try {
    const user = await requireAuth(env, request)
    const jobId = String(params?.jobId || '')
    const job = await getJob(env, jobId)
    if (!job) return json({ error: 'Job not found' }, 404)
    if (job.userId && job.userId !== user.id) return json({ error: 'No access to this job' }, 403)
    return json(await retryJob(env, jobId, waitUntil))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Retry failed') }, error?.status || 502)
  }
}
