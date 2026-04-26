import { Env, json, corsPreflight } from '../../_shared'
import { submitGenerateTurn } from '../../_lib/v2-runner'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  try {
    return json(await submitGenerateTurn(env, body, waitUntil))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Create generate turn job failed') }, error?.status || 502)
  }
}
