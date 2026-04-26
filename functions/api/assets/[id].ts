import { Env, json, corsPreflight } from '../../_shared'
import { getAsset, getAssetDataUrl } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request }) => {
  const assetId = String(params?.id || '')
  const asset = await getAsset(assetId)
  if (!asset) return json({ error: 'Asset not found' }, 404)

  const includeData = new URL(request.url).searchParams.get('includeData') === '1'
  const dataUrl = includeData ? await getAssetDataUrl(env, assetId) : null
  return json({ asset, dataUrl })
}
