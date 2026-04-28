import { Env, json, corsPreflight } from '../../../_shared'
import { getAuthContext } from '../../../_lib/auth'
import { assertCanEditProject, assertCanReadProject } from '../../../_lib/permissions'
import { deleteCanvasProject, updateCanvasProject } from '../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const auth = await getAuthContext(env, request)
    const { project, role } = await assertCanReadProject(env, String(params?.id || ''), auth.user?.id || null)
    return json({ project: { ...project, accessRole: role || 'legacy' } })
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

  try {
    const auth = await getAuthContext(env, request)
    await assertCanEditProject(env, String(params?.id || ''), auth.user?.id || null)
    const project = await updateCanvasProject(env, String(params?.id || ''), {
      title: typeof body?.title === 'string' ? body.title : undefined,
      metadataJson: body?.metadataJson && typeof body.metadataJson === 'object' ? body.metadataJson : undefined,
    })
    if (!project) return json({ error: 'Canvas project not found' }, 404)
    return json({ project })
  } catch (error: any) {
    return json({ error: String(error?.message || 'Update project failed') }, error?.status || 502)
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const projectId = String(params?.id || '')
    const sessionId = new URL(request.url).searchParams.get('sessionId') || ''
    const auth = await getAuthContext(env, request)
    const access = await assertCanEditProject(env, projectId, auth.user?.id || null)
    if (access.project?.ownerUserId && access.role !== 'owner') {
      return json({ error: 'Owner permission required' }, 403)
    }
    if (!access.project?.ownerUserId && access.project?.sessionId !== sessionId) {
      return json({ error: 'No access to this project' }, 403)
    }
    const deleted = await deleteCanvasProject(env, projectId)
    if (!deleted) return json({ error: 'Canvas project not found' }, 404)
    return json({ ok: true })
  } catch (error: any) {
    return json({ error: String(error?.message || 'Delete project failed') }, error?.status || 502)
  }
}
