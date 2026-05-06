import { Env, json, corsPreflight } from '../../_shared'
import { requireAuth } from '../../_lib/auth'
import { submitOutfitBatch } from '../../_lib/v2-runner'
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
    const userId = user.id
    const clientKeys = await mergeUserClientKeys(env, userId, body?.clientKeys || {})
    return json(await submitOutfitBatch(env, { ...body, clientKeys, _authUserId: userId }, waitUntil))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Create outfit job failed') }, error?.status || 502)
  }
}
