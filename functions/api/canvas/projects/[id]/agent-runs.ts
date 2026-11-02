import { json, type Env } from '../../../../_shared'
import { requireAuth } from '../../../../_lib/auth'
import { assertCanReadProject } from '../../../../_lib/permissions'
import { listCanvasAgentJobs } from '../../../../_lib/v2-store'
import { publicCanvasAgentJob } from '../../../../_lib/canvas-agent-runner'

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const user = await requireAuth(env, request)
    const id = String(params.id)
    await assertCanReadProject(env, id, user.id)
    const response = json({ runs: (await listCanvasAgentJobs(env, id)).map(publicCanvasAgentJob) })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error: any) { return json({ error: error.message }, error.status || 502) }
}
