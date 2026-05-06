import type { Env } from '../_shared'
import type { UserRecord } from '../../packages/contracts/v2'
import { sha256Hex } from '../../packages/core/hash'
import {
  createAuthSession,
  createUser,
  deleteAuthSession,
  getAuthSessionByTokenHash,
  getUsageSummary,
  getUser,
  getUserByEmail,
  touchAuthSession,
} from './v2-store'

const AUTH_COOKIE = 'vs_auth'
const SESSION_DAYS = 14
const PASSWORD_ITERATIONS = 100_000

export type AuthContext = {
  user: PublicUser | null
  sessionId?: string | null
  usage?: Record<string, unknown>
}

export type PublicUser = {
  id: string
  email: string
  name: string
  createdAt: string
}

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  }
}

function parseCookie(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of String(header || '').split(';')) {
    const [rawKey, ...rest] = part.trim().split('=')
    if (!rawKey) continue
    out[rawKey] = decodeURIComponent(rest.join('=') || '')
  }
  return out
}

function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function addDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

function cookieHeader(token: string, expiresAt: string, secure = true): string {
  const secureAttr = secure ? '; Secure' : ''
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secureAttr}; Expires=${new Date(expiresAt).toUTCString()}`
}

export function clearAuthCookieHeader(secure = true): string {
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=0`
}

export function getBearerToken(request: Request): string {
  const cookies = parseCookie(request.headers.get('Cookie'))
  return cookies[AUTH_COOKIE] || ''
}

export async function hashPassword(password: string, salt = randomBase64Url(16)): Promise<{ hash: string; salt: string }> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(salt),
      iterations: PASSWORD_ITERATIONS,
    },
    key,
    256,
  )
  return {
    hash: Array.from(new Uint8Array(bits)).map((value) => value.toString(16).padStart(2, '0')).join(''),
    salt,
  }
}

export async function verifyPassword(password: string, user: UserRecord): Promise<boolean> {
  const computed = await hashPassword(password, user.passwordSalt)
  return computed.hash === user.passwordHash
}

export async function getAuthContext(env: Env, request: Request): Promise<AuthContext> {
  const token = getBearerToken(request)
  if (!token) return { user: null }
  const tokenHash = await sha256Hex(token)
  const session = await getAuthSessionByTokenHash(env, tokenHash)
  if (!session) return { user: null }
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await deleteAuthSession(env, tokenHash)
    return { user: null }
  }
  const user = await getUser(env, session.userId)
  if (!user) return { user: null }
  await touchAuthSession(env, session.id, { lastSeenAt: session.lastSeenAt })
  return { user: toPublicUser(user) }
}

export async function requireAuth(env: Env, request: Request): Promise<PublicUser> {
  const auth = await getAuthContext(env, request)
  if (!auth.user) {
    const error = new Error('Login required') as Error & { status?: number }
    error.status = 401
    throw error
  }
  return auth.user
}

export async function createLoginResponse(env: Env, user: UserRecord, request: Request): Promise<{ user: PublicUser; setCookie: string }> {
  const token = randomBase64Url(32)
  const tokenHash = await sha256Hex(token)
  const expiresAt = addDays(SESSION_DAYS)
  await createAuthSession(env, { userId: user.id, tokenHash, expiresAt })
  return {
    user: toPublicUser(user),
    setCookie: cookieHeader(token, expiresAt, new URL(request.url).protocol === 'https:'),
  }
}

export async function registerUser(env: Env, input: { email: string; password: string; name?: string }) {
  const email = input.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error('请输入有效邮箱') as Error & { status?: number }
    error.status = 400
    throw error
  }
  if (String(input.password || '').length < 8) {
    const error = new Error('密码至少需要 8 位') as Error & { status?: number }
    error.status = 400
    throw error
  }
  const existing = await getUserByEmail(env, email)
  if (existing) {
    const error = new Error('该邮箱已注册') as Error & { status?: number }
    error.status = 409
    throw error
  }
  const { hash, salt } = await hashPassword(input.password)
  return createUser(env, {
    email,
    name: input.name || email.split('@')[0],
    passwordHash: hash,
    passwordSalt: salt,
  })
}

export async function getAuthPayload(env: Env, request: Request) {
  const auth = await getAuthContext(env, request)
  const usage = auth.user
    ? await getUsageSummary(env, { userId: auth.user.id })
    : {}
  return { user: auth.user, usage }
}

export function jsonWithCookie(data: unknown, setCookie?: string, status = 200) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  if (setCookie) headers.set('Set-Cookie', setCookie)
  return new Response(JSON.stringify(data), { status, headers })
}
