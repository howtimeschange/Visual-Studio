import { Env, corsPreflight } from '../../../_shared'
import { getEventsSince, waitForEvents } from '../../../_lib/v2-events'

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

export const onRequestGet: PagesFunction<Env> = async ({ params, request }) => {
  const after = Number(new URL(request.url).searchParams.get('after') || '0')
  const jobId = String(params?.jobId || '')
  const events = await getEventsSince('job', jobId, after)
  if (events.length > 0) return toSseResponse(events)
  return toSseResponse(await waitForEvents('job', jobId, after))
}
