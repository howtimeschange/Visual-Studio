import { Env, corsPreflight } from '../../_shared'
import { clearAuthCookieHeader, getBearerToken, jsonWithCookie } from '../../_lib/auth'
import { sha256Hex } from '../../../packages/core/hash'
import { deleteAuthSession } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = getBearerToken(request)
  if (token) await deleteAuthSession(env, await sha256Hex(token))
  return jsonWithCookie(
    { ok: true },
    clearAuthCookieHeader(new URL(request.url).protocol === 'https:'),
  )
}
