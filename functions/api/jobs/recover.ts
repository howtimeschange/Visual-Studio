import { Env, json, corsPreflight } from '../../_shared'
import { recoverJobs } from '../../_lib/v2-runner'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ env, waitUntil }) => {
  try {
    return json(await recoverJobs(env, waitUntil))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Recover jobs failed') }, error?.status || 502)
  }
}
