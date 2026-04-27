import { Env, corsPreflight } from '../../_shared'
import { getAuthContext } from '../../_lib/auth'
import { assertCanReadProject } from '../../_lib/permissions'
import { getAsset, getAssetDataUrl, listCanvasProjectElements } from '../../_lib/v2-store'

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

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request }) => {
  const assetId = String(params?.assetId || '')
  const asset = await getAsset(env, assetId)
  if (!asset) {
    return new Response('Asset not found', { status: 404 })
  }
  const auth = await getAuthContext(env, request)
  if (asset.userId && asset.userId !== auth.user?.id) {
    const projectId = new URL(request.url).searchParams.get('projectId') || ''
    try {
      if (!projectId) throw new Error('No access to this asset')
      await assertCanReadProject(env, projectId, auth.user?.id || null)
      const elements = await listCanvasProjectElements(env, projectId)
      const referenced = elements.some((record) => JSON.stringify(record.dataJson || {}).includes(assetId))
      if (!referenced) throw new Error('No access to this asset')
    } catch (error: any) {
      return new Response(String(error?.message || 'No access to this asset'), { status: error?.status || 403 })
    }
  }
  const dataUrl = await getAssetDataUrl(env, assetId)
  if (!dataUrl) {
    return new Response('Asset data not found', { status: 404 })
  }
  return dataUrlToResponse(dataUrl, asset.mime || 'image/png', asset.filename || `${asset.id}.png`)
}
