import type { Env } from '../_shared'
import { sealJson, unsealJson } from '../../packages/core/crypto'
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
]

const KEY_LABELS: Record<string, string> = {
  visionApiKey: 'Vision / Design Agent',
  banana2ApiKey: 'Nano Banana 2',
  bananaProApiKey: 'Nano Banana Pro',
  gptImageApiKey: 'GPT Image 2',
  gptImageGroup: 'GPT Image Group',
}

export function sanitizeClientKeys(value: unknown): ClientKeys {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const keys: ClientKeys = {}
  for (const field of KEY_FIELDS) {
    const text = String(input[field] || '').trim()
    if (text) keys[field] = text
  }
  return keys
}

function createKeySummary(keys: ClientKeys): Record<string, unknown> {
  const summary: Record<string, unknown> = {}
  for (const field of KEY_FIELDS) {
    const value = keys[field]
    if (!value) continue
    summary[field] = {
      label: KEY_LABELS[field] || field,
      saved: true,
      last4: value.slice(-4),
    }
  }
  return summary
}

export function toPublicKeyStatus(record: {
  summaryJson: Record<string, unknown>
  updatedAt: string
} | null) {
  return {
    keys: record?.summaryJson || {},
    updatedAt: record?.updatedAt || '',
  }
}

export async function loadUserClientKeys(env: Env, userId?: string | null): Promise<ClientKeys> {
  if (!userId) return {}
  const record = await getUserApiKeys(env, userId)
  if (!record?.ciphertext) return {}
  try {
    return sanitizeClientKeys(await unsealJson<Record<string, unknown>>(record.ciphertext, env.CREDENTIAL_KEK))
  } catch {
    return {}
  }
}

export async function mergeUserClientKeys(
  env: Env,
  userId: string | null | undefined,
  requestKeys: unknown,
): Promise<ClientKeys> {
  return {
    ...await loadUserClientKeys(env, userId),
    ...sanitizeClientKeys(requestKeys),
  }
}

export async function getUserApiKeyStatus(env: Env, userId: string) {
  return toPublicKeyStatus(await getUserApiKeys(env, userId))
}

export async function saveUserClientKeys(env: Env, userId: string, value: unknown) {
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
  const ciphertext = await sealJson(keys, env.CREDENTIAL_KEK)
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
