import { Env, json, corsPreflight } from '../../_shared'
import { getAuthContext } from '../../_lib/auth'
import { createAsset, createUsageEvent, ensureSession } from '../../_lib/v2-store'

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

  const auth = await getAuthContext(env, request)
  const session = await ensureSession(env, body?.sessionId, auth.user?.id || null)
  const asset = await createAsset(env, {
    sessionId: session.id,
    userId: auth.user?.id || null,
    kind: body?.kind || 'upload',
    source: body?.source || 'browser_upload',
    filename: body?.filename || null,
    mime: body?.mime || undefined,
    dataUrl,
    width: body?.width ?? body?.originalWidth ?? null,
    height: body?.height ?? body?.originalHeight ?? null,
    bucketKind: body?.kind === 'result' ? 'result' : 'input',
  })
  await createUsageEvent(env, {
    userId: auth.user?.id || null,
    sessionId: session.id,
    eventType: 'asset_upload',
    amount: 1,
    metadataJson: {
      assetId: asset.id,
      kind: asset.kind,
      source: asset.source,
      sizeBytes: asset.sizeBytes,
    },
  })

  return json({ sessionId: session.id, asset })
}
