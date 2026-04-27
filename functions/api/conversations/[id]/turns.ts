import { Env, json, corsPreflight } from '../../../_shared'
import { getAuthContext } from '../../../_lib/auth'
import { getConversation, listConversationTurns } from '../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const conversationId = String(params?.id || '')
  const conversation = await getConversation(env, conversationId)
  if (!conversation) return json({ error: 'Conversation not found' }, 404)
  const auth = await getAuthContext(env, request)
  if (conversation.userId && conversation.userId !== auth.user?.id) return json({ error: 'No access to this conversation' }, 403)
  return json({ turns: await listConversationTurns(env, conversationId) })
}
