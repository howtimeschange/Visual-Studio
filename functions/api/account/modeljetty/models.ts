import { Env, json } from '../../../_shared'
import { requireAuth } from '../../../_lib/auth'
import { loadLinkedModeljettyClientKeys } from '../../../_lib/user-api-keys'
import { modeljettyConfig } from '../../../_lib/modeljetty-auth'

const clean = (value: unknown, max = 160) => typeof value === 'string' ? value.slice(0, max) : ''
export function normalizeModelCatalog(value: any) {
  const models = (Array.isArray(value?.models) ? value.models : []).filter((model: any) => model && /^[\w][\w.\/:\-]{0,159}$/.test(model.id)).map((model: any) => ({
    id: model.id, name: clean(model.name) || model.id,
    vendor: clean(model.vendor || model.manufacturer || model.provider, 60) || (/^gpt-/.test(model.id) ? 'OpenAI' : /^gemini-/.test(model.id) ? 'Google' : /^deepseek-/.test(model.id) ? 'DeepSeek' : '其他'),
    kind: model.kind === 'image' ? 'image' : 'text', protocol: clean(model.protocol, 40),
    available: typeof model.available === 'boolean' ? model.available : null,
    unavailableReason: clean(model.unavailableReason, 240),
    capabilities: { textInput: model.capabilities?.textInput !== false && model.kind !== 'image', imageInput: model.capabilities?.imageInput === true },
  })).slice(0, 1000)
  return { version: clean(String(value?.version || '')), models }
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  try {
    const user = await requireAuth(env, request)
    const keys = await loadLinkedModeljettyClientKeys(env, user.id)
    if (!keys.modeljettyApiKey) return json({ error: '请关联 ModelJetty 账号后读取完整模型目录。' }, 400)
    const response = await fetch(`${modeljettyConfig(env).origin}/account/model-catalog`, { headers: { Authorization: `Bearer ${keys.modeljettyApiKey}` }, redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return json({ error: `ModelJetty 模型目录暂不可用（${response.status}），请刷新重试。` }, 503)
    const catalog = normalizeModelCatalog(await response.json())
    if (!catalog.models.length) return json({ error: 'ModelJetty 返回了空模型目录，请刷新重试。' }, 502)
    const result = json({ ...catalog, fetchedAt: new Date().toISOString() })
    result.headers.set('Cache-Control', 'no-store')
    return result
  } catch (error: any) { return json({ error: error.message || '读取模型目录失败' }, error.status || 503) }
}
