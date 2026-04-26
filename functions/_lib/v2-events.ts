import type { RuntimeEvent } from '../../packages/contracts/v2'
import { nowIso } from '../../packages/core/id'
import { appendEvent, listEvents } from './v2-store'

type Waiter = {
  afterSeq: number
  resolve: (events: RuntimeEvent[]) => void
  timeout: ReturnType<typeof setTimeout>
}

const waiters = new Map<string, Set<Waiter>>()
const seqCounters = new Map<string, number>()

function scopeKey(scope: string, scopeId: string): string {
  return `${scope}:${scopeId}`
}

export async function publishEvent(
  scope: RuntimeEvent['scope'],
  scopeId: string,
  type: RuntimeEvent['type'],
  payload: Record<string, unknown>,
): Promise<RuntimeEvent> {
  const key = scopeKey(scope, scopeId)
  const seq = (seqCounters.get(key) || 0) + 1
  seqCounters.set(key, seq)

  const event: RuntimeEvent = {
    scope,
    scopeId,
    type,
    seq,
    timestamp: nowIso(),
    payload,
  }
  await appendEvent(event)

  const watchers = waiters.get(key)
  if (watchers?.size) {
    const snapshot = [...watchers]
    waiters.delete(key)
    snapshot.forEach((watcher) => {
      clearTimeout(watcher.timeout)
      watcher.resolve([event].filter((entry) => entry.seq > watcher.afterSeq))
    })
  }

  return event
}

export async function getEventsSince(scope: string, scopeId: string, afterSeq = 0): Promise<RuntimeEvent[]> {
  return listEvents(scope, scopeId, afterSeq)
}

export async function waitForEvents(
  scope: string,
  scopeId: string,
  afterSeq = 0,
  timeoutMs = 25000,
): Promise<RuntimeEvent[]> {
  const current = await listEvents(scope, scopeId, afterSeq)
  if (current.length > 0) return current

  const key = scopeKey(scope, scopeId)
  return new Promise((resolve) => {
    const set = waiters.get(key) || new Set<Waiter>()
    const waiter: Waiter = {
      afterSeq,
      resolve,
      timeout: setTimeout(() => {
        set.delete(waiter)
        if (set.size === 0) waiters.delete(key)
        resolve([])
      }, timeoutMs),
    }
    set.add(waiter)
    waiters.set(key, set)
  })
}
