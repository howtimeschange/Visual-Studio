import { Env, json } from '../../../_shared'
import { startModeljettyLogin } from '../../../_lib/modeljetty-auth'
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  try { return await startModeljettyLogin(env, request) }
  catch (error: any) { return json({ error: error.message }, error.status || 503) }
}
