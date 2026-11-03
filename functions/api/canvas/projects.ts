import { Env, json, corsPreflight } from '../../_shared'
import { requireAuth } from '../../_lib/auth'
import { createCanvasProject, ensureSession, listCanvasProjectCardsForUser, listCanvasProjectsForUser } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  let auth
  try { auth = { user: await requireAuth(env, request) } } catch { return json({ error: 'Login required' }, 401) }
  const summary = new URL(request.url).searchParams.get('summary') === '1'
  const projects = summary ? await listCanvasProjectCardsForUser(env, auth.user.id) : await listCanvasProjectsForUser(env, auth.user.id)
  const response = json({ projects }); response.headers.set('Cache-Control', 'no-store'); return response
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  let auth
  try { auth = { user: await requireAuth(env, request) } } catch { return json({ error: 'Login required' }, 401) }
  const session = await ensureSession(env, body?.sessionId, auth.user?.id || null)
  const project = await createCanvasProject(env, {
    sessionId: session.id,
    ownerUserId: auth.user?.id || null,
    title: body?.title || 'Untitled canvas',
    metadataJson: body?.metadataJson && typeof body.metadataJson === 'object' ? body.metadataJson : {},
  })
  return json({ sessionId: session.id, project })
}
