import type { Env } from '../_shared'
import { sealJson, unsealJson } from '../../packages/core/crypto'
import { loadModeljettyTokens, modeljettyConfig } from './modeljetty-auth'
import { getExternalIdentity } from './v2-store'
import {
  deleteUserApiKeys,
  getUserApiKeys,
  upsertUserApiKeys,
} from './v2-store'

type ClientKeys = Record<string, string>

const KEY_FIELDS = [
  'visionApiKey',
  'banana2ApiKey',
  'bananaProApiKey',
  'gptImageApiKey',
  'gptImageGroup',
  'provider',
  'modeljettyApiKey',
  'modeljettyAgentModel',
  'oneXmAgentModel',
]
const PREFERENCE_FIELDS = new Set(['provider', 'modeljettyAgentModel', 'oneXmAgentModel'])

const KEY_LABELS: Record<string, string> = {
  visionApiKey: 'Vision / Design Agent',
  banana2ApiKey: 'Nano Banana 2',
  bananaProApiKey: 'Nano Banana Pro',
  gptImageApiKey: 'GPT Image 2',
  gptImageGroup: 'GPT Image Group',
  modeljettyApiKey: 'ModelJetty',
}

export function sanitizeClientKeys(value: unknown): ClientKeys {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const keys: ClientKeys = {}
  for (const field of KEY_FIELDS) {
    const text = String(input[field] || '').trim()
    if (field === 'provider' && !['1xm', 'modeljetty'].includes(text)) continue
    if (field.endsWith('AgentModel') && !/^[\w][\w.\/:\-]{0,159}$/.test(text)) continue
    if (text) keys[field] = text
  }
  return keys
}

function createKeySummary(keys: ClientKeys): Record<string, unknown> {
  const summary: Record<string, unknown> = {}
  for (const field of KEY_FIELDS) {
    if (PREFERENCE_FIELDS.has(field)) continue
    const value = keys[field]
    if (!value) continue
    summary[field] = {
      label: KEY_LABELS[field] || field,
      saved: true,
      last4: value.slice(-4),
    }
  }
  summary.preferences = Object.fromEntries(Object.entries(keys).filter(([key]) => PREFERENCE_FIELDS.has(key)))
  return summary
}

export function toPublicKeyStatus(record: {
  summaryJson: Record<string, unknown>
  updatedAt: string
} | null) {
  const { preferences, ...keys } = record?.summaryJson || {}
  return {
    keys,
    ...(preferences && typeof preferences === 'object' ? { preferences } : {}),
    updatedAt: record?.updatedAt || '',
  }
}

export async function loadUserClientKeys(env: Env, userId?: string | null): Promise<ClientKeys> {
  if (!userId) return {}
  const record = await getUserApiKeys(env, userId)
  if (!record?.ciphertext) return {}
  const secrets = [...new Set([accountCredentialSecret(env), env.CREDENTIAL_KEK])]
  for (const secret of secrets) {
    try { return sanitizeClientKeys(await unsealJson<Record<string, unknown>>(record.ciphertext, secret)) }
    catch { /* Read historical account encryption without rewriting the record. */ }
  }
  return {}
}

function accountCredentialSecret(env: Env): string | undefined {
  return env.MODELJETTY_CREDENTIAL_KEK
    ? `visual-studio/account-keys/v1:${env.MODELJETTY_CREDENTIAL_KEK}`
    : env.CREDENTIAL_KEK
}

export async function mergeUserClientKeys(
  env: Env,
  userId: string | null | undefined,
  requestKeys: unknown,
): Promise<ClientKeys> {
  const keys = {
    ...await loadUserClientKeys(env, userId),
    ...sanitizeClientKeys(requestKeys),
  }
  const requested = sanitizeClientKeys(requestKeys)
  if (!keys.provider && userId) {
    const identity = await getExternalIdentity(env, modeljettyConfig(env).issuer, { userId })
    if (identity && identity.expiresAt !== -1) keys.provider = 'modeljetty'
  }
  if (keys.provider === 'modeljetty' && userId && !keys.modeljettyApiKey) {
    return { ...keys, ...await loadLinkedModeljettyClientKeys(env, userId) }
  }
  // Selecting a provider never reuses another provider's credentials.
  if (requested.provider) keys.provider = requested.provider
  return keys
}

export async function loadLinkedModeljettyClientKeys(env: Env, userId: string): Promise<ClientKeys> {
  const tokens = await loadModeljettyTokens(env, userId)
  if (!tokens) return {}
  return { provider: 'modeljetty', modeljettyManaged: 'true', modeljettyApiKey: tokens.accessToken }
}

export async function getUserApiKeyStatus(env: Env, userId: string) {
  return toPublicKeyStatus(await getUserApiKeys(env, userId))
}

export async function saveUserClientKeys(env: Env, userId: string, value: unknown) {
  const secret = accountCredentialSecret(env)
  if (env.VS_DB && !secret) throw Object.assign(new Error('CREDENTIAL_KEK or MODELJETTY_CREDENTIAL_KEK is required for persistent API keys'), { status: 503 })
  const incomingKeys = sanitizeClientKeys(value)
  if (Object.keys(incomingKeys).length === 0) {
    const error = new Error('At least one API key is required') as Error & { status?: number }
    error.status = 400
    throw error
  }
  const keys = {
    ...await loadUserClientKeys(env, userId),
    ...incomingKeys,
  }
  const ciphertext = await sealJson(keys, secret)
  const record = await upsertUserApiKeys(env, {
    userId,
    ciphertext,
    summaryJson: createKeySummary(keys),
  })
  return toPublicKeyStatus(record)
}

export async function clearUserClientKeys(env: Env, userId: string) {
  await deleteUserApiKeys(env, userId)
  return toPublicKeyStatus(null)
}
