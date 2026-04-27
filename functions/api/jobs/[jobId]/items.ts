import { Env, json, corsPreflight } from '../../../_shared'
import { getAuthContext } from '../../../_lib/auth'
import { getJob, listJobItems } from '../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const jobId = String(params?.jobId || '')
  const job = await getJob(env, jobId)
  if (!job) return json({ error: 'Job not found' }, 404)
  const auth = await getAuthContext(env, request)
  if (job.userId && job.userId !== auth.user?.id) return json({ error: 'No access to this job' }, 403)
  return json({ items: await listJobItems(env, jobId) })
}
