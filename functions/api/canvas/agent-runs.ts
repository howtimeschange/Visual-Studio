import { json, corsPreflight, resolveImageModelOptions, resolveKeys, type Env } from '../../_shared'
import { requireAuth } from '../../_lib/auth'
import { mergeUserClientKeys } from '../../_lib/user-api-keys'
import { submitCanvasAgentRun } from '../../_lib/canvas-agent-runner'
import { assertManagedImageModelAvailable } from '../../_lib/model-provider'

export const onRequestOptions: PagesFunction = async () => corsPreflight()
export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  try {
    const user = await requireAuth(env, request)
    const body: any = await request.json()
    const clientKeys = await mergeUserClientKeys(env, user.id, body.clientKeys || {})
    resolveImageModelOptions(String(body.modelId || 'nano-banana-2'), env, clientKeys)
    const keys = resolveKeys(String(body.modelId || 'nano-banana-2'), env, clientKeys)
    if (!keys.genKey || !keys.visionKey) return json({error:'请先连接模型服务或配置生图与 Agent 的 API Key'}, 400)
    await assertManagedImageModelAvailable(env, clientKeys, String(body.modelId || 'nano-banana-2'))
    return json(await submitCanvasAgentRun(env, { ...body, clientKeys }, user.id, waitUntil), 202)
  } catch (error: any) { return json({ error: error.message }, error.status || (error instanceof SyntaxError ? 400 : 502)) }
}
