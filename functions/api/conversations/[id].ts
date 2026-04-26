import { Env, json, corsPreflight } from '../../_shared'
import { getConversation } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ params }) => {
  const conversation = await getConversation(String(params?.id || ''))
  if (!conversation) return json({ error: 'Conversation not found' }, 404)
  return json({ conversation })
}
