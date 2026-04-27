import { Env, corsPreflight } from '../../_shared'
import { adminJson } from '../../_lib/admin'
import { getAdminOverview } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  return adminJson(env, request, async () => getAdminOverview(env, {
    onlineWindowMinutes: Number(url.searchParams.get('onlineWindowMinutes') || 5),
  }))
}
