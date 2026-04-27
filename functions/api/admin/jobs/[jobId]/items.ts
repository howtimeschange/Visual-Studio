import { Env, corsPreflight } from '../../../../_shared'
import { adminJson } from '../../../../_lib/admin'
import { getJob, listJobItems } from '../../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const jobId = String(params?.jobId || '')
  return adminJson(env, request, async () => {
    const job = await getJob(env, jobId)
    if (!job) {
      const error = new Error('Job not found') as Error & { status?: number }
      error.status = 404
      throw error
    }
    const items = await listJobItems(env, jobId)
    return { job, items }
  })
}
