import { Env, corsPreflight } from '../../_shared'
import { getAuthPayload, jsonWithCookie } from '../../_lib/auth'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return jsonWithCookie(await getAuthPayload(env, request))
}
