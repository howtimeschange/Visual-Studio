import { Env, json, corsPreflight } from '../../_shared'
import { getAuthContext } from '../../_lib/auth'
import { createCanvasProject, ensureSession, listCanvasProjects, listCanvasProjectsForUser } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const auth = await getAuthContext(env, request)
  const sessionId = new URL(request.url).searchParams.get('sessionId') || undefined
  const projects = auth.user
    ? await listCanvasProjectsForUser(env, auth.user.id, sessionId)
    : await listCanvasProjects(env, sessionId)
  return json({ projects })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const auth = await getAuthContext(env, request)
  const session = await ensureSession(env, body?.sessionId, auth.user?.id || null)
  const project = await createCanvasProject(env, {
    sessionId: session.id,
    ownerUserId: auth.user?.id || null,
    title: body?.title || 'Untitled canvas',
    metadataJson: body?.metadataJson && typeof body.metadataJson === 'object' ? body.metadataJson : {},
  })
  return json({ sessionId: session.id, project })
}
