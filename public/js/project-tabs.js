// Only project identities and titles are persisted. Drafts and credentials keep
// their existing account/project-scoped stores.
export function normalizeProjectTabs(value) {
  const ids = new Set()
  return (Array.isArray(value) ? value : []).filter(item => {
    if (!item || typeof item.id !== 'string' || !/^[\w-]{1,160}$/.test(item.id) || ids.has(item.id)) return false
    ids.add(item.id); return true
  }).slice(-20).map(item => ({ id:item.id, title:String(item.title || '未命名画布').slice(0,80) }))
}
export function createProjectTabStore(storage) {
  let owner = '', tabs = []
  const key = () => `vs.project-tabs.v1:${owner}`
  const persist = () => { try { if (owner) storage.setItem(key(), JSON.stringify(tabs)) } catch { /* Tabs remain usable in memory. */ } }
  return {
    scope(next) {
      if (owner === next) return false
      owner = next || ''; tabs = []
      try { if (owner) tabs = normalizeProjectTabs(JSON.parse(storage.getItem(key()) || '[]')) } catch { /* Invalid storage is not trusted. */ }
      return true
    },
    list: () => tabs.map(item => ({...item})),
    open(item) {
      const [safe] = normalizeProjectTabs([item]); if (!safe) return
      const index = tabs.findIndex(tab => tab.id === safe.id)
      if (index >= 0) tabs[index] = safe
      else tabs = [...tabs, safe].slice(-20)
      persist()
    },
    close(id) {
      const index = tabs.findIndex(item => item.id === id)
      if (index < 0) return ''
      tabs.splice(index,1); persist()
      return tabs[Math.min(index,tabs.length-1)]?.id || ''
    },
  }
}
