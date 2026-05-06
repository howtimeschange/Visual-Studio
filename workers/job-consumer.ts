import type { Env } from '../functions/_shared'
import { runQueuedJob } from '../functions/_lib/v2-runner'

type QueueMessageBody = {
  kind?: string
  jobId?: string
  clientKeys?: Record<string, string>
}

export default {
  async queue(batch: MessageBatch<QueueMessageBody>, env: Env) {
    for (const message of batch.messages) {
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
  },
}
