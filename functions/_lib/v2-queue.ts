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
): Promise<'queue' | 'waitUntil' | 'inline'> {
  const mode = String(env.VS_QUEUE_EXECUTION_MODE || '').trim().toLowerCase()
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
