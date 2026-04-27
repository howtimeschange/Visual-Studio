import { Env, corsPreflight } from '../../_shared'
import { adminJson } from '../../_lib/admin'
import { listAdminUsage } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  return adminJson(env, request, async () => listAdminUsage(env, {
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    userId: url.searchParams.get('userId'),
    eventType: url.searchParams.get('eventType'),
    limit: Number(url.searchParams.get('limit') || 100),
  }))
}
