import { Env, json, corsPreflight } from '../../_shared'
import { requireAuth } from '../../_lib/auth'
import { recoverJobs } from '../../_lib/v2-runner'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    await requireAuth(env, request)
    return json(await recoverJobs(env, waitUntil))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Recover jobs failed') }, error?.status || 502)
  }
}
