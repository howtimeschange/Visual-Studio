import { Env, json, corsPreflight } from '../../../../../_shared'
import { requireAuth } from '../../../../../_lib/auth'
import { assertCanEditProject } from '../../../../../_lib/permissions'
import { removeProjectMember, upsertProjectMember } from '../../../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

function normalizeRole(value: unknown): 'viewer' | 'editor' {
  return value === 'editor' ? 'editor' : 'viewer'
}

async function assertOwner(env: Env, request: Request, projectId: string) {
  const user = await requireAuth(env, request)
  const access = await assertCanEditProject(env, projectId, user.id)
  if (access.role !== 'owner') {
    const error = new Error('Owner permission required') as Error & { status?: number }
    error.status = 403
    throw error
  }
  return user
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  try {
    const projectId = String(params?.id || '')
    const user = await assertOwner(env, request, projectId)
    const member = await upsertProjectMember(env, {
      projectId,
      userId: String(params?.userId || ''),
      role: normalizeRole(body?.role),
      invitedByUserId: user.id,
    })
    return json({ member })
  } catch (error: any) {
    return json({ error: String(error?.message || 'Update member failed') }, error?.status || 502)
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const projectId = String(params?.id || '')
    await assertOwner(env, request, projectId)
    await removeProjectMember(env, projectId, String(params?.userId || ''))
    return json({ ok: true })
  } catch (error: any) {
    return json({ error: String(error?.message || 'Remove member failed') }, error?.status || 502)
  }
}
