import { Env, json, corsPreflight } from '../_shared'
import { getAuthContext } from '../_lib/auth'
import { createConversation, ensureSession } from '../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const auth = await getAuthContext(env, request)
  const session = await ensureSession(env, body?.sessionId, auth.user?.id || null)
  const conversation = await createConversation(env, session.id, auth.user?.id || null)
  return json({ sessionId: session.id, conversation })
}
