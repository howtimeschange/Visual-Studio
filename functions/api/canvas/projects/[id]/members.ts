import { Env, json, corsPreflight } from '../../../../_shared'
import { requireAuth } from '../../../../_lib/auth'
import { assertCanReadProject, assertCanEditProject } from '../../../../_lib/permissions'
import {
  createProjectInvite,
  getUser,
  getUserByEmail,
  listProjectInvites,
  listProjectMembers,
  upsertProjectMember,
} from '../../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

function normalizeRole(value: unknown): 'viewer' | 'editor' {
  return value === 'editor' ? 'editor' : 'viewer'
}

function randomToken() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function addDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const user = await requireAuth(env, request)
    const projectId = String(params?.id || '')
    const access = await assertCanReadProject(env, projectId, user.id)
    const members = await listProjectMembers(env, projectId)
    const invites = access.role === 'owner' ? await listProjectInvites(env, projectId) : []
    const owner = access.project?.ownerUserId ? await getUser(env, access.project.ownerUserId) : null
    return json({
      role: access.role,
      owner: owner ? { id: owner.id, email: owner.email, name: owner.name } : null,
      members,
      invites,
    })
  } catch (error: any) {
    return json({ error: String(error?.message || 'Load members failed') }, error?.status || 502)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  try {
    const user = await requireAuth(env, request)
    const projectId = String(params?.id || '')
    const access = await assertCanEditProject(env, projectId, user.id)
    if (access.role !== 'owner') return json({ error: 'Owner permission required' }, 403)

    const email = String(body?.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: '请输入有效邮箱' }, 400)
    const role = normalizeRole(body?.role)
    const targetUser = await getUserByEmail(env, email)
    if (targetUser?.id === user.id) return json({ error: '不能邀请自己' }, 400)

    if (targetUser) {
      const member = await upsertProjectMember(env, {
        projectId,
        userId: targetUser.id,
        role,
        invitedByUserId: user.id,
      })
      return json({
        status: 'added',
        member,
        user: { id: targetUser.id, email: targetUser.email, name: targetUser.name },
      })
    }

    const invite = await createProjectInvite(env, {
      projectId,
      email,
      role,
      token: randomToken(),
      invitedByUserId: user.id,
      expiresAt: addDays(14),
    })
    const url = new URL(request.url)
    return json({
      status: 'invited',
      invite,
      inviteUrl: `${url.origin}/lovart/projects?invite=${encodeURIComponent(invite.token)}`,
    })
  } catch (error: any) {
    return json({ error: String(error?.message || 'Invite member failed') }, error?.status || 502)
  }
}
