import { Env, json, corsPreflight } from '../../../../../_shared'
import { retryJobItem } from '../../../../../_lib/v2-runner'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ env, params, waitUntil }) => {
  try {
    return json(await retryJobItem(
      env,
      String(params?.jobId || ''),
      String(params?.itemId || ''),
      waitUntil,
    ))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Item retry failed') }, error?.status || 502)
  }
}
