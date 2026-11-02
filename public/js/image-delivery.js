export function assessImageDelivery(input) {
  const width = Math.max(0, Math.round(Number(input.width) || 0))
  const height = Math.max(0, Math.round(Number(input.height) || 0))
  const resolution = String(input.resolution || '1k').toLowerCase()
  const targetLongEdge = ({ '1k': 1024, '2k': 2048, '4k': 4096 })[resolution] || 1024
  const match = /^(\d+):(\d+)$/.exec(String(input.aspectRatio || '1:1'))
  const ratio = match ? Number(match[1]) / Number(match[2]) : 1
  const issues = []
  if (!width || !height) issues.push('无法确认实际像素尺寸')
  else {
    if (Math.max(width, height) < targetLongEdge) issues.push(`实际 ${width}×${height}，低于所选 ${resolution.toUpperCase()} 的长边 ${targetLongEdge}px`)
    if (match && Math.abs(width / height / ratio - 1) > 0.04) issues.push(`实际比例与所选 ${String(input.aspectRatio || '1:1')} 不一致`)
  }
  return { status: !width || !height ? 'unknown' : issues.length ? 'mismatch' : 'passed', width, height,
    requestedResolution: resolution, requestedAspectRatio: String(input.aspectRatio || '1:1'), targetLongEdge, issues }
}
