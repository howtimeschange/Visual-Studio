// Short-lived, account-scoped read cache. Never use stale data after a failed
// refresh, and never let an obsolete request repopulate an invalidated cache.
export function createProjectSnapshotCache({ ttl = 10000, limit = 6, now = Date.now } = {}) {
  let owner = ''
  const entries = new Map(), pending = new Map()
  function scope(next) {
    if (owner === next) return
    owner = next; entries.clear(); pending.clear()
  }
  function put(id, value) {
    entries.delete(id)
    entries.set(id, { value: structuredClone(value), expires: now() + ttl })
    while (entries.size > limit) entries.delete(entries.keys().next().value)
  }
  return {
    scope,
    invalidate(id) { entries.delete(id); pending.delete(id) },
    put(id, value, nextOwner) { scope(nextOwner); pending.delete(id); put(id, value) },
    load(id, nextOwner, read) {
      scope(nextOwner)
      const hit = entries.get(id)
      if (hit && hit.expires > now()) {
        entries.delete(id); entries.set(id, hit)
        return Promise.resolve(structuredClone(hit.value))
      }
      entries.delete(id)
      if (pending.has(id)) return pending.get(id).then(value => structuredClone(value))
      const request = Promise.resolve().then(read).then(value => {
        if (owner === nextOwner && pending.get(id) === request) put(id, value)
        return value
      }).finally(() => { if (pending.get(id) === request) pending.delete(id) })
      pending.set(id, request)
      return request.then(value => structuredClone(value))
    },
  }
}

// Read the destination while saving the source, but never leave unsaved work.
// Capture read failures immediately, including when preparation refuses a move.
export async function prepareProjectNavigation(prepare, load) {
  const reading = Promise.resolve().then(load).then(snapshot => ({ snapshot }), error => ({ error }))
  if (!await prepare()) return null
  const result = await reading
  if (result.error) throw result.error
  return result.snapshot
}

export function presentCanvasElements(elements, projectId, resultUrl) {
  return elements.map(element => element.type === 'image' && element.assetId
    ? { ...element, content: resultUrl(element.assetId, projectId) }
    : { ...element })
}
