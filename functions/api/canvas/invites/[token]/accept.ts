import { Env, json, corsPreflight } from '../../../../_shared'
import { requireAuth } from '../../../../_lib/auth'
import { getProjectInviteByToken, updateProjectInvite, upsertProjectMember } from '../../../../_lib/v2-store'

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const user = await requireAuth(env, request)
    const invite = await getProjectInviteByToken(env, String(params?.token || ''))
    if (!invite || invite.status !== 'pending') return json({ error: 'Invite not found or expired' }, 404)
    if (new Date(invite.expiresAt).getTime() <= Date.now()) return json({ error: 'Invite expired' }, 410)
    if (invite.email !== user.email) return json({ error: 'Invite email does not match current account' }, 403)

    const member = await upsertProjectMember(env, {
      projectId: invite.projectId,
      userId: user.id,
      role: invite.role,
      invitedByUserId: invite.invitedByUserId || null,
    })
    await updateProjectInvite(env, invite.id, {
      status: 'accepted',
      acceptedByUserId: user.id,
    })
    return json({ projectId: invite.projectId, member })
  } catch (error: any) {
    return json({ error: String(error?.message || 'Accept invite failed') }, error?.status || 502)
  }
}
