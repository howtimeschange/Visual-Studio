import { Env, json, corsPreflight } from '../../../_shared'
import { listConversationTurns } from '../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ params }) => {
  return json({ turns: await listConversationTurns(String(params?.id || '')) })
}
