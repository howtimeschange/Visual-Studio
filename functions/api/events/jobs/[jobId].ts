import { Env, corsPreflight } from '../../../_shared'
import { getAuthContext } from '../../../_lib/auth'
import { getEventsSince, waitForEvents } from '../../../_lib/v2-events'
import { getJob } from '../../../_lib/v2-store'

function toSseResponse(events: any[]) {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') || ': keep-alive\n\n'
  return new Response(text, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

export const onRequestOptions: PagesFunction = async () => corsPreflight()

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request }) => {
  const after = Number(new URL(request.url).searchParams.get('after') || '0')
  const jobId = String(params?.jobId || '')
  const job = await getJob(env, jobId)
  if (!job) return new Response('Job not found', { status: 404 })
  const auth = await getAuthContext(env, request)
  if (job.userId && job.userId !== auth.user?.id) return new Response('No access to this job', { status: 403 })
  const events = await getEventsSince(env, 'job', jobId, after)
  if (events.length > 0) return toSseResponse(events)
  return toSseResponse(await waitForEvents(env, 'job', jobId, after))
}
