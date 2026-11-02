import type { Env } from '../_shared'
import type { UserRecord } from '../../packages/contracts/v2'
import { sealJson, unsealJson } from '../../packages/core/crypto'
import { sha256Hex } from '../../packages/core/hash'
import { createId, nowIso } from '../../packages/core/id'
import { getAuthContext, createLoginResponse } from './auth'
import { claimIdentityRefresh, consumeOAuthFlow, finishIdentityRefresh, getExternalIdentity, getUser, putOAuthFlow, saveExternalIdentity } from './v2-store'

const FLOW_COOKIE = 'vs_modeljetty_flow'
const FLOW_PATH = '/api/auth/modeljetty'
type Flow = { verifier: string; nonce: string; returnTo: string; userId: string | null }
type Tokens = { accessToken: string; refreshToken: string; expiresAt: number }
const fault = (message: string, status = 503) => Object.assign(new Error(message), { status })

function flowSealSecret(env: Env): string {
  if (env.MODELJETTY_CREDENTIAL_KEK) return `visual-studio/modeljetty-flow/v1:${env.MODELJETTY_CREDENTIAL_KEK}`
  if (env.VS_JOB_CREDENTIAL_KEK) return `visual-studio/modeljetty-flow/v1:${env.VS_JOB_CREDENTIAL_KEK}`
  if (env.CREDENTIAL_KEK) return env.CREDENTIAL_KEK
  throw fault('ModelJetty 连接加密密钥未配置', 503)
}

// Pages and Queue share the dedicated managed-credential key. Existing shared
// job/account keys remain readable without rotating historical account secrets.
function tokenSealSecret(env: Env): string {
  if (env.MODELJETTY_CREDENTIAL_KEK) return `visual-studio/modeljetty-token/v1:${env.MODELJETTY_CREDENTIAL_KEK}`
  if (env.VS_JOB_CREDENTIAL_KEK) return `visual-studio/modeljetty-token/v1:${env.VS_JOB_CREDENTIAL_KEK}`
  if (env.CREDENTIAL_KEK) return env.CREDENTIAL_KEK
  throw fault('ModelJetty 连接加密密钥未配置', 503)
}

async function readTokens(env: Env, ciphertext: string): Promise<Tokens> {
  const secrets = [...new Set([tokenSealSecret(env), env.VS_JOB_CREDENTIAL_KEK && `visual-studio/modeljetty-token/v1:${env.VS_JOB_CREDENTIAL_KEK}`, env.CREDENTIAL_KEK].filter(Boolean))]
  for (const secret of secrets) {
    try { return await unsealJson<Tokens>(ciphertext, secret) } catch { /* Legacy Pages-encrypted connection. */ }
  }
  throw fault('ModelJetty 连接密钥不匹配，请重新授权', 401)
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function randomToken() { return base64url(crypto.getRandomValues(new Uint8Array(32))) }
function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
}

export function modeljettyConfig(env: Env) {
  const origin = new URL(env.MODELJETTY_ORIGIN || 'https://modeljetty.com')
  const localHttp = env.MODELJETTY_ALLOW_LOCAL_HTTP === 'true' && origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname)
  if ((!localHttp && origin.protocol !== 'https:') || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw fault('Invalid ModelJetty origin')
  return { origin: origin.origin, issuer: `${origin.origin}/oidc`, clientId: env.MODELJETTY_CLIENT_ID || '', redirectUri: env.MODELJETTY_REDIRECT_URI || '' }
}

export function safeReturnTo(value: unknown): string {
  const input = String(value || '')
  if (!input.startsWith('/') || input.startsWith('//') || /[\\\r\n]/.test(input)) return '/lovart'
  const url = new URL(input, 'https://visual-studio.invalid')
  if (url.origin !== 'https://visual-studio.invalid' || url.pathname.startsWith('/api/')) return '/lovart'
  return `${url.pathname}${url.search}${url.hash}`
}

function flowCookie(value: string, request: Request, maxAge = 600) {
  return `${FLOW_COOKIE}=${value}; Path=${FLOW_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`
}
export function clearModeljettyFlowCookie(request: Request) { return flowCookie('', request, 0) }

async function requestJson(url: string, init: RequestInit = {}) {
  // Workers supports manual redirects; never follow an authenticated redirect.
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw fault(`ModelJetty 请求失败（${response.status}），请重新授权`, response.status === 401 ? 401 : 503)
  return response.json() as Promise<any>
}

function tokenRequest(env: Env, params: URLSearchParams) {
  const config = modeljettyConfig(env)
  params.set('client_id', config.clientId)
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (env.MODELJETTY_CLIENT_SECRET) {
    headers.Authorization = `Basic ${btoa(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(env.MODELJETTY_CLIENT_SECRET)}`)}`
  }
  // Authorization codes and rotating refresh tokens are single-use: no retries.
  return requestJson(`${config.issuer}/token`, { method: 'POST', headers, body: params.toString() })
}

function parseTokens(data: any): Tokens {
  const seconds = Number(data?.expires_in)
  const scope = String(data?.scope || '').split(' ')
  if (!data?.access_token || String(data.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(seconds) || seconds <= 0 || (data.scope && !scope.includes('models:invoke'))) throw fault('ModelJetty 未授予有效的模型调用权限', 403)
  return { accessToken: String(data.access_token), refreshToken: String(data.refresh_token || ''), expiresAt: Date.now() + Math.min(seconds, 86400) * 1000 }
}

export async function verifyModeljettyIdToken(env: Env, raw: string, nonce: string, accessToken: string) {
  const config = modeljettyConfig(env)
  const parts = String(raw || '').split('.')
  if (parts.length !== 3) throw fault('ModelJetty ID token missing', 401)
  const header = JSON.parse(new TextDecoder().decode(decode(parts[0])))
  const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])))
  if (header.alg !== 'RS256' || !header.kid) throw fault('Invalid ModelJetty signing algorithm', 401)
  const jwks = await requestJson(`${config.issuer}/jwks`)
  const jwk = jwks.keys?.find((key: any) => key.kid === header.kid && key.kty === 'RSA' && (!key.use || key.use === 'sig'))
  if (!jwk) throw fault('ModelJetty signing key unavailable', 401)
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  const now = Date.now() / 1000
  if (!valid || claims.iss !== config.issuer || !aud.includes(config.clientId) || (aud.length > 1 && claims.azp !== config.clientId)
    || (claims.azp && claims.azp !== config.clientId) || !Number.isFinite(claims.exp) || claims.exp <= now
    || !Number.isFinite(claims.iat) || claims.iat > now + 60 || (claims.nbf && claims.nbf > now + 60)
    || claims.nonce !== nonce || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw fault('Invalid ModelJetty identity claims', 401)
  if (claims.at_hash) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken)))
    if (claims.at_hash !== base64url(digest.slice(0, 16))) throw fault('ModelJetty access token mismatch', 401)
  }
  return claims
}

export async function startModeljettyLogin(env: Env, request: Request) {
  const config = modeljettyConfig(env)
  if (!config.clientId || !config.redirectUri || !(env.MODELJETTY_CREDENTIAL_KEK || env.CREDENTIAL_KEK || env.VS_JOB_CREDENTIAL_KEK)) throw fault('ModelJetty 联合登录尚未配置')
  if (!env.VS_DB && new URL(request.url).protocol === 'https:') throw fault('ModelJetty 联合登录需要 D1 持久化')
  const callback = new URL(config.redirectUri)
  const requestUrl = new URL(request.url)
  if (callback.origin !== requestUrl.origin || callback.pathname !== `${FLOW_PATH}/callback` || callback.search || callback.hash) throw fault('ModelJetty callback configuration mismatch')
  const auth = await getAuthContext(env, request)
  const state = randomToken()
  const flow: Flow = { verifier: randomToken(), nonce: randomToken(), userId: auth.user?.id || null, returnTo: safeReturnTo(requestUrl.searchParams.get('returnTo')) }
  await putOAuthFlow(env, await sha256Hex(state), await sealJson(flow, flowSealSecret(env)), Date.now() + 600_000)
  const url = new URL(`${config.issuer}/auth`)
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'openid offline_access models:invoke', prompt: 'consent',
    state, nonce: flow.nonce, code_challenge_method: 'S256', code_challenge: base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(flow.verifier)))) }).toString()
  return new Response(null, { status: 302, headers: { Location: url.href, 'Set-Cookie': flowCookie(state, request), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}

export async function finishModeljettyLogin(env: Env, request: Request) {
  const config = modeljettyConfig(env)
  if (!config.clientId || !config.redirectUri || !(env.MODELJETTY_CREDENTIAL_KEK || env.CREDENTIAL_KEK || env.VS_JOB_CREDENTIAL_KEK)) throw fault('ModelJetty 联合登录尚未配置')
  const url = new URL(request.url)
  const state = url.searchParams.get('state') || ''
  const cookie = /(?:^|;\s*)vs_modeljetty_flow=([A-Za-z0-9_-]+)/.exec(request.headers.get('Cookie') || '')?.[1]
  if (!state || state !== cookie) throw fault('ModelJetty state mismatch，请重新登录', 400)
  const encrypted = await consumeOAuthFlow(env, await sha256Hex(state))
  if (!encrypted) throw fault('ModelJetty 授权已过期或已使用', 400)
  const flowSecrets = [...new Set([flowSealSecret(env), env.VS_JOB_CREDENTIAL_KEK && `visual-studio/modeljetty-flow/v1:${env.VS_JOB_CREDENTIAL_KEK}`, env.CREDENTIAL_KEK].filter(Boolean))]
  let flow: Flow | undefined
  for (const secret of flowSecrets) {
    try { flow = await unsealJson<Flow>(encrypted, secret); break } catch { /* Flow started before deployment. */ }
  }
  if (!flow) throw fault('ModelJetty 登录状态已失效，请重新登录', 401)
  const auth = await getAuthContext(env, request)
  if ((auth.user?.id || null) !== flow.userId) throw fault('授权期间账号发生变化，请重新登录', 409)
  if (url.searchParams.get('error') || !url.searchParams.get('code') || (url.searchParams.has('iss') && url.searchParams.get('iss') !== config.issuer)) throw fault('ModelJetty 授权未完成', 400)
  const data = await tokenRequest(env, new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code')!, redirect_uri: config.redirectUri, code_verifier: flow.verifier }))
  const tokens = parseTokens(data)
  if (!tokens.refreshToken) throw fault('ModelJetty 未授予持续使用权限，请重新授权 offline_access', 403)
  const claims = await verifyModeljettyIdToken(env, data.id_token, flow.nonce, tokens.accessToken)
  const profile = await requestJson(`${config.origin}/account/me`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } })
  if (String(profile?.user?.id || '') !== claims.sub) throw fault('ModelJetty account identity mismatch', 401)
  const identity = await getExternalIdentity(env, config.issuer, { subject: claims.sub })
  if (flow.userId && identity && identity.userId !== flow.userId) throw fault('此 ModelJetty 账号已关联其他账号', 409)
  let user = await getUser(env, flow.userId || identity?.userId || '')
  let newUser: UserRecord | undefined
  if (!user) {
    const now = nowIso()
    // Synthetic address is only a local unique identifier; never grants email/admin privileges.
    newUser = { id: createId('user'), email: `${await sha256Hex(`${config.issuer}|${claims.sub}`)}@modeljetty.invalid`, name: String(profile.user.name || 'ModelJetty 用户').slice(0, 100), passwordHash: '', passwordSalt: '', createdAt: now, updatedAt: now }
    user = newUser
  }
  await saveExternalIdentity(env, { issuer: config.issuer, subject: claims.sub, userId: user.id, ciphertext: await sealJson(tokens, tokenSealSecret(env)), expiresAt: tokens.expiresAt }, newUser)
  const login = await createLoginResponse(env, user, request)
  const headers = new Headers({ Location: safeReturnTo(flow.returnTo), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  headers.append('Set-Cookie', login.setCookie)
  headers.append('Set-Cookie', clearModeljettyFlowCookie(request))
  return new Response(null, { status: 303, headers })
}

export async function loadModeljettyTokens(env: Env, userId: string): Promise<Tokens | null> {
  const config = modeljettyConfig(env)
  let record = await getExternalIdentity(env, config.issuer, { userId })
  if (!record) return null
  if (record.expiresAt === -1 && !record.ciphertext) return null
  if (!record.ciphertext) throw fault('ModelJetty 连接已失效，请重新授权', 401)
  let tokens = await readTokens(env, record.ciphertext)
  if (tokens.expiresAt > Date.now() + 60_000) return tokens
  if (!tokens.refreshToken) throw fault('ModelJetty 登录已过期，请重新授权', 401)
  if (!await claimIdentityRefresh(env, record)) {
    // Read once: another request may already have completed the rotation.
    record = await getExternalIdentity(env, config.issuer, { userId })
    if (record?.ciphertext) {
      tokens = await readTokens(env, record.ciphertext)
      if (tokens.expiresAt > Date.now() + 60_000) return tokens
    }
    throw Object.assign(fault('ModelJetty 连接正在刷新，请稍后再试', 409), { code: 'MODELJETTY_REFRESH_BUSY' })
  }
  try {
    const data = await tokenRequest(env, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }))
    const next = parseTokens(data)
    if (!next.refreshToken) throw fault('ModelJetty 未返回轮换令牌，请重新授权', 401)
    if (!await finishIdentityRefresh(env, record, await sealJson(next, tokenSealSecret(env)), next.expiresAt)) throw fault('ModelJetty 账号连接已变化，请重试', 409)
    return next
  } catch (error) {
    // Unknown rotation outcomes must not replay a possibly consumed refresh token.
    await finishIdentityRefresh(env, record, '', 0)
    throw error
  }
}

export async function getModeljettyConnection(env: Env, userId: string) {
  const tokens = await loadModeljettyTokens(env, userId)
  if (!tokens) return { connected: false }
  const { origin } = modeljettyConfig(env)
  const headers = { Authorization: `Bearer ${tokens.accessToken}` }
  const [profile, allowance] = await Promise.all([
    requestJson(`${origin}/account/me`, { headers }),
    requestJson(`${origin}/account/allowance`, { headers }),
  ])
  if (allowance.currency !== 'CNY' || typeof allowance.available !== 'number' || !Number.isFinite(allowance.available) || allowance.available < 0) throw fault('ModelJetty 算力余额暂不可用')
  return { connected: true, user: { id: profile.user?.id, name: profile.user?.name }, balance: allowance.available, currency: allowance.currency,
    asOf: nowIso(), billingAuthority: 'modeljetty', imageTasksEnabled: env.MODELJETTY_IMAGE_TASKS_ENABLED === 'true' }
}

export async function disconnectModeljetty(env: Env, userId: string) {
  const config = modeljettyConfig(env)
  const record = await getExternalIdentity(env, config.issuer, { userId })
  if (!record || record.expiresAt === -1) return { connected: false, revoked: true }
  if (!record.ciphertext) throw fault('连接状态待确认，请重新授权后断开', 409)
  const tokens = await readTokens(env, record.ciphertext)
  if (tokens.expiresAt > Date.now()) {
    const data = await requestJson(`${config.origin}/account/authorization`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokens.accessToken}` } })
    if (data.revoked !== true || data.scope !== 'current_client' || data.client_id !== config.clientId) throw fault('服务商未确认撤销当前应用授权', 502)
  } else {
    if (!tokens.refreshToken) throw fault('缺少可撤销的授权，请在 ModelJetty 账号中解除连接', 409)
    const params = new URLSearchParams({ client_id: config.clientId, token: tokens.refreshToken, token_type_hint: 'refresh_token' })
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
    if (env.MODELJETTY_CLIENT_SECRET) headers.Authorization = `Basic ${btoa(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(env.MODELJETTY_CLIENT_SECRET)}`)}`
    const discovery = await requestJson(`${config.issuer}/.well-known/openid-configuration`)
    const endpoint = new URL(discovery.revocation_endpoint)
    if (discovery.issuer !== config.issuer || endpoint.origin !== config.origin || !endpoint.pathname.startsWith('/oidc/') || endpoint.username || endpoint.password) throw fault('ModelJetty 撤销端点不可信', 503)
    const response = await fetch(endpoint.href, { method: 'POST', headers, body: params.toString(), redirect: 'manual', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw fault('服务商未确认撤销授权，请稍后回查', 503)
  }
  // Keep the identity-to-user mapping so reconnecting cannot create an orphan
  // user. CAS protects a newer login/rotation from an older disconnect request.
  if (!await finishIdentityRefresh(env, record, '', -1)) throw fault('连接刚刚发生变化，请刷新后确认', 409)
  return { connected: false, revoked: true, scope: 'current_client' }
}
