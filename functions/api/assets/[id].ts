import { Env, json, corsPreflight } from '../../_shared'
import { requireAuth } from '../../_lib/auth'
import { assertCanReadAsset } from '../../_lib/permissions'
import { getAsset, getAssetDataUrl, listCanvasProjectElements } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request }) => {
  const assetId = String(params?.id || '')
  const url = new URL(request.url)
  let asset
  try {
    const user = await requireAuth(env, request)
    asset = await assertCanReadAsset(env, assetId, user.id, url.searchParams.get('projectId') || '')
  } catch (error: any) { return json({ error: error.message }, error.status || 403) }

  const includeData = url.searchParams.get('includeData') === '1'
  const dataUrl = includeData ? await getAssetDataUrl(env, assetId) : null
  return json({ asset, dataUrl })
}
