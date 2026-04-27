import { Env, json, corsPreflight } from '../../../_shared'
import { requireAuth } from '../../../_lib/auth'
import { listCanvasProjectsForUser } from '../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = await requireAuth(env, request)
    const projects = await listCanvasProjectsForUser(env, user.id)
    return json({ projects: projects.filter((project) => project.accessRole !== 'owner') })
  } catch (error: any) {
    return json({ error: String(error?.message || 'Load shared projects failed') }, error?.status || 502)
  }
}
