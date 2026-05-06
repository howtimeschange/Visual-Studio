import { Env, json, corsPreflight } from '../../_shared'
import { requireAuth } from '../../_lib/auth'
import { submitGenerateDirectJob } from '../../_lib/v2-runner'
import { mergeUserClientKeys } from '../../_lib/user-api-keys'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  try {
    const user = await requireAuth(env, request)
    const clientKeys = await mergeUserClientKeys(env, user.id, body?.clientKeys || {})
    return json(await submitGenerateDirectJob(env, { ...body, clientKeys, _authUserId: user.id }, waitUntil))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Create direct generate job failed') }, error?.status || 502)
  }
}
