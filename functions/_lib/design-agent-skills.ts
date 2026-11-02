// Curated workflow adaptations, not an OpenDesign CLI/runtime dependency.
// Keep provider dispatch in the host's existing asynchronous image queue.
const SKILLS = {
  visual: {
    id: 'visual', label: '视觉创作', source: 'visual-studio', requiresReference: false,
    instructions: '按用途选择摄影、插画、平面或三维视觉语言。遵循用户指定的张数，不擅自扩展为一组图片。',
    checks: ['用途和风格匹配', '每个任务对应一张图片', '按所选比例与分辨率提交'],
  },
  'reference-product': {
    id: 'reference-product', label: '商品三图', source: 'OpenDesign ecommerce-image-workflow', requiresReference: true,
    instructions: '基于真实商品参考图做主图、卖点图、生活场景图。用户未另指定张数时，该工作流为三张；用户只要一张或两张时严格按要求。每张提示词必须锁定可见商品的轮廓、色彩、材质、结构、比例及标识位置。不可设计成另一件产品，不编造认证、参数、功效或看不见的细节。卖点图只表达有证据的卖点；没有证据时先澄清。画幅使用用户所选的受支持比例，不照搬不支持的 4:5。',
    checks: ['真实商品参考已传入', '轮廓、颜色、结构与材质保持', '三类镜头用途区分', '不编造产品卖点'],
  },
  'brand-campaign': {
    id: 'brand-campaign', label: '品牌海报', source: 'OpenDesign brand workflow patterns', requiresReference: false,
    instructions: '先梳理品牌语气、受众、主标题、辅助信息与版式层级，再生成海报。采用用户提供的品牌信息；缺少品牌标识时不要伪造真实商标或品牌事实。不得编造商品规格、材质性能、认证或功能，即便只是示例文案；没有产品证据时用待确认占位说明或先澄清。需文案时明确文字与阅读顺序，不套用全局禁止文字的约束。只生成用户请求的张数。',
    checks: ['品牌与受众一致', '标题和信息层级清楚', '不伪造品牌信息'],
  },
  'reference-edit': {
    id: 'reference-edit', label: '参考图延展', source: 'OpenDesign media input and image edit patterns', requiresReference: true,
    instructions: '根据每张参考图的角色区分主体、风格与构图。先明确本轮需要变化的部分和必须保持的部分。保留主体身份，仅改变用户指定的场景、光线、构图或其他要素。不要把风格参考里的主体替换成用户产品。只生成用户请求的张数。',
    checks: ['明确参考图角色', '保留用户指定的不变项', '只修改本轮目标'],
  },
}

export function resolveDesignAgentSkill(requested: unknown, message: string, referenceCount: number) {
  const id = typeof requested === 'string' ? requested : 'auto'
  if (id !== 'auto' && Object.hasOwn(SKILLS, id)) return SKILLS[id as keyof typeof SKILLS]
  if (referenceCount && /(主图|商品).*(三张|三图|一组|套图)|商品组图|三图/.test(message)) return SKILLS['reference-product']
  if (referenceCount && /(延展|换背景|改图|保留主体|风格迁移)/.test(message)) return SKILLS['reference-edit']
  if (/(海报|品牌|活动|KV|banner)/i.test(message)) return SKILLS['brand-campaign']
  return SKILLS.visual
}

export function describeDesignAgentSkill(skill: ReturnType<typeof resolveDesignAgentSkill>) {
  return { id: skill.id, label: skill.label, source: skill.source, qualityChecklist: skill.checks, requiresReference: skill.requiresReference }
}
