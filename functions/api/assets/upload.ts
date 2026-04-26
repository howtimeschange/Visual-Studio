import { Env, json, corsPreflight } from '../../_shared'
import { createAsset, ensureSession } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const dataUrl = body?.dataUrl || (body?.base64 ? `data:${body?.mime || 'image/png'};base64,${body.base64}` : '')
  if (!dataUrl) return json({ error: 'dataUrl or base64 required' }, 400)

  const session = await ensureSession(env, body?.sessionId)
  const asset = await createAsset(env, {
    sessionId: session.id,
    kind: body?.kind || 'upload',
    source: body?.source || 'browser_upload',
    filename: body?.filename || null,
    mime: body?.mime || undefined,
    dataUrl,
    bucketKind: body?.kind === 'result' ? 'result' : 'input',
  })

  return json({ sessionId: session.id, asset })
}
