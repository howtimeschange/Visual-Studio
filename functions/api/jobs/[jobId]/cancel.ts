import { Env, json, corsPreflight } from '../../../_shared'
import { cancelJob } from '../../../_lib/v2-runner'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ params }) => {
  try {
    return json(await cancelJob(String(params?.jobId || '')))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Cancel failed') }, error?.status || 502)
  }
}
