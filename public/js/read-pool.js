// Bound large workspace restores and join duplicate GETs without retaining
// image bytes once their callers have received them. Never pool model writes.
export function createReadPool(concurrency = 4) {
  const pending = [], inFlight = new Map()
  let active = 0
  function drain() {
    while (active < concurrency && pending.length) {
      const task = pending.shift()
      active++
      void (async () => {
        try { task.resolve(await task.read()) }
        catch (error) { task.reject(error) }
        finally { active--; inFlight.delete(task.key); drain() }
      })()
    }
  }
  return (key, read) => {
    if (inFlight.has(key)) return inFlight.get(key)
    const task = { key, read }
    const promise = new Promise((resolve, reject) => { task.resolve = resolve; task.reject = reject })
    inFlight.set(key, promise); pending.push(task); drain()
    return promise
  }
}
