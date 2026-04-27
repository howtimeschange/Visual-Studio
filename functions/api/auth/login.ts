import { Env, corsPreflight } from '../../_shared'
import { createLoginResponse, jsonWithCookie, verifyPassword } from '../../_lib/auth'
import { claimSessionResourcesForUser, createUsageEvent, getUserByEmail } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return jsonWithCookie({ error: 'Invalid JSON' }, undefined, 400)
  }

  const user = await getUserByEmail(env, String(body?.email || ''))
  if (!user || !(await verifyPassword(String(body?.password || ''), user))) {
    return jsonWithCookie({ error: '邮箱或密码不正确' }, undefined, 401)
  }

  const login = await createLoginResponse(env, user, request)
  await claimSessionResourcesForUser(env, String(body?.sessionId || ''), user.id)
  await createUsageEvent(env, {
    userId: user.id,
    sessionId: String(body?.sessionId || '') || null,
    eventType: 'auth_login',
    amount: 1,
  })
  return jsonWithCookie({ user: login.user }, login.setCookie)
}
