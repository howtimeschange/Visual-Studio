import { Env, json, corsPreflight } from '../../../_shared'
import { requireAuth } from '../../../_lib/auth'
import { listCanvasProjectCardsForUser, listCanvasProjectsForUser } from '../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = await requireAuth(env, request)
    const summary = new URL(request.url).searchParams.get('summary') === '1'
    const projects = summary ? await listCanvasProjectCardsForUser(env, user.id) : await listCanvasProjectsForUser(env, user.id)
    const response = json({ projects: projects.filter((project) => project.accessRole !== 'owner') })
    response.headers.set('Cache-Control', 'no-store'); return response
  } catch (error: any) {
    return json({ error: String(error?.message || 'Load shared projects failed') }, error?.status || 502)
  }
}
