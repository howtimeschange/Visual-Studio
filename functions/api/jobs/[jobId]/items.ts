import { Env, json, corsPreflight } from '../../../_shared'
import { listJobItems } from '../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ params }) => {
  return json({ items: await listJobItems(String(params?.jobId || '')) })
}
