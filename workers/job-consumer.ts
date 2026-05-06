import type { Env } from '../functions/_shared'
import { runQueuedJob } from '../functions/_lib/v2-runner'

type QueueMessageBody = {
  kind?: string
  jobId?: string
  clientKeys?: Record<string, string>
}

type QueueMessageLike = {
  body?: QueueMessageBody
  ack: () => void
  retry: () => void
}

function isLocalBridgeEnabled(env: Env): boolean {
  return ['1', 'true', 'yes', 'local'].includes(String(env.VS_LOCAL_QUEUE_BRIDGE || '').trim().toLowerCase())
}

async function processQueueMessages(messages: QueueMessageLike[], env: Env) {
  for (const message of messages) {
    const body = message.body || {}
    if (body.kind !== 'run_job' || !body.jobId) {
      message.ack()
      continue
    }

    try {
      await runQueuedJob(env, String(body.jobId), body.clientKeys || {})
      message.ack()
    } catch (error) {
      console.error('visual-studio queue job failed', body.jobId, error)
      message.retry()
    }
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default {
  async queue(batch: MessageBatch<QueueMessageBody>, env: Env) {
    await processQueueMessages(batch.messages, env)
  },

  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    if (url.pathname === '/__queue/health') {
      return json({ ok: true, bridgeEnabled: isLocalBridgeEnabled(env) })
    }
    if (!isLocalBridgeEnabled(env) || url.pathname !== '/__queue/run') {
      return json({ error: 'Local queue bridge is disabled' }, 404)
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405)
    }

    let payload: QueueMessageBody | { messages?: QueueMessageBody[] }
    try {
      payload = await request.json()
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }

    const bodies = Array.isArray((payload as { messages?: QueueMessageBody[] }).messages)
      ? (payload as { messages: QueueMessageBody[] }).messages
      : [payload as QueueMessageBody]
    let acked = 0
    let retried = 0
    const messages = bodies.map((body) => ({
      body,
      ack: () => {
        acked += 1
      },
      retry: () => {
        retried += 1
      },
    }))

    await processQueueMessages(messages, env)
    if (retried > 0) {
      return json({ ok: false, acked, retried }, 502)
    }
    return json({ ok: true, acked, retried })
  },
}
