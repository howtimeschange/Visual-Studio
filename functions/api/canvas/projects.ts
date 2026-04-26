import { Env, json, corsPreflight } from '../../_shared'
import { createCanvasProject, ensureSession, listCanvasProjects } from '../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const sessionId = new URL(request.url).searchParams.get('sessionId') || undefined
  return json({ projects: await listCanvasProjects(sessionId) })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const session = await ensureSession(env, body?.sessionId)
  const project = await createCanvasProject({
    sessionId: session.id,
    title: body?.title || 'Untitled canvas',
    metadataJson: body?.metadataJson && typeof body.metadataJson === 'object' ? body.metadataJson : {},
  })
  return json({ sessionId: session.id, project })
}
