import { Env, json, corsPreflight } from '../../../../_shared'
import { getAuthContext } from '../../../../_lib/auth'
import { assertCanEditProject, assertCanReadProject } from '../../../../_lib/permissions'
import { listCanvasProjectElements, replaceCanvasProjectElements } from '../../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const projectId = String(params?.id || '')
  try {
    const auth = await getAuthContext(env, request)
    await assertCanReadProject(env, projectId, auth.user?.id || null)
    const records = await listCanvasProjectElements(env, projectId)
    return json({
      elements: records
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((record) => record.dataJson),
      records,
    })
  } catch (error: any) {
    return json({ error: String(error?.message || 'Canvas project not found') }, error?.status || 404)
  }
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const elements = Array.isArray(body?.elements) ? body.elements : null
  if (!elements) return json({ error: 'elements array required' }, 400)

  try {
    const auth = await getAuthContext(env, request)
    await assertCanEditProject(env, String(params?.id || ''), auth.user?.id || null)
    const records = await replaceCanvasProjectElements(env, String(params?.id || ''), elements)
    if (!records) return json({ error: 'Canvas project not found' }, 404)
    return json({
      elements: records.map((record) => record.dataJson),
      records,
    })
  } catch (error: any) {
    return json({ error: String(error?.message || 'Save project elements failed') }, error?.status || 502)
  }
}
