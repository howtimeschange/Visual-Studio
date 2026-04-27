import type { Env } from '../_shared'
import type { CanvasProjectRecord, ProjectRole } from '../../packages/contracts/v2'
import { getCanvasProject, getProjectRole } from './v2-store'

export function canEditRole(role: ProjectRole | null): boolean {
  return role === 'owner' || role === 'editor'
}

export async function getProjectAccess(env: Env, projectId: string, userId?: string | null): Promise<{
  project: CanvasProjectRecord | null
  role: ProjectRole | null
}> {
  const project = await getCanvasProject(env, projectId)
  if (!project) return { project: null, role: null }
  if (!project.ownerUserId) return { project, role: userId ? 'owner' : null }
  const role = await getProjectRole(env, projectId, userId || null)
  return { project, role }
}

export async function assertCanReadProject(env: Env, projectId: string, userId?: string | null) {
  const access = await getProjectAccess(env, projectId, userId)
  if (!access.project) throw createPermissionError('Canvas project not found', 404)
  if (access.project.ownerUserId && !access.role) throw createPermissionError('No access to this project', 403)
  return access
}

export async function assertCanEditProject(env: Env, projectId: string, userId?: string | null) {
  const access = await assertCanReadProject(env, projectId, userId)
  if (access.project?.ownerUserId && !canEditRole(access.role)) {
    throw createPermissionError('Editor permission required', 403)
  }
  return access
}

export function createPermissionError(message: string, status = 403) {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  return error
}
