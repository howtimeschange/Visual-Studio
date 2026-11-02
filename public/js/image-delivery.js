import { gptImageRequestSize } from './image-model-constraints.js'

export function sanitizeImageProviderDelivery(value) {
  if (!value || typeof value !== 'object') return null
  const model = v => typeof v === 'string' && /^[\w.:-]{1,160}$/.test(v) ? v : ''
  const quality = v => ['auto','low','medium','high','xhigh','max'].includes(v) ? v : ''
  return { requestedModel:model(value.requested?.model || value.requestedModel), reportedModel:model(value.upstream?.model || value.reportedModel),
    requestedQuality:quality(value.requested?.quality || value.requestedQuality), reportedQuality:quality(value.upstream?.quality || value.reportedQuality) }
}

export function assessImageDelivery(input) {
  const width = Math.max(0, Math.round(Number(input.width) || 0))
  const height = Math.max(0, Math.round(Number(input.height) || 0))
  const resolution = String(input.resolution || '1k').toLowerCase()
  const requestedSize = String(input.modelId || '').startsWith('gpt-image-') ? input.size || gptImageRequestSize(input.aspectRatio || '1:1', resolution) : ''
  const requestedPixels = requestedSize.split('x').map(Number)
  const targetLongEdge = requestedPixels.length === 2 && requestedPixels.every(Number.isFinite) ? Math.max(...requestedPixels) : ({ '1k': 1024, '2k': 2048, '4k': 4096 })[resolution] || 1024
  const match = /^(\d+):(\d+)$/.exec(String(input.aspectRatio || '1:1'))
  const ratio = match ? Number(match[1]) / Number(match[2]) : 1
  const issues = []
  if (!width || !height) issues.push('无法确认实际像素尺寸')
  else {
    if (requestedPixels.length === 2 && requestedPixels.every(Number.isFinite)) {
      if (width !== requestedPixels[0] || height !== requestedPixels[1]) issues.push(`实际 ${width}×${height}，与请求 ${requestedSize.replace('x','×')} 不一致`)
    } else if (Math.max(width, height) < targetLongEdge) issues.push(`实际 ${width}×${height}，低于所选 ${resolution.toUpperCase()} 的长边 ${targetLongEdge}px`)
    if (match && Math.abs(width / height / ratio - 1) > 0.04) issues.push(`实际比例与所选 ${String(input.aspectRatio || '1:1')} 不一致`)
  }
  const provider = sanitizeImageProviderDelivery(input.providerDelivery)
  if (provider?.requestedQuality && provider.requestedQuality !== 'auto') {
    if (!provider.reportedQuality) issues.push('上游未提供生成质量回执，无法确认所选质量')
    else if (provider.reportedQuality !== provider.requestedQuality) issues.push(`上游回执质量 ${provider.reportedQuality}，与请求 ${provider.requestedQuality} 不一致`)
  }
  if (provider?.requestedModel && !provider.reportedModel) issues.push('上游未提供实际模型回执，执行型号待核实')
  else if (provider?.requestedModel && provider.reportedModel !== provider.requestedModel) issues.push(`上游回执模型 ${provider.reportedModel}，与请求 ${provider.requestedModel} 不一致`)
  const mismatch = issues.some(issue => !issue.includes('未提供'))
  return { status: !width || !height ? 'unknown' : mismatch ? 'mismatch' : issues.length ? 'unverified' : 'passed', width, height, provider,
    requestedResolution: resolution, requestedAspectRatio: String(input.aspectRatio || '1:1'), requestedSize, targetLongEdge, issues }
}
