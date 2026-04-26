import { Env, json, corsPreflight } from '../../../../_shared'
import { getCanvasProject, listCanvasProjectElements, replaceCanvasProjectElements } from '../../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ params }) => {
  const projectId = String(params?.id || '')
  const project = await getCanvasProject(projectId)
  if (!project) return json({ error: 'Canvas project not found' }, 404)
  const records = await listCanvasProjectElements(projectId)
  return json({
    elements: records
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((record) => record.dataJson),
    records,
  })
}

export const onRequestPut: PagesFunction<Env> = async ({ request, params }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const elements = Array.isArray(body?.elements) ? body.elements : null
  if (!elements) return json({ error: 'elements array required' }, 400)

  const records = await replaceCanvasProjectElements(String(params?.id || ''), elements)
  if (!records) return json({ error: 'Canvas project not found' }, 404)
  return json({
    elements: records.map((record) => record.dataJson),
    records,
  })
}
