import type { Env } from '../_shared'
import type { CanvasProjectRecord, ProjectRole } from '../../packages/contracts/v2'
import { getAsset, getAssetDataUrl, getCanvasProject, getProjectRole, listCanvasProjectElements } from './v2-store'

export function canEditRole(role: ProjectRole | null): boolean {
  return role === 'owner' || role === 'editor'
}

export async function getProjectAccess(env: Env, projectId: string, userId?: string | null): Promise<{
  project: CanvasProjectRecord | null
  role: ProjectRole | null
}> {
  const project = await getCanvasProject(env, projectId)
  if (!project) return { project: null, role: null }
  if (!project.ownerUserId) return { project, role: null }
  const role = await getProjectRole(env, projectId, userId || null)
  return { project, role }
}

export async function assertCanReadProject(env: Env, projectId: string, userId?: string | null) {
  const access = await getProjectAccess(env, projectId, userId)
  if (!access.project) throw createPermissionError('Canvas project not found', 404)
  if (!userId || !access.role) throw createPermissionError('No access to this project', 403)
  return access
}

export async function assertCanReadAsset(env: Env, assetId: string, userId: string | null | undefined, projectId = '') {
  if (!userId) throw createPermissionError('Login required', 401)
  const asset = await getAsset(env, assetId)
  if (!asset) throw createPermissionError('Asset not found', 404)
  if (asset.userId === userId) return asset
  if (projectId) {
    const { project } = await assertCanReadProject(env, projectId, userId)
    // A project may share only assets belonging to its owner, using actual asset fields.
    const assetOwnerRole = asset.userId ? await getProjectRole(env, projectId, asset.userId) : null
    if (project.ownerUserId && (asset.userId === project.ownerUserId || canEditRole(assetOwnerRole))) {
      const elements = await listCanvasProjectElements(env, projectId)
      if (elements.some(record => collectAssetIds(record.dataJson).has(assetId))) return asset
    }
  }
  throw createPermissionError('No access to this asset', 403)
}

export function collectAssetIds(value: unknown, ids = new Set<string>(), depth = 0): Set<string> {
  if (depth > 24 || !value || typeof value !== 'object') return ids
  for (const [key, entry] of Object.entries(value)) {
    if (/^(?:assetId|[a-zA-Z]+AssetId)$/.test(key) && typeof entry === 'string' && entry) ids.add(entry)
    else if (/^(?:assetIds|[a-zA-Z]+AssetIds)$/.test(key) && Array.isArray(entry)) {
      for (const id of entry) if (typeof id === 'string' && id) ids.add(id)
    } else if (key !== 'clientKeys') collectAssetIds(entry, ids, depth + 1)
  }
  return ids
}

export async function assertInputAssetAccess(env: Env, body: any, userId: string) {
  const ids = collectAssetIds(body)
  if (ids.size > 1000) throw createPermissionError('Too many input assets', 400)
  const projectId = String(body?.projectId || '')
  for (const id of ids) await assertCanReadAsset(env, id, userId, projectId)
}

export async function getAuthorizedAssetDataUrl(env: Env, assetId: string, userId?: string | null, projectId = '') {
  // The optional context is for internal fixture/legacy runners only. Public routes always pass an authenticated owner.
  if (userId) await assertCanReadAsset(env, assetId, userId, projectId)
  return getAssetDataUrl(env, assetId)
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
