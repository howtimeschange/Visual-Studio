// Queue handoffs are implementation details: an accepted provider task remains
// in progress even while its local item waits for the next query window.
export function getCanvasJobDisplayStatus(job = {}, item = null) {
  const local = item?.status || job.status || ''
  if (['completed', 'failed', 'cancelled'].includes(local)) return local
  const provider = String(item?.outputJson?.imageTaskStatus || job.summaryJson?.imageTaskStatus || '').toLowerCase()
  if (['running', 'processing', 'in_progress', 'succeeded', 'completed', 'success'].includes(provider)) return 'running'
  return local
}
