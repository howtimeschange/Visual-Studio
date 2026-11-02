import { Env, json } from '../../_shared'
import { requireAuth } from '../../_lib/auth'
import { getModeljettyConnection, disconnectModeljetty } from '../../_lib/modeljetty-auth'
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  try {
    const user = await requireAuth(env, request)
    const response = json(await getModeljettyConnection(env, user.id))
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error: any) { return json({ error: error.message }, error.status || 503) }
}
export const onRequestDelete: PagesFunction<Env> = async ({ env, request }) => {
  try {
    const user = await requireAuth(env, request)
    const response = json(await disconnectModeljetty(env, user.id))
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error: any) { return json({ error: error.message }, error.status || 503) }
}
