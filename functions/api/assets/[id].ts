import { Env, json, corsPreflight } from '../../_shared'
import { getAuthContext } from '../../_lib/auth'
import { assertCanReadProject } from '../../_lib/permissions'
import { getAsset, getAssetDataUrl, listCanvasProjectElements } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request }) => {
  const assetId = String(params?.id || '')
  const asset = await getAsset(env, assetId)
  if (!asset) return json({ error: 'Asset not found' }, 404)

  const url = new URL(request.url)
  const auth = await getAuthContext(env, request)
  if (asset.userId && asset.userId !== auth.user?.id) {
    const projectId = url.searchParams.get('projectId') || ''
    if (!projectId) return json({ error: 'No access to this asset' }, 403)
    try {
      await assertCanReadProject(env, projectId, auth.user?.id || null)
      const elements = await listCanvasProjectElements(env, projectId)
      const referenced = elements.some((record) => JSON.stringify(record.dataJson || {}).includes(assetId))
      if (!referenced) return json({ error: 'No access to this asset' }, 403)
    } catch (error: any) {
      return json({ error: String(error?.message || 'No access to this asset') }, error?.status || 403)
    }
  }

  const includeData = url.searchParams.get('includeData') === '1'
  const dataUrl = includeData ? await getAssetDataUrl(env, assetId) : null
  return json({ asset, dataUrl })
}
