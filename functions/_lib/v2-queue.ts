import type { Env } from '../_shared'
import { nowIso } from '../../packages/core/id'

type WaitUntil = (promise: Promise<unknown>) => void

function resolveQueue(env: Env, jobType: string): Queue<unknown> | null {
  if (jobType === 'translate_batch') return env.VS_TRANSLATE_JOBS_QUEUE || null
  if (jobType === 'outfit_batch') return env.VS_OUTFIT_JOBS_QUEUE || null
  return env.VS_JOBS_QUEUE || null
}

export interface JobQueueMessage {
  kind: 'run_job'
  jobId: string
  jobType: string
  reason: 'submit' | 'retry' | 'recover'
  createdAt: string
  clientKeys?: Record<string, string>
}

async function postLocalQueueMessage(endpoint: string, message: JobQueueMessage): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Local queue bridge failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`)
  }
}

export function createJobQueueMessage(input: Omit<JobQueueMessage, 'kind' | 'createdAt'>): JobQueueMessage {
  return {
    kind: 'run_job',
    createdAt: nowIso(),
    ...input,
  }
}

export async function dispatchQueuedJob(
  env: Env,
  waitUntil: WaitUntil | undefined,
  message: JobQueueMessage,
  fallback: () => Promise<unknown>,
): Promise<'queue' | 'local-bridge' | 'waitUntil' | 'inline'> {
  const mode = String(env.VS_QUEUE_EXECUTION_MODE || '').trim().toLowerCase()
  const localEndpoint = String(env.VS_LOCAL_QUEUE_ENDPOINT || '').trim()
  if (mode !== 'waituntil' && localEndpoint) {
    const task = postLocalQueueMessage(localEndpoint, message)
    if (waitUntil) {
      waitUntil(task)
    } else {
      await task
    }
    return 'local-bridge'
  }

  const queue = resolveQueue(env, message.jobType)
  if (mode !== 'waituntil' && queue?.send) {
    await queue.send(message)
    return 'queue'
  }

  const task = fallback()
  if (waitUntil) {
    waitUntil(task)
    return 'waitUntil'
  }

  void task
  return 'inline'
}
