import { Env, corsPreflight } from '../../_shared'
import { adminJson } from '../../_lib/admin'
import { listAdminUsers } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  return adminJson(env, request, async () => listAdminUsers(env, {
    q: url.searchParams.get('q') || '',
    limit: Number(url.searchParams.get('limit') || 50),
    offset: Number(url.searchParams.get('offset') || 0),
    onlineWindowMinutes: Number(url.searchParams.get('onlineWindowMinutes') || 5),
  }))
}
