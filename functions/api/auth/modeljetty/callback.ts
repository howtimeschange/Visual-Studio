import type { Env } from '../../../_shared'
import { clearModeljettyFlowCookie, finishModeljettyLogin } from '../../../_lib/modeljetty-auth'
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  try { return await finishModeljettyLogin(env, request) }
  catch (error: any) {
    // Log the failure type only; authorization codes and tokens must stay out of logs.
    console.error('ModelJetty callback failed', { name: error?.name, code: error?.code, status: error?.status })
    return new Response(JSON.stringify({ error: 'ModelJetty 授权未完成，请返回账号页重新登录。', status: error.status || 503 }), {
      status: error.status || 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': clearModeljettyFlowCookie(request), 'Referrer-Policy': 'no-referrer' },
    })
  }
}
