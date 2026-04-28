import { Env, json, corsPreflight } from '../../_shared'
import { requireAuth } from '../../_lib/auth'
import {
  clearUserClientKeys,
  getUserApiKeyStatus,
  saveUserClientKeys,
} from '../../_lib/user-api-keys'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = await requireAuth(env, request)
    return json({ apiKeys: await getUserApiKeyStatus(env, user.id) })
  } catch (error: any) {
    return json({ error: String(error?.message || 'Load API keys failed') }, error?.status || 502)
  }
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  try {
    const user = await requireAuth(env, request)
    return json({ apiKeys: await saveUserClientKeys(env, user.id, body?.keys || body) })
  } catch (error: any) {
    return json({ error: String(error?.message || 'Save API keys failed') }, error?.status || 502)
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = await requireAuth(env, request)
    return json({ apiKeys: await clearUserClientKeys(env, user.id) })
  } catch (error: any) {
    return json({ error: String(error?.message || 'Clear API keys failed') }, error?.status || 502)
  }
}
