// One promise per reference: sending joins the upload already started on add.
// Only an explicit retry can repeat a failed asset upload. Model POSTs never run here.
export function createAgentUploadQueue({ prepare, upload, onChange, concurrency = 2 }) {
  const jobs = new WeakMap(), pending = []
  let active = 0
  const notify = ref => onChange?.(ref)
  function drain() {
    while (active < concurrency && pending.length) {
      const job = pending.shift()
      active++
      void (async () => {
        const { ref, options } = job
        try {
          if (options.isCurrent && !options.isCurrent()) throw new Error('画布或参考图已改变，请重新添加图片。')
          ref.uploadState = 'reading'; notify(ref)
          Object.assign(ref, await prepare(ref, options))
          notify(ref)
          if (options.isCurrent && !options.isCurrent()) throw new Error('画布或参考图已改变，请重新添加图片。')
          ref.uploadState = 'uploading'; notify(ref)
          const result = await upload(ref, options, event => {
            ref.uploadPercent = Math.max(0, Math.min(100, Number(event.percent) || 0))
            ref.uploadState = ref.uploadPercent === 100 ? 'saving' : 'uploading'
            notify(ref)
          })
          if (!result?.assetId) throw new Error('图片尚未保存成功，请重试上传。')
          Object.assign(ref, result, { uploadState: 'ready', uploadPercent: 100, uploadError: '' })
          notify(ref); job.resolve(ref)
        } catch (error) {
          ref.uploadState = 'failed'; ref.uploadError = error.message || '图片上传失败'
          notify(ref); job.reject(error)
        } finally { active--; drain() }
      })()
    }
  }
  return {
    ensure(ref, options = {}) {
      if (ref.assetId) return Promise.resolve(ref)
      const existing = jobs.get(ref)
      if (existing) return existing.promise
      if (ref.uploadState === 'failed' && !options.retry) return Promise.reject(new Error(ref.uploadError || '请重试上传图片'))
      const job = { ref, options }
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject })
      jobs.set(ref, job)
      ref.uploadState = 'queued'; ref.uploadPercent = 0; ref.uploadError = ''
      pending.push(job); notify(ref); drain()
      return job.promise
    },
    retry(ref, options = {}) {
      const existing = jobs.get(ref)
      if (existing && ref.uploadState !== 'failed') return existing.promise
      jobs.delete(ref)
      return this.ensure(ref, { ...options, retry: true })
    },
  }
}

export function agentUploadLabel(ref) {
  if (ref.assetId || ref.uploadState === 'ready') return '已就绪'
  return ({ queued: '等待上传', reading: '读取图片…', saving: '正在保存…', failed: '上传失败' })[ref.uploadState]
    || (ref.uploadState === 'uploading' ? `上传 ${ref.uploadPercent || 0}%` : '待上传')
}

export function isFileDrag(transfer) {
  return Array.from(transfer?.types || []).includes('Files')
}

export function selectAgentImageFiles(files, remaining) {
  const images = Array.from(files || []).filter(file => file.type?.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|heic|heif)$/i.test(file.name || ''))
  return { files: images.slice(0, Math.max(0, remaining)), rejected: images.length !== (files?.length || 0), overflow: images.length > remaining }
}

export function agentReferenceAssetBody(ref, { projectId, sessionId } = {}) {
  const mime = /^data:([^;]+);base64,/.exec(ref.dataUrl || '')?.[1] || ref.mime || 'image/png'
  return { projectId, sessionId: sessionId || undefined, kind: 'upload', source: 'canvas_agent_reference',
    filename: ref.name || 'reference.png', mime, dataUrl: ref.dataUrl,
    width: ref.width || undefined, height: ref.height || undefined }
}
