import { Env, json, corsPreflight } from '../../_shared'
import { getAuthContext } from '../../_lib/auth'
import { submitTranslateBatch } from '../../_lib/v2-runner'
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
    const auth = await getAuthContext(env, request)
    const userId = auth.user?.id || null
    const clientKeys = await mergeUserClientKeys(env, userId, body?.clientKeys || {})
    return json(await submitTranslateBatch(env, { ...body, clientKeys, _authUserId: userId }, waitUntil))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Create translate job failed') }, error?.status || 502)
  }
}
