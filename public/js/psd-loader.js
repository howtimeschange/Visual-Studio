let loading = null

export function loadPsdLibrary() {
  if (window.agPsd?.writePsd) return Promise.resolve(window.agPsd)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const finish = (error) => {
      window.clearTimeout(timer)
      script.onload = null
      script.onerror = null
      if (error) { script.remove(); reject(error) }
      else resolve(window.agPsd)
    }
    const timer = window.setTimeout(() => finish(new Error('PSD 导出组件加载超时，请重试')), 20_000)
    script.src = '/vendor/ag-psd/ag-psd.bundle.js?v=30.1.1'
    script.async = true
    script.onload = () => finish(window.agPsd?.writePsd ? null : new Error('PSD 导出组件不可用，请重试'))
    script.onerror = () => finish(new Error('PSD 导出组件加载失败，请重试'))
    document.head.append(script)
  }).catch((error) => { loading = null; throw error })
  return loading
}
