import type { Env } from '../_shared'
import { json } from '../_shared'
import { requireAuth, type PublicUser } from './auth'

function parseList(value: unknown): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function isAdminUser(env: Env, user: PublicUser): boolean {
  const emails = [
    ...parseList(env.ADMIN_EMAILS),
    ...parseList(env.VS_ADMIN_EMAILS),
  ].map((email) => email.toLowerCase())
  const userIds = [
    ...parseList(env.ADMIN_USER_IDS),
    ...parseList(env.VS_ADMIN_USER_IDS),
  ]
  return emails.includes(user.email.toLowerCase()) || userIds.includes(user.id)
}

export async function requireAdmin(env: Env, request: Request): Promise<PublicUser> {
  const user = await requireAuth(env, request)
  if (!isAdminUser(env, user)) {
    const error = new Error('Admin access required') as Error & { status?: number }
    error.status = 403
    throw error
  }
  return user
}

export async function adminJson(
  env: Env,
  request: Request,
  handler: (admin: PublicUser) => Promise<unknown>,
) {
  try {
    const admin = await requireAdmin(env, request)
    return json(await handler(admin))
  } catch (error: any) {
    return json({ error: String(error?.message || 'Admin request failed') }, error?.status || 500)
  }
}
