import type { Env } from '../_shared'

export type ModelProvider = '1xm' | 'modeljetty'

export function resolveProvider(env: Env, keys: any = {}): ModelProvider {
  const value = keys.provider || env.VS_MODEL_PROVIDER || '1xm'
  if (value !== '1xm' && value !== 'modeljetty') throw Object.assign(new Error('Unknown model provider'), { status: 400 })
  return value
}

export function resolveRelayBaseUrl(env: Env, keys: any = {}): string {
  const value = resolveProvider(env, keys) === 'modeljetty'
    ? keys.modeljettyManaged === 'true'
      ? `${env.MODELJETTY_ORIGIN || 'https://modeljetty.com'}/account/inference/v1`
      : env.MODELJETTY_BASE_URL || 'https://modeljetty.com/v1'
    : env.RELAY_BASE_URL || 'https://api.1xm.ai/v1'
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) {
    throw Object.assign(new Error('Invalid model service URL'), { status: 503 })
  }
  return url.href.replace(/\/+$/, '')
}

export function resolveVisionModel(env: Env, keys: any = {}): string {
  return resolveProvider(env, keys) === 'modeljetty'
    ? env.MODELJETTY_VISION_MODEL || 'gemini-3.8-flash-medium'
    : 'gemini-3-flash-preview'
}

export function resolveAgentModel(env: Env, keys: any = {}): string {
  const provider = resolveProvider(env, keys)
  const selected = provider === 'modeljetty' ? keys.modeljettyAgentModel : keys.oneXmAgentModel
  if (typeof selected === 'string' && /^[\w][\w.\/:\-]{0,159}$/.test(selected)) return selected
  return provider === 'modeljetty'
    ? env.MODELJETTY_AGENT_MODEL || env.MODELJETTY_VISION_MODEL || 'gemini-3.8-flash-medium'
    : 'gemini-3-flash-preview'
}

export function resolveProviderImageOptions(modelId: string, env: Env, keys: any = {}) {
  const provider = resolveProvider(env, keys)
  if (provider === '1xm') return { provider }
  let models: Record<string, string> = Object.fromEntries(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gemini-3.1-flash-image'].map(id => [id, id]))
  try { models = { ...models, ...JSON.parse(env.MODELJETTY_IMAGE_MODEL_MAP || '{}') } } catch { models = {} }
  return {
    provider,
    // Enable only after the gateway exposes the same durable create/query contract.
    asyncEnabled: env.MODELJETTY_IMAGE_TASKS_ENABLED === 'true',
    modelName: typeof models?.[modelId] === 'string' ? models[modelId].trim() : '',
  }
}

export async function assertManagedImageModelAvailable(env: Env, keys: any, modelId: string) {
  if (resolveProvider(env, keys) !== 'modeljetty' || keys.modeljettyManaged !== 'true') return
  const modelName = resolveProviderImageOptions(modelId, env, keys).modelName
  const origin = new URL(resolveRelayBaseUrl(env, keys)).origin
  const response = await fetch(`${origin}/account/model-catalog`, { headers: { Authorization: `Bearer ${keys.modeljettyApiKey}` }, redirect: 'manual', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw Object.assign(new Error('暂时无法确认生图模型权限，请刷新目录后重试。'), { status: 503 })
  const data: any = await response.json()
  const model = Array.isArray(data?.models) ? data.models.find((m: any) => m?.id === modelName) : null
  if (!model || model.available === false) throw Object.assign(new Error('当前 ModelJetty 账号未开通所选生图模型，请选择列表中的可用模型。'), { status: 403 })
}
