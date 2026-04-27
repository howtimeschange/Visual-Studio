import { Env, corsPreflight } from '../../_shared'
import { createLoginResponse, jsonWithCookie, registerUser } from '../../_lib/auth'
import { claimSessionResourcesForUser, createUsageEvent } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return jsonWithCookie({ error: 'Invalid JSON' }, undefined, 400)
  }

  try {
    const user = await registerUser(env, {
      email: String(body?.email || ''),
      password: String(body?.password || ''),
      name: String(body?.name || ''),
    })
    const login = await createLoginResponse(env, user, request)
    await claimSessionResourcesForUser(env, String(body?.sessionId || ''), user.id)
    await createUsageEvent(env, {
      userId: user.id,
      sessionId: String(body?.sessionId || '') || null,
      eventType: 'auth_register',
      amount: 1,
    })
    return jsonWithCookie({ user: login.user }, login.setCookie)
  } catch (error: any) {
    return jsonWithCookie({ error: String(error?.message || 'Register failed') }, undefined, error?.status || 500)
  }
}
