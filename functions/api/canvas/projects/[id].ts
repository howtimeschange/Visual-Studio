import { Env, json, corsPreflight } from '../../../_shared'
import { getCanvasProject, updateCanvasProject } from '../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ params }) => {
  const project = await getCanvasProject(String(params?.id || ''))
  if (!project) return json({ error: 'Canvas project not found' }, 404)
  return json({ project })
}

export const onRequestPut: PagesFunction<Env> = async ({ request, params }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const project = await updateCanvasProject(String(params?.id || ''), {
    title: typeof body?.title === 'string' ? body.title : undefined,
    metadataJson: body?.metadataJson && typeof body.metadataJson === 'object' ? body.metadataJson : undefined,
  })
  if (!project) return json({ error: 'Canvas project not found' }, 404)
  return json({ project })
}
