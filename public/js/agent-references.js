export const AGENT_REFERENCE_LIMIT = 6

export function planAgentReferenceAddition(references, image, busy = false) {
  if (busy) return { status: 'busy' }
  const assetId = String(image?.assetId || image?.imageAssetId || '')
  const dataUrl = image?.dataUrl || image?.content || ''
  if (!assetId && !dataUrl) return { status: 'invalid' }
  if (references.some((ref) => assetId && ref.assetId === assetId || dataUrl && ref.dataUrl === dataUrl)) return { status: 'duplicate' }
  if (references.length >= AGENT_REFERENCE_LIMIT) return { status: 'limit' }
  return { status: 'added', reference: { assetId, dataUrl, name: image?.name || '画布图片', mime: image?.mime || '', role: 'subject' } }
}
