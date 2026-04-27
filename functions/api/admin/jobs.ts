import { Env, corsPreflight } from '../../_shared'
import { adminJson } from '../../_lib/admin'
import { listAdminJobs } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  return adminJson(env, request, async () => listAdminJobs(env, {
    q: url.searchParams.get('q') || '',
    status: url.searchParams.get('status'),
    type: url.searchParams.get('type'),
    userId: url.searchParams.get('userId'),
    limit: Number(url.searchParams.get('limit') || 50),
    offset: Number(url.searchParams.get('offset') || 0),
  }))
}
