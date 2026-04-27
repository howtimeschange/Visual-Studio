import { Env, json, corsPreflight } from '../../../../../_shared'
import { getAuthContext } from '../../../../../_lib/auth'
import { retryJobItem } from '../../../../../_lib/v2-runner'
import { getJob } from '../../../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  try {
    const jobId = String(params?.jobId || '')
    const job = await getJob(env, jobId)
    if (!job) return json({ error: 'Job not found' }, 404)
    const auth = await getAuthContext(env, request)
    if (job.userId && job.userId !== auth.user?.id) return json({ error: 'No access to this job' }, 403)
    return json(await retryJobItem(
      env,
      jobId,
      String(params?.itemId || ''),
      waitUntil,
    ))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Item retry failed') }, error?.status || 502)
  }
}
