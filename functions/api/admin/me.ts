import { Env, corsPreflight } from '../../_shared'
import { adminJson } from '../../_lib/admin'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return adminJson(env, request, async (admin) => ({
    admin: true,
    user: admin,
  }))
}
