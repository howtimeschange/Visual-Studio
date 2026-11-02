// Inline reference files live in IndexedDB, not the small localStorage budget.
let connection
function database() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('visual-studio-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return connection
}
export const canvasDraftKey = (ownerId, projectId) => ownerId && projectId ? `${ownerId}:${projectId}` : ''
export async function readCanvasDraft(key) {
  if (!key) return null
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction('drafts').objectStore('drafts').get(key)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
}
export async function writeCanvasDraft(key, value) {
  if (!key) return
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite')
    tx.objectStore('drafts').put({ text: String(value.text || '').slice(0, 30000), refs: value.refs.slice(0, 6), savedAt: Date.now() }, key)
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
  })
}
