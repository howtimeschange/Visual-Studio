import { Env, json, corsPreflight } from '../_shared'
import { createConversation, ensureSession } from '../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const session = await ensureSession(env, body?.sessionId)
  const conversation = await createConversation(session.id)
  return json({ sessionId: session.id, conversation })
}
