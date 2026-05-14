import {
  Env,
  json,
  corsPreflight,
} from '../../_shared'
import { requireAuth } from '../../_lib/auth'
import { mergeUserClientKeys } from '../../_lib/user-api-keys'
import { decomposeCanvasPsdImage } from './psd-ocr'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  try {
    const user = await requireAuth(env, request)
    const clientKeys = await mergeUserClientKeys(env, user.id, body?.clientKeys || {})
    return json(await decomposeCanvasPsdImage(env, { ...body, clientKeys, _authUserId: user.id }))
  } catch (error: any) {
    return json({ error: String(error?.message || 'PSD decomposition failed') }, error?.status || 502)
  }
}
