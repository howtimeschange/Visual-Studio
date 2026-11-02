export function modelVendorLabel(value) {
  const labels = { openai: 'OpenAI', google: 'Google', gemini: 'Google', deepseek: 'DeepSeek', anthropic: 'Anthropic', alibaba: 'Alibaba' }
  const key = String(value || '').toLowerCase()
  return Object.hasOwn(labels, key) ? labels[key] : typeof value === 'string' && value ? value : '其他'
}

export function agentModelUnavailableReason(model) {
  if (model.kind === 'image' || model.capabilities?.textInput === false) return '生图模型，不能用于 Agent'
  if (!['openai', 'chat', 'openai-responses', 'responses'].includes(model.protocol)) return '当前工作台暂未支持此调用协议'
  if (model.available === false) {
    const reasons = { key_model_not_allowed: '当前 Key 未开通', membership_required: '需要对应会员权益', paid_model_access_required: '需要付费模型权限', plan_not_allowed: '当前套餐暂不可用' }
    return Object.hasOwn(reasons, model.unavailableReason) ? reasons[model.unavailableReason] : '当前账号暂不可用'
  }
  return ''
}

export function groupModelCatalog(models, search = '') {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const groups = new Map()
  for (const model of models) {
    const vendor = modelVendorLabel(model.vendor)
    const haystack = `${model.id} ${model.name} ${vendor}`.toLowerCase()
    if (!terms.every((term) => haystack.includes(term))) continue
    if (!groups.has(vendor)) groups.set(vendor, [])
    groups.get(vendor).push(model)
  }
  return Array.from(groups, ([vendor, entries]) => ({ vendor, models: entries })).sort((a, b) => a.vendor.localeCompare(b.vendor))
}
