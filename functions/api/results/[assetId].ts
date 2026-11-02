import { Env, corsPreflight } from '../../_shared'
import { requireAuth } from '../../_lib/auth'
import { assertCanReadAsset } from '../../_lib/permissions'
import { getAsset, getAssetDataUrl, getAssetR2Object, listCanvasProjectElements } from '../../_lib/v2-store'

function dataUrlToResponse(dataUrl: string, mime: string, filename: string) {
  const payload = dataUrl.split(',', 2)[1] || ''
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Response(bytes, {
    headers: resultHeaders(mime, filename),
  })
}

function resultHeaders(mime: string, filename: string) {
  return {
    'Content-Type': mime,
    'Content-Disposition': `inline; filename="${filename}"`,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  }
}

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request }) => {
  const assetId = String(params?.assetId || '')
  let asset
  try {
    const user = await requireAuth(env, request)
    asset = await assertCanReadAsset(env, assetId, user.id, new URL(request.url).searchParams.get('projectId') || '')
  } catch (error: any) { return new Response(error.message, { status: error.status || 403 }) }
  const mime = asset.mime || 'image/png'
  const filename = asset.filename || `${asset.id}.png`
  const object = await getAssetR2Object(env, asset)
  if (object?.body) {
    return new Response(object.body, {
      headers: resultHeaders(object.httpMetadata?.contentType || mime, filename),
    })
  }

  const dataUrl = await getAssetDataUrl(env, assetId)
  if (!dataUrl) {
    return new Response('Asset data not found', { status: 404 })
  }
  return dataUrlToResponse(dataUrl, mime, filename)
}
