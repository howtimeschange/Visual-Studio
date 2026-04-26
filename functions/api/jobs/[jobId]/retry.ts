import { Env, json, corsPreflight } from '../../../_shared'
import { retryJob } from '../../../_lib/v2-runner'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ env, params, waitUntil }) => {
  try {
    return json(await retryJob(env, String(params?.jobId || ''), waitUntil))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Retry failed') }, error?.status || 502)
  }
}
