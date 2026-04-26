import { Env, corsPreflight } from '../../_shared'
import { getAsset, getAssetDataUrl } from '../../_lib/v2-store'

function dataUrlToResponse(dataUrl: string, mime: string, filename: string) {
  const payload = dataUrl.split(',', 2)[1] || ''
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Response(bytes, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${filename}"`,
      'Access-Control-Allow-Origin': '*',
    },
  })
}

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const assetId = String(params?.assetId || '')
  const asset = await getAsset(assetId)
  if (!asset) {
    return new Response('Asset not found', { status: 404 })
  }
  const dataUrl = await getAssetDataUrl(env, assetId)
  if (!dataUrl) {
    return new Response('Asset data not found', { status: 404 })
  }
  return dataUrlToResponse(dataUrl, asset.mime || 'image/png', asset.filename || `${asset.id}.png`)
}
