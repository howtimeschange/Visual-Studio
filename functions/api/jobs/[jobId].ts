import { Env, json, corsPreflight } from '../../_shared'
import { getJob } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ params }) => {
  const job = await getJob(String(params?.jobId || ''))
  if (!job) return json({ error: 'Job not found' }, 404)
  return json({ job })
}
