import type { Env } from '../_shared'
import { nowIso } from '../../packages/core/id'

type WaitUntil = (promise: Promise<unknown>) => void

export interface JobQueueMessage {
  kind: 'run_job'
  jobId: string
  jobType: string
  reason: 'submit' | 'retry' | 'recover'
  createdAt: string
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
  if (env.VS_QUEUE_EXECUTION_MODE === 'queue' && env.VS_JOBS_QUEUE?.send) {
    await env.VS_JOBS_QUEUE.send(message)
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
