import { Env, json, corsPreflight } from '../../_shared'
import { getAuthContext } from '../../_lib/auth'
import { getJob } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const job = await getJob(env, String(params?.jobId || ''))
  if (!job) return json({ error: 'Job not found' }, 404)
  const auth = await getAuthContext(env, request)
  if (job.userId && job.userId !== auth.user?.id) return json({ error: 'No access to this job' }, 403)
  return json({ job })
}
