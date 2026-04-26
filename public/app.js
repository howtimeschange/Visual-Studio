const LANGUAGES = [
  { code: 'auto', label: '自动检测', nativeLabel: 'Auto detect' },
  { code: 'zh', label: '简体中文', nativeLabel: '简体中文' },
  { code: 'zh-TW', label: '繁體中文', nativeLabel: '繁體中文' },
  { code: 'en', label: '英语', nativeLabel: 'English' },
  { code: 'ja', label: '日语', nativeLabel: '日本語' },
  { code: 'ko', label: '韩语', nativeLabel: '한국어' },
  { code: 'fr', label: '法语', nativeLabel: 'Français' },
  { code: 'de', label: '德语', nativeLabel: 'Deutsch' },
  { code: 'es', label: '西班牙语', nativeLabel: 'Español' },
  { code: 'pt', label: '葡萄牙语', nativeLabel: 'Português' },
  { code: 'ru', label: '俄语', nativeLabel: 'Русский' },
  { code: 'ar', label: '阿拉伯语', nativeLabel: 'العربية' },
  { code: 'th', label: '泰语', nativeLabel: 'ไทย' },
  { code: 'vi', label: '越南语', nativeLabel: 'Tiếng Việt' },
  { code: 'id', label: '印尼语', nativeLabel: 'Bahasa Indonesia' },
  { code: 'ms', label: '马来语', nativeLabel: 'Bahasa Melayu' },
  { code: 'tl', label: '菲律宾语', nativeLabel: 'Filipino' },
  { code: 'my', label: '缅甸语', nativeLabel: 'မြန်မာဘာသာ' },
  { code: 'km', label: '高棉语', nativeLabel: 'ភាសាខ្មែរ' },
  { code: 'lo', label: '老挝语', nativeLabel: 'ພາສາລາວ' },
]

const TARGET_LANGUAGES = LANGUAGES.filter((item) => item.code !== 'auto')

const MODEL_OPTIONS = [
  { id: 'nano-banana-2', label: 'Nano Banana 2', hint: '快速 · 稳定' },
  { id: 'nano-banana-pro', label: 'Nano Banana Pro', hint: '更强细节 · 更高一致性' },
  { id: 'gpt-image-2', label: 'GPT Image 2', hint: 'OpenAI 图像模型' },
]

const GARMENT_ROLE_OPTIONS = [
  { value: 'full_outfit', label: '整套' },
  { value: 'top', label: '上衣' },
  { value: 'bottom', label: '下装' },
  { value: 'dress', label: '连衣裙' },
  { value: 'outerwear', label: '外套' },
  { value: 'accessory', label: '配饰' },
]

const REFERENCE_ROLES = [
  { value: 'character', label: '人物一致性' },
  { value: 'subject', label: '主体 / 产品' },
  { value: 'style', label: '风格 / 色调' },
  { value: 'scene', label: '场景 / 构图' },
  { value: 'other', label: '其他参考' },
]

const AUTO_RETRY_LIMIT = 2
const AUTO_RETRY_DELAY_MS = 1200

const KEY_STORAGE = 'img-translator:keys:v1'
const PREF_STORAGE = 'img-translator:workbench:prefs:v1'
const LEGACY_TRANSLATE_PREF_STORAGE = 'img-translator:prefs:v1'
const RUNTIME_STORAGE = 'img-translator:runtime:v2'
const RESULTS_STORAGE = 'img-translator:results:v1'
const TERMINAL_JOB_STATUSES = new Set(['completed', 'partial_failed', 'failed', 'cancelled'])
let translateWatcherToken = 0
let outfitWatcherToken = 0
let canvasSpaceHeld = false

const state = {
  activeView: 'translate',
  openDropdown: null,
  keys: {},
  runtime: {
    sessionId: '',
  },
  translate: {
    source: 'auto',
    targets: ['en'],
    model: 'nano-banana-2',
    preserveBrand: true,
    concurrency: 2,
    items: [],
    running: false,
    progress: '',
    jobId: '',
  },
  generate: {
    // canvas
    scale: 1,
    panX: 0,
    panY: 0,
    elements: [],
    selectedIds: [],
    activeTool: 'select',
    isDragging: false,
    isPanning: false,
    dragStartX: 0,
    dragStartY: 0,
    dragElementStartX: 0,
    dragElementStartY: 0,
    // ai sidebar
    showAiPanel: false,
    aiMessages: [],
    aiRefs: [],
    aiRunning: false,
    // gen panel
    genTargetId: '',
    genPrompt: '',
    genModel: 'nano-banana-2',
    genRatio: '1:1',
    genUseAgent: false,
    genRefs: [],
    genRunning: false,
    // runtime
    model: 'nano-banana-2',
  },
  outfit: {
    model: 'nano-banana-pro',
    garmentType: 'full_outfit',
    concurrency: 2,
    instructions: '',
    models: [],
    garments: [],
    results: {},
    running: false,
    progress: '',
    jobId: '',
  },
  style: {
    model: 'nano-banana-2',
    sourceImage: null,
    visualStyle: null,
    styleSummary: '',
    colorPalette: [],
    tags: [],
    analyzing: false,
    subjectRefs: [],
    subject: '',
    generating: false,
    resultDataUrl: '',
    error: '',
    history: [],
  },
}

const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector))

const dom = {
  views: $$('.view'),
  navItems: $$('.nav-item'),
  settingsBtn: $('#settings-btn'),
  settingsDialog: $('#settings-dialog'),
  settingsForm: $('#settings-form'),
  settingsClear: $('#settings-clear'),
  sourceDropdown: $('[data-dd="source-lang"]'),
  sourceValue: $('#source-lang-value'),
  sourceMenu: $('#source-lang-menu'),
  targetDropdown: $('[data-dd="target-langs"]'),
  targetValue: $('#target-langs-value'),
  targetMenu: $('#target-langs-menu'),
  targetChips: $('#target-chips'),
  tModel: $('#t-model'),
  tConcurrency: $('#t-concurrency'),
  tPreserve: $('#t-preserve'),
  tDropzone: $('#t-dropzone'),
  tFileInput: $('#t-file-input'),
  tBrowseBtn: $('#t-browse-btn'),
  tRunBtn: $('#t-run-btn'),
  tClearBtn: $('#t-clear-btn'),
  tDlBtn: $('#t-dl-btn'),
  tProgress: $('#t-progress'),
  tGrid: $('#t-grid'),
  tEmpty: $('#t-empty'),
  gModel: $('#g-model'),
  gAgent: $('#g-agent'),
  gNew: $('#g-new'),
  gInput: $('#g-input'),
  gSend: $('#g-send'),
  gCanvasContainer: $('#g-canvas-container'),
  gCanvas: $('#g-canvas'),
  gCanvasEmpty: $('#g-canvas-empty'),
  gConnectors: $('#g-connectors'),
  gAiSidebar: $('#g-ai-sidebar'),
  gAiToggle: $('#g-ai-toggle'),
  gAiClose: $('#g-ai-close'),
  gAiMessages: $('#g-ai-messages'),
  gGenPanel: $('#g-gen-panel'),
  gGenPrompt: $('#g-gen-prompt'),
  gGenRefList: $('#g-gen-ref-list'),
  gGenRefUpload: $('#g-gen-ref-upload'),
  gGenRefInput: $('#g-gen-ref-input'),
  gGenRatio: $('#g-gen-ratio'),
  gGenRun: $('#g-gen-run'),
  gGenProgress: $('#g-gen-progress'),
  gToolbar: $('#g-toolbar'),
  gFileInput: $('#g-file-input'),
  gZoomOut: $('#g-zoom-out'),
  gZoomIn: $('#g-zoom-in'),
  gZoomValue: $('#g-zoom-value'),
  gContextMenu: $('#g-context-menu'),
  gAiModel: $('#g-ai-model'),
  gAiRatio: $('#g-ai-ratio'),
  gAiUpload: $('#g-ai-upload'),
  gAiFileInput: $('#g-ai-file-input'),
  gAiRefList: $('#g-ai-ref-list'),
  oModel: $('#o-model'),
  oGarmentType: $('#o-garment-type'),
  oConcurrency: $('#o-concurrency'),
  oModelInput: $('#o-model-input'),
  oModelAdd: $('#o-model-add'),
  oModelList: $('#o-model-list'),
  oModelCount: $('#o-model-count'),
  oGarmentInput: $('#o-garment-input'),
  oGarmentAdd: $('#o-garment-add'),
  oGarmentList: $('#o-garment-list'),
  oGarmentCount: $('#o-garment-count'),
  oLookCount: $('#o-look-count'),
  oInstructions: $('#o-instructions'),
  oRun: $('#o-run'),
  oClear: $('#o-clear'),
  oDl: $('#o-dl'),
  oProgress: $('#o-progress'),
  oGrid: $('#o-grid'),
  oEmpty: $('#o-empty'),
  sModel: $('#s-model'),
  sDropzone: $('#s-dropzone'),
  sFileInput: $('#s-file-input'),
  sDzInner: $('#s-dz-inner'),
  sSourcePreview: $('#s-source-preview'),
  sSourceImg: $('#s-source-img'),
  sClearSource: $('#s-clear-source'),
  sAnalyzeProgress: $('#s-analyze-progress'),
  sStyleResult: $('#s-style-result'),
  sSummary: $('#s-summary'),
  sPalette: $('#s-palette'),
  sTags: $('#s-tags'),
  sJsonContent: $('#s-json-content'),
  sJsonCopy: $('#s-json-copy'),
  sGenerateSection: $('#s-generate-section'),
  sRefInput: $('#s-ref-input'),
  sRefAdd: $('#s-ref-add'),
  sRefList: $('#s-ref-list'),
  sSubject: $('#s-subject'),
  sGenerate: $('#s-generate'),
  sGenProgress: $('#s-gen-progress'),
  sProgress: $('#s-progress'),
  sResultWrap: $('#s-result-wrap'),
  sResultPreview: $('#s-result-preview'),
  sResultImg: $('#s-result-img'),
  sResultLightbox: $('#s-result-lightbox'),
  sDownload: $('#s-download'),
  sError: $('#s-error'),
  sHistorySection: $('#s-history-section'),
  sHistory: $('#s-history'),
  sClearHistory: $('#s-clear-history'),
  lightbox: $('#image-lightbox'),
  lightboxImage: $('#lightbox-image'),
  lightboxCaption: $('#lightbox-caption'),
  lightboxDownload: $('#lightbox-download'),
  lightboxClose: $('#lightbox-close'),
}

init()

function init() {
  hydrateStoredState()
  populateModelSelects()
  bindShell()
  bindSettings()
  bindLightbox()
  bindTranslate()
  bindGenerate()
  bindOutfit()
  bindStyle()
  renderAll()
  void restoreRuntimeState()
}

function hydrateStoredState() {
  state.keys = loadKeys()
  const runtime = sanitizeRuntimeState(loadRuntimeState())
  state.runtime.sessionId = runtime.sessionId
  state.translate.jobId = runtime.translate.jobId
  state.translate.items = runtime.translate.items
  state.generate.elements = runtime.generate.elements || []
  state.generate.scale = runtime.generate.scale || 1
  state.generate.panX = runtime.generate.panX || 0
  state.generate.panY = runtime.generate.panY || 0
  state.outfit.jobId = runtime.outfit.jobId
  state.outfit.models = runtime.outfit.models
  state.outfit.garments = runtime.outfit.garments
  state.style.sourceImage = runtime.style?.sourceImage || null
  state.style.visualStyle = runtime.style?.visualStyle || null
  state.style.styleSummary = runtime.style?.styleSummary || ''
  state.style.colorPalette = runtime.style?.colorPalette || []
  state.style.tags = runtime.style?.tags || []
  state.style.subjectRefs = runtime.style?.subjectRefs || []
  state.style.history = runtime.style?.history || []

  const stored = readJson(PREF_STORAGE, null)
  if (stored) {
    state.activeView = normalizeView(stored.activeView)
    Object.assign(state.translate, sanitizeTranslatePrefs(stored.translate))
    Object.assign(state.generate, sanitizeGeneratePrefs(stored.generate))
    Object.assign(state.outfit, sanitizeOutfitPrefs(stored.outfit))
    if (stored.style) {
      state.style.model = getModel(stored.style.model)?.id || state.style.model
    }
    return
  }

  const legacy = readJson(LEGACY_TRANSLATE_PREF_STORAGE, null)
  if (legacy) {
    Object.assign(state.translate, sanitizeTranslatePrefs(legacy))
  }
}

function sanitizeTranslatePrefs(raw = {}) {
  const targetCodes = Array.isArray(raw.targets)
    ? raw.targets.filter((code) => TARGET_LANGUAGES.some((item) => item.code === code))
    : state.translate.targets
  return {
    source: getLanguage(raw.source)?.code || state.translate.source,
    targets: targetCodes.length ? unique(targetCodes) : state.translate.targets,
    model: getModel(raw.model)?.id || state.translate.model,
    preserveBrand: typeof raw.preserveBrand === 'boolean' ? raw.preserveBrand : state.translate.preserveBrand,
    concurrency: clamp(Number(raw.concurrency) || state.translate.concurrency, 1, 6),
  }
}

function sanitizeGeneratePrefs(raw = {}) {
  return {
    model: getModel(raw.model)?.id || state.generate.model,
    genUseAgent: typeof raw.genUseAgent === 'boolean' ? raw.genUseAgent : (typeof raw.useDesignAgent === 'boolean' ? raw.useDesignAgent : state.generate.genUseAgent),
  }
}

function sanitizeOutfitPrefs(raw = {}) {
  const garmentType = GARMENT_ROLE_OPTIONS.some((item) => item.value === raw.garmentType)
    ? raw.garmentType
    : state.outfit.garmentType
  return {
    model: getModel(raw.model)?.id || state.outfit.model,
    garmentType,
    concurrency: clamp(Number(raw.concurrency) || state.outfit.concurrency, 1, 4),
    instructions: typeof raw.instructions === 'string' ? raw.instructions : state.outfit.instructions,
  }
}

function savePrefs() {
  localStorage.setItem(PREF_STORAGE, JSON.stringify({
    activeView: state.activeView,
    translate: {
      source: state.translate.source,
      targets: state.translate.targets,
      model: state.translate.model,
      preserveBrand: state.translate.preserveBrand,
      concurrency: state.translate.concurrency,
    },
    generate: {
      model: state.generate.model,
      genUseAgent: state.generate.genUseAgent,
    },
    outfit: {
      model: state.outfit.model,
      garmentType: state.outfit.garmentType,
      concurrency: state.outfit.concurrency,
      instructions: state.outfit.instructions,
    },
    style: {
      model: state.style.model,
    },
  }))
}

function saveRuntimeState() {
  localStorage.setItem(RUNTIME_STORAGE, JSON.stringify({
    sessionId: state.runtime.sessionId || '',
    translate: {
      jobId: state.translate.jobId || '',
      items: state.translate.items.map((item) => serializeAssetBackedItem(item)),
    },
    generate: {
      elements: state.generate.elements.map((el) => ({
        id: el.id,
        type: el.type,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        content: el.type === 'image' ? '' : (el.content || ''),
        name: el.name || '',
        assetId: el.assetId || '',
        referenceImageId: el.referenceImageId || null,
        generatingPrompt: el.generatingPrompt || '',
        connectorFrom: el.connectorFrom || '',
        connectorTo: el.connectorTo || '',
      })),
      scale: state.generate.scale,
      panX: state.generate.panX,
      panY: state.generate.panY,
    },
    outfit: {
      jobId: state.outfit.jobId || '',
      models: state.outfit.models.map((item) => serializeAssetBackedItem(item)),
      garments: state.outfit.garments.map((item) => serializeAssetBackedItem(item, { role: item.role || 'full_outfit' })),
    },
    style: {
      sourceImage: state.style.sourceImage ? serializeAssetBackedItem(state.style.sourceImage) : null,
      visualStyle: state.style.visualStyle,
      styleSummary: state.style.styleSummary,
      colorPalette: state.style.colorPalette,
      tags: state.style.tags,
      subjectRefs: state.style.subjectRefs.map((item) => serializeAssetBackedItem(item)),
      history: state.style.history.map((entry) => ({
        id: entry.id,
        subject: entry.subject,
        resultDataUrl: entry.resultDataUrl || '',
        timestamp: entry.timestamp,
      })),
    },
  }))
}

function loadRuntimeState() {
  return readJson(RUNTIME_STORAGE, {})
}

function sanitizeRuntimeState(raw = {}) {
  const translateItems = Array.isArray(raw.translate?.items)
    ? raw.translate.items
      .map((item) => sanitizeStoredAssetItem(item))
      .filter(Boolean)
      .map((item) => ({ ...item, results: {} }))
    : []
  const generateElements = Array.isArray(raw.generate?.elements)
    ? raw.generate.elements.filter((el) => el && el.id && el.type)
    : []
  const outfitModels = Array.isArray(raw.outfit?.models)
    ? raw.outfit.models.map((item) => sanitizeStoredAssetItem(item)).filter(Boolean)
    : []
  const outfitGarments = Array.isArray(raw.outfit?.garments)
    ? raw.outfit.garments
      .map((item) => sanitizeStoredAssetItem(item))
      .filter(Boolean)
      .map((item) => ({ ...item, role: item.role || 'full_outfit' }))
    : []

  return {
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : '',
    translate: {
      jobId: typeof raw.translate?.jobId === 'string' ? raw.translate.jobId : '',
      items: translateItems,
    },
    generate: {
      elements: generateElements,
      scale: Number(raw.generate?.scale) || 1,
      panX: Number(raw.generate?.panX) || 0,
      panY: Number(raw.generate?.panY) || 0,
    },
    outfit: {
      jobId: typeof raw.outfit?.jobId === 'string' ? raw.outfit.jobId : '',
      models: outfitModels,
      garments: outfitGarments,
    },
    style: {
      sourceImage: raw.style?.sourceImage ? sanitizeStoredAssetItem(raw.style.sourceImage) : null,
      visualStyle: raw.style?.visualStyle || null,
      styleSummary: typeof raw.style?.styleSummary === 'string' ? raw.style.styleSummary : '',
      colorPalette: Array.isArray(raw.style?.colorPalette) ? raw.style.colorPalette : [],
      tags: Array.isArray(raw.style?.tags) ? raw.style.tags : [],
      subjectRefs: Array.isArray(raw.style?.subjectRefs)
        ? raw.style.subjectRefs.map((item) => sanitizeStoredAssetItem(item)).filter(Boolean)
        : [],
      history: Array.isArray(raw.style?.history)
        ? raw.style.history.filter((entry) => entry?.id && entry?.resultDataUrl).slice(-30)
        : [],
    },
  }
}

function serializeAssetBackedItem(item, extra = {}) {
  return {
    id: item.id,
    assetId: item.assetId || '',
    name: item.name,
    mime: item.mime,
    label: item.label || '',
    role: item.role || '',
    ...extra,
  }
}

function sanitizeStoredAssetItem(raw = {}) {
  const assetId = String(raw.assetId || raw.id || '').trim()
  if (!assetId) return null
  return {
    id: assetId,
    assetId,
    name: String(raw.name || raw.label || assetId),
    mime: String(raw.mime || 'image/png'),
    label: typeof raw.label === 'string' ? raw.label : '',
    role: typeof raw.role === 'string' ? raw.role : '',
    dataUrl: '',
    base64: '',
  }
}

function bindShell() {
  for (const button of dom.navItems) {
    button.addEventListener('click', () => {
      setActiveView(button.dataset.view || 'translate')
    })
  }

  const sourceTrigger = $('.dd-trigger', dom.sourceDropdown)
  const targetTrigger = $('.dd-trigger', dom.targetDropdown)

  sourceTrigger.addEventListener('click', (event) => {
    event.stopPropagation()
    toggleDropdown('source')
  })

  targetTrigger.addEventListener('click', (event) => {
    event.stopPropagation()
    toggleDropdown('target')
  })

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.dd')) {
      closeDropdowns()
    }
  })

  dom.sourceMenu.addEventListener('click', (event) => {
    const item = event.target.closest('.dd-item')
    if (!item) return
    const language = getLanguage(item.dataset.code)
    if (!language) return
    state.translate.source = language.code
    savePrefs()
    renderTranslateDropdowns()
    closeDropdowns()
  })

  dom.targetMenu.addEventListener('click', (event) => {
    const item = event.target.closest('.dd-item')
    if (!item) return
    const code = item.dataset.code
    if (!TARGET_LANGUAGES.some((language) => language.code === code)) return
    toggleTargetLanguage(code)
  })
}

function bindSettings() {
  dom.settingsBtn.addEventListener('click', () => {
    hydrateKeyForm()
    dom.settingsDialog.showModal()
  })

  dom.settingsForm.addEventListener('submit', (event) => {
    event.preventDefault()
    state.keys = {
      visionApiKey: $('#k-vision').value.trim(),
      banana2ApiKey: $('#k-banana2').value.trim(),
      bananaProApiKey: $('#k-bananapro').value.trim(),
      gptImageApiKey: $('#k-gptimage').value.trim(),
    }
    for (const key of Object.keys(state.keys)) {
      if (!state.keys[key]) delete state.keys[key]
    }
    localStorage.setItem(KEY_STORAGE, JSON.stringify(state.keys))
    dom.settingsDialog.close()
  })

  dom.settingsClear.addEventListener('click', () => {
    localStorage.removeItem(KEY_STORAGE)
    state.keys = {}
    hydrateKeyForm()
  })
}

function bindTranslate() {
  dom.tModel.addEventListener('change', () => {
    state.translate.model = dom.tModel.value
    savePrefs()
    renderTranslate()
  })

  dom.tConcurrency.addEventListener('change', () => {
    state.translate.concurrency = clamp(Number(dom.tConcurrency.value) || 1, 1, 6)
    savePrefs()
    renderTranslate()
  })

  dom.tPreserve.addEventListener('change', () => {
    state.translate.preserveBrand = dom.tPreserve.checked
    savePrefs()
    renderTranslate()
  })

  dom.tBrowseBtn.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (isTranslateBusy()) return
    dom.tFileInput.click()
  })

  bindDropSurface({
    surface: dom.tDropzone,
    input: dom.tFileInput,
    onFiles: async (files) => {
      if (isTranslateBusy()) return
      const images = await prepareAssetItems(files)
      state.translate.items.push(...images.map((item) => ({ ...item, results: {} })))
      saveRuntimeState()
      renderTranslate()
    },
    onClick: () => !isTranslateBusy(),
  })

  dom.tRunBtn.addEventListener('click', runTranslateBatch)
  dom.tClearBtn.addEventListener('click', () => {
    if (isTranslateBusy()) return
    translateWatcherToken += 1
    state.translate.items = []
    state.translate.jobId = ''
    state.translate.progress = ''
    saveRuntimeState()
    renderTranslate()
  })
  dom.tDlBtn.addEventListener('click', downloadTranslateResults)
}

function bindGenerate() {
  bindCanvas()
  bindToolbar()
  bindZoom()
  bindGenPanel()
  bindAiSidebar()

  dom.gNew.addEventListener('click', () => {
    if (state.generate.genRunning || state.generate.aiRunning) return
    state.generate.elements = []
    state.generate.selectedIds = []
    state.generate.scale = 1
    state.generate.panX = 0
    state.generate.panY = 0
    hideGenPanel()
    hideContextMenu()
    saveRuntimeState()
    renderGenerate()
  })
}

/* ═══════════════ CANVAS ENGINE ═══════════════ */

function screenToCanvas(sx, sy) {
  const rect = dom.gCanvasContainer.getBoundingClientRect()
  return {
    x: (sx - rect.left - state.generate.panX) / state.generate.scale,
    y: (sy - rect.top - state.generate.panY) / state.generate.scale,
  }
}

function updateCanvasTransform() {
  const { panX, panY, scale } = state.generate
  dom.gCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`
  dom.gCanvas.style.transformOrigin = '0 0'
}

function bindCanvas() {
  dom.gCanvasContainer.addEventListener('mousedown', handleCanvasMouseDown)
  document.addEventListener('mousemove', handleCanvasMouseMove)
  document.addEventListener('mouseup', handleCanvasMouseUp)
  dom.gCanvasContainer.addEventListener('wheel', handleCanvasWheel, { passive: false })
  dom.gCanvasContainer.addEventListener('contextmenu', (e) => e.preventDefault())

  document.addEventListener('keydown', (e) => {
    if (state.activeView !== 'generate') return
    if (e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault()
      canvasSpaceHeld = true
      dom.gCanvasContainer.style.cursor = 'grab'
    }
    handleCanvasKeyDown(e)
  })

  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      canvasSpaceHeld = false
      dom.gCanvasContainer.style.cursor = ''
    }
  })

  // Drop files on canvas
  dom.gCanvasContainer.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' })
  dom.gCanvasContainer.addEventListener('drop', async (e) => {
    e.preventDefault()
    if (!e.dataTransfer?.files?.length) return
    const images = await readImageFiles(e.dataTransfer.files)
    const pos = screenToCanvas(e.clientX, e.clientY)
    for (let i = 0; i < images.length; i++) {
      addImageToCanvas(images[i].dataUrl, images[i].name, pos.x + i * 40, pos.y + i * 40)
    }
    renderCanvas()
    saveRuntimeState()
  })

  // Click outside elements deselects
  dom.gCanvasContainer.addEventListener('click', (e) => {
    if (e.target === dom.gCanvasContainer || e.target === dom.gCanvas) {
      if (!state.generate.isPanning && !state.generate.isDragging) {
        state.generate.selectedIds = []
        hideGenPanel()
        hideContextMenu()
        renderCanvas()
      }
    }
  })

  // Click canvas in specific tool modes
  dom.gCanvasContainer.addEventListener('dblclick', (e) => {
    if (state.activeView !== 'generate') return
    const tool = state.generate.activeTool
    const pos = screenToCanvas(e.clientX, e.clientY)
    if (tool === 'text') {
      addTextToCanvas(pos.x, pos.y)
      renderCanvas()
      saveRuntimeState()
    } else if (tool === 'ai-gen') {
      addGeneratorToCanvas(pos.x, pos.y)
      renderCanvas()
      saveRuntimeState()
    }
  })
}

function handleCanvasMouseDown(e) {
  if (state.activeView !== 'generate') return
  hideContextMenu()

  // Middle button or space+left = pan
  if (e.button === 1 || (e.button === 0 && canvasSpaceHeld)) {
    e.preventDefault()
    state.generate.isPanning = true
    state.generate.dragStartX = e.clientX
    state.generate.dragStartY = e.clientY
    state.generate.dragElementStartX = state.generate.panX
    state.generate.dragElementStartY = state.generate.panY
    dom.gCanvasContainer.style.cursor = 'grabbing'
    return
  }

  // Left click on element = select or drag
  if (e.button === 0) {
    const elNode = e.target.closest('.canvas-el')
    if (elNode) {
      const elId = elNode.dataset.elId
      if (elId) {
        // Right-click?
        if (e.button === 2) {
          const el = state.generate.elements.find((item) => item.id === elId)
          if (el && el.type === 'image') {
            showContextMenu(e, elId)
          }
          return
        }

        state.generate.selectedIds = [elId]
        const el = state.generate.elements.find((item) => item.id === elId)
        if (el) {
          state.generate.isDragging = true
          state.generate.dragStartX = e.clientX
          state.generate.dragStartY = e.clientY
          state.generate.dragElementStartX = el.x
          state.generate.dragElementStartY = el.y
        }

        if (el?.type === 'image-generator') {
          showGenPanel(elId)
        } else {
          hideGenPanel()
        }

        renderCanvas()
        return
      }
    }

    // Click empty canvas area with tool
    const tool = state.generate.activeTool
    if (tool === 'image' && (e.target === dom.gCanvasContainer || e.target === dom.gCanvas)) {
      dom.gFileInput.click()
    }
  }
}

function handleCanvasMouseMove(e) {
  if (state.generate.isPanning) {
    const dx = e.clientX - state.generate.dragStartX
    const dy = e.clientY - state.generate.dragStartY
    state.generate.panX = state.generate.dragElementStartX + dx
    state.generate.panY = state.generate.dragElementStartY + dy
    updateCanvasTransform()
    renderConnectors()
    return
  }

  if (state.generate.isDragging && state.generate.selectedIds.length === 1) {
    const el = state.generate.elements.find((item) => item.id === state.generate.selectedIds[0])
    if (!el) return
    const dx = (e.clientX - state.generate.dragStartX) / state.generate.scale
    const dy = (e.clientY - state.generate.dragStartY) / state.generate.scale
    el.x = state.generate.dragElementStartX + dx
    el.y = state.generate.dragElementStartY + dy

    const node = dom.gCanvas.querySelector(`[data-el-id="${el.id}"]`)
    if (node) {
      node.style.left = `${el.x}px`
      node.style.top = `${el.y}px`
    }
    renderConnectors()
  }
}

function handleCanvasMouseUp(e) {
  if (state.generate.isPanning) {
    state.generate.isPanning = false
    dom.gCanvasContainer.style.cursor = canvasSpaceHeld ? 'grab' : ''
    saveRuntimeState()
  }
  if (state.generate.isDragging) {
    state.generate.isDragging = false
    saveRuntimeState()
  }
}

function handleCanvasWheel(e) {
  if (state.activeView !== 'generate') return
  e.preventDefault()

  const delta = e.deltaY > 0 ? -0.1 : 0.1
  const oldScale = state.generate.scale
  const newScale = clamp(oldScale + delta, 0.1, 3)
  if (newScale === oldScale) return

  const rect = dom.gCanvasContainer.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  // Zoom toward mouse position
  state.generate.panX = mx - (mx - state.generate.panX) * (newScale / oldScale)
  state.generate.panY = my - (my - state.generate.panY) * (newScale / oldScale)
  state.generate.scale = newScale

  updateCanvasTransform()
  updateZoomDisplay()
  renderConnectors()
}

function handleCanvasKeyDown(e) {
  if (state.activeView !== 'generate') return
  if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') return

  if ((e.key === 'Delete' || e.key === 'Backspace') && state.generate.selectedIds.length > 0) {
    e.preventDefault()
    for (const id of [...state.generate.selectedIds]) {
      deleteElement(id)
    }
    state.generate.selectedIds = []
    hideGenPanel()
    renderCanvas()
    saveRuntimeState()
  }
}

function showContextMenu(e, elementId) {
  const menu = dom.gContextMenu
  menu.classList.remove('hidden')
  menu.style.left = `${e.clientX}px`
  menu.style.top = `${e.clientY}px`
  menu.dataset.targetId = elementId

  // Rebind actions
  menu.replaceChildren()
  const el = state.generate.elements.find((item) => item.id === elementId)

  if (el?.type === 'image') {
    const genFrom = document.createElement('button')
    genFrom.type = 'button'
    genFrom.className = 'context-menu-item'
    genFrom.textContent = '用此图生成'
    genFrom.addEventListener('click', () => { connectFlow(elementId); hideContextMenu() })
    menu.append(genFrom)

    const download = document.createElement('button')
    download.type = 'button'
    download.className = 'context-menu-item'
    download.textContent = '下载图片'
    download.addEventListener('click', () => {
      if (el.content) downloadAsset(el.content, `canvas-${el.id}.png`)
      hideContextMenu()
    })
    menu.append(download)
  }

  const del = document.createElement('button')
  del.type = 'button'
  del.className = 'context-menu-item context-menu-danger'
  del.textContent = '删除'
  del.addEventListener('click', () => {
    deleteElement(elementId)
    state.generate.selectedIds = state.generate.selectedIds.filter((id) => id !== elementId)
    hideGenPanel()
    renderCanvas()
    saveRuntimeState()
    hideContextMenu()
  })
  menu.append(del)

  // Close on outside click
  const closeHandler = (ev) => {
    if (!menu.contains(ev.target)) {
      hideContextMenu()
      document.removeEventListener('click', closeHandler)
    }
  }
  setTimeout(() => document.addEventListener('click', closeHandler), 0)
}

function hideContextMenu() {
  dom.gContextMenu.classList.add('hidden')
}

function addImageToCanvas(dataUrl, name, x, y) {
  const cx = typeof x === 'number' ? x : (dom.gCanvasContainer.clientWidth / 2 - state.generate.panX) / state.generate.scale - 150
  const cy = typeof y === 'number' ? y : (dom.gCanvasContainer.clientHeight / 2 - state.generate.panY) / state.generate.scale - 150
  state.generate.elements.push({
    id: crypto.randomUUID(),
    type: 'image',
    x: cx,
    y: cy,
    width: 300,
    height: 300,
    content: dataUrl,
    name: name || 'image',
    assetId: '',
  })
}

function addTextToCanvas(x, y) {
  const cx = typeof x === 'number' ? x : (dom.gCanvasContainer.clientWidth / 2 - state.generate.panX) / state.generate.scale - 100
  const cy = typeof y === 'number' ? y : (dom.gCanvasContainer.clientHeight / 2 - state.generate.panY) / state.generate.scale - 20
  state.generate.elements.push({
    id: crypto.randomUUID(),
    type: 'text',
    x: cx,
    y: cy,
    width: 200,
    height: 40,
    content: '双击编辑文字',
  })
}

function addGeneratorToCanvas(x, y, refImageId) {
  const cx = typeof x === 'number' ? x : (dom.gCanvasContainer.clientWidth / 2 - state.generate.panX) / state.generate.scale - 150
  const cy = typeof y === 'number' ? y : (dom.gCanvasContainer.clientHeight / 2 - state.generate.panY) / state.generate.scale - 150
  const el = {
    id: crypto.randomUUID(),
    type: 'image-generator',
    x: cx,
    y: cy,
    width: 300,
    height: 300,
    content: '',
    referenceImageId: refImageId || null,
    generatingPrompt: '',
  }
  state.generate.elements.push(el)
  state.generate.selectedIds = [el.id]
  showGenPanel(el.id)
  return el
}

function connectFlow(sourceElementId) {
  const source = state.generate.elements.find((item) => item.id === sourceElementId)
  if (!source) return

  const gen = addGeneratorToCanvas(source.x + source.width + 80, source.y, sourceElementId)

  // Create connector
  state.generate.elements.push({
    id: crypto.randomUUID(),
    type: 'connector',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    content: '',
    connectorFrom: sourceElementId,
    connectorTo: gen.id,
  })

  // Auto-add the source image as a reference in gen panel
  if (source.type === 'image' && source.content) {
    state.generate.genRefs = [{
      assetId: source.assetId || '',
      dataUrl: source.content,
      role: 'subject',
      name: source.name || 'reference',
    }]
  }

  renderCanvas()
  saveRuntimeState()
}

function deleteElement(id) {
  // Remove connectors referencing this element
  state.generate.elements = state.generate.elements.filter((el) => {
    if (el.id === id) return false
    if (el.type === 'connector' && (el.connectorFrom === id || el.connectorTo === id)) return false
    return true
  })
}

function renderCanvas() {
  const elements = state.generate.elements.filter((el) => el.type !== 'connector')
  dom.gCanvasEmpty.classList.toggle('hidden', elements.length > 0)

  // Build a set of existing DOM el IDs
  const existingNodes = new Map()
  for (const node of $$('[data-el-id]', dom.gCanvas)) {
    existingNodes.set(node.dataset.elId, node)
  }

  const activeIds = new Set(elements.map((el) => el.id))

  // Remove nodes no longer in elements
  for (const [id, node] of existingNodes) {
    if (!activeIds.has(id)) node.remove()
  }

  // Add or update nodes
  for (const el of elements) {
    let node = existingNodes.get(el.id)
    if (!node) {
      node = renderCanvasElement(el)
      dom.gCanvas.append(node)
    }
    node.style.left = `${el.x}px`
    node.style.top = `${el.y}px`
    node.style.width = `${el.width}px`
    node.style.height = `${el.height}px`
    node.classList.toggle('selected', state.generate.selectedIds.includes(el.id))

    // Update image src if changed
    if (el.type === 'image') {
      const img = node.querySelector('.canvas-el-image')
      if (img && img.src !== el.content) img.src = el.content
    }
  }

  updateCanvasTransform()
  renderConnectors()
}

function renderCanvasElement(el) {
  const node = document.createElement('div')
  node.className = `canvas-el canvas-el-${el.type}`
  node.dataset.elId = el.id

  if (el.type === 'image') {
    const img = document.createElement('img')
    img.className = 'canvas-el-image'
    img.src = el.content || ''
    img.alt = el.name || 'image'
    img.draggable = false
    node.append(img)
  } else if (el.type === 'text') {
    const text = document.createElement('div')
    text.className = 'canvas-el-text'
    text.contentEditable = 'true'
    text.textContent = el.content || ''
    text.addEventListener('blur', () => {
      el.content = text.textContent || ''
      saveRuntimeState()
    })
    node.append(text)
  } else if (el.type === 'image-generator') {
    const placeholder = document.createElement('div')
    placeholder.className = 'canvas-el-generator'
    placeholder.innerHTML = '<span class="gen-icon">&#x2726;</span><span class="gen-label">AI 生图</span><span class="gen-hint">选中后设置参数并生成</span>'
    node.append(placeholder)
  }

  // Right-click
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    showContextMenu(e, el.id)
  })

  return node
}

function renderConnectors() {
  const svg = dom.gConnectors
  svg.innerHTML = ''
  const connectors = state.generate.elements.filter((el) => el.type === 'connector')
  for (const conn of connectors) {
    const from = state.generate.elements.find((item) => item.id === conn.connectorFrom)
    const to = state.generate.elements.find((item) => item.id === conn.connectorTo)
    if (!from || !to) continue

    const x1 = (from.x + from.width) * state.generate.scale + state.generate.panX
    const y1 = (from.y + from.height / 2) * state.generate.scale + state.generate.panY
    const x2 = to.x * state.generate.scale + state.generate.panX
    const y2 = (to.y + to.height / 2) * state.generate.scale + state.generate.panY

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('x1', x1)
    line.setAttribute('y1', y1)
    line.setAttribute('x2', x2)
    line.setAttribute('y2', y2)
    line.setAttribute('stroke', 'var(--accent)')
    line.setAttribute('stroke-width', '2')
    line.setAttribute('stroke-dasharray', '6 4')
    svg.append(line)
  }
}

/* ═══════════════ TOOLBAR ═══════════════ */

function bindToolbar() {
  for (const btn of $$('.toolbar-btn', dom.gToolbar)) {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool
      if (!tool) return
      setCanvasTool(tool)

      // 直接执行动作
      if (tool === 'image') {
        dom.gFileInput.click()
      } else if (tool === 'text') {
        addTextToCanvas()
        renderCanvas()
        saveRuntimeState()
      } else if (tool === 'ai-gen') {
        addGeneratorToCanvas()
        renderCanvas()
        saveRuntimeState()
      }
    })
  }

  dom.gFileInput.addEventListener('change', async () => {
    if (!dom.gFileInput.files?.length) return
    const images = await readImageFiles(dom.gFileInput.files)
    for (let i = 0; i < images.length; i++) {
      addImageToCanvas(images[i].dataUrl, images[i].name)
    }
    dom.gFileInput.value = ''
    renderCanvas()
    saveRuntimeState()
  })
}

function setCanvasTool(tool) {
  state.generate.activeTool = tool
  for (const btn of $$('.toolbar-btn', dom.gToolbar)) {
    btn.classList.toggle('active', btn.dataset.tool === tool)
  }
}

/* ═══════════════ ZOOM ═══════════════ */

function bindZoom() {
  dom.gZoomOut.addEventListener('click', () => {
    state.generate.scale = clamp(state.generate.scale - 0.1, 0.1, 3)
    updateCanvasTransform()
    updateZoomDisplay()
    renderConnectors()
  })
  dom.gZoomIn.addEventListener('click', () => {
    state.generate.scale = clamp(state.generate.scale + 0.1, 0.1, 3)
    updateCanvasTransform()
    updateZoomDisplay()
    renderConnectors()
  })
}

function updateZoomDisplay() {
  dom.gZoomValue.textContent = `${Math.round(state.generate.scale * 100)}%`
}

/* ═══════════════ GEN PANEL ═══════════════ */

function showGenPanel(elementId) {
  const el = state.generate.elements.find((item) => item.id === elementId)
  if (!el || el.type !== 'image-generator') return

  state.generate.genTargetId = elementId
  state.generate.genPrompt = el.generatingPrompt || ''

  // Populate refs from connected source image
  if (el.referenceImageId && state.generate.genRefs.length === 0) {
    const src = state.generate.elements.find((item) => item.id === el.referenceImageId)
    if (src?.type === 'image' && src.content) {
      state.generate.genRefs = [{
        assetId: src.assetId || '',
        dataUrl: src.content,
        role: 'subject',
        name: src.name || 'reference',
      }]
    }
  }

  dom.gGenPrompt.value = state.generate.genPrompt
  dom.gModel.value = state.generate.genModel
  dom.gGenRatio.value = state.generate.genRatio
  dom.gAgent.checked = state.generate.genUseAgent
  dom.gGenRun.disabled = false

  renderGenPanelRefs()
  dom.gGenPanel.classList.remove('hidden')
  dom.gGenProgress.classList.add('hidden')

  // Position panel near the element
  const rect = dom.gCanvasContainer.getBoundingClientRect()
  const elScreenX = el.x * state.generate.scale + state.generate.panX + rect.left + el.width * state.generate.scale + 16
  const elScreenY = el.y * state.generate.scale + state.generate.panY + rect.top
  dom.gGenPanel.style.left = `${clamp(elScreenX, rect.left, rect.right - 320)}px`
  dom.gGenPanel.style.top = `${clamp(elScreenY, rect.top, rect.bottom - 400)}px`
}

function hideGenPanel() {
  dom.gGenPanel.classList.add('hidden')
  state.generate.genTargetId = ''
}

function bindGenPanel() {
  dom.gGenPrompt.addEventListener('input', () => {
    state.generate.genPrompt = dom.gGenPrompt.value
    const el = state.generate.elements.find((item) => item.id === state.generate.genTargetId)
    if (el) el.generatingPrompt = dom.gGenPrompt.value
  })

  dom.gModel.addEventListener('change', () => {
    state.generate.genModel = dom.gModel.value
    state.generate.model = dom.gModel.value
    savePrefs()
  })

  dom.gGenRatio.addEventListener('change', () => {
    state.generate.genRatio = dom.gGenRatio.value
  })

  dom.gAgent.addEventListener('change', () => {
    state.generate.genUseAgent = dom.gAgent.checked
    savePrefs()
  })

  dom.gGenRefUpload.addEventListener('click', () => dom.gGenRefInput.click())
  dom.gGenRefInput.addEventListener('change', async () => {
    if (!dom.gGenRefInput.files?.length) return
    const images = await readImageFiles(dom.gGenRefInput.files)
    for (const img of images) {
      state.generate.genRefs.push({
        assetId: '',
        dataUrl: img.dataUrl,
        role: 'subject',
        name: img.name,
      })
    }
    dom.gGenRefInput.value = ''
    renderGenPanelRefs()
  })

  dom.gGenRun.addEventListener('click', executeCanvasGenerate)
}

function renderGenPanelRefs() {
  dom.gGenRefList.replaceChildren(...state.generate.genRefs.map((ref, i) => {
    const card = document.createElement('div')
    card.className = 'gen-panel-ref-thumb'

    const img = document.createElement('img')
    img.src = ref.dataUrl
    img.alt = ref.name || 'ref'
    card.append(img)

    const rm = document.createElement('button')
    rm.type = 'button'
    rm.className = 'gen-panel-ref-rm'
    rm.textContent = '×'
    rm.addEventListener('click', () => {
      state.generate.genRefs.splice(i, 1)
      renderGenPanelRefs()
    })
    card.append(rm)

    return card
  }))
}

async function executeCanvasGenerate() {
  const targetId = state.generate.genTargetId
  const el = state.generate.elements.find((item) => item.id === targetId)
  if (!el || state.generate.genRunning) return

  const prompt = state.generate.genPrompt.trim()
  if (!prompt) {
    dom.gGenPrompt.focus()
    return
  }

  state.generate.genRunning = true
  dom.gGenRun.disabled = true
  dom.gGenProgress.classList.remove('hidden')

  try {
    // Upload reference images if needed
    const refImages = []
    for (const ref of state.generate.genRefs) {
      if (ref.assetId) {
        refImages.push({ assetId: ref.assetId, role: ref.role || 'subject' })
      } else if (ref.dataUrl) {
        const uploaded = await postJson('/api/assets/upload', {
          sessionId: state.runtime.sessionId || undefined,
          kind: 'upload',
          source: 'browser_upload',
          filename: ref.name || 'reference.png',
          mime: 'image/png',
          dataUrl: ref.dataUrl,
        })
        state.runtime.sessionId = uploaded.sessionId || state.runtime.sessionId
        ref.assetId = uploaded.asset.id
        refImages.push({ assetId: uploaded.asset.id, role: ref.role || 'subject' })
      }
    }

    const data = await postJson('/api/generate-direct', {
      sessionId: state.runtime.sessionId || undefined,
      modelId: state.generate.genModel,
      prompt,
      referenceImages: refImages,
      aspectRatio: state.generate.genRatio,
      useDesignAgent: state.generate.genUseAgent,
      clientKeys: { ...state.keys },
    })

    state.runtime.sessionId = data.sessionId || state.runtime.sessionId

    // Replace generator with image element
    el.type = 'image'
    el.content = data.resultDataUrl
    el.name = `generated-${el.id}`

    state.generate.genRefs = []
    hideGenPanel()
  } catch (error) {
    dom.gGenProgress.innerHTML = `<span class="err">${trimError(error)}</span>`
    setTimeout(() => dom.gGenProgress.classList.add('hidden'), 3000)
  } finally {
    state.generate.genRunning = false
    dom.gGenRun.disabled = false
    dom.gGenProgress.classList.add('hidden')
    renderCanvas()
    saveRuntimeState()
  }
}

/* ═══════════════ AI SIDEBAR ═══════════════ */

function bindAiSidebar() {
  dom.gAiToggle.addEventListener('click', () => {
    state.generate.showAiPanel = !state.generate.showAiPanel
    dom.gAiSidebar.classList.toggle('hidden', !state.generate.showAiPanel)
  })
  dom.gAiClose.addEventListener('click', () => {
    state.generate.showAiPanel = false
    dom.gAiSidebar.classList.add('hidden')
  })

  dom.gSend.addEventListener('click', sendCanvasAiMessage)
  dom.gInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendCanvasAiMessage()
    }
  })

  // 模型选择
  dom.gAiModel.addEventListener('change', () => {
    state.generate.genModel = dom.gAiModel.value
    state.generate.model = dom.gAiModel.value
    dom.gModel.value = dom.gAiModel.value
    savePrefs()
  })

  // 比例选择
  dom.gAiRatio.addEventListener('change', () => {
    state.generate.genRatio = dom.gAiRatio.value
  })

  // 上传参考图
  dom.gAiUpload.addEventListener('click', () => dom.gAiFileInput.click())
  dom.gAiFileInput.addEventListener('change', async () => {
    if (!dom.gAiFileInput.files?.length) return
    const images = await readImageFiles(dom.gAiFileInput.files)
    for (const img of images) {
      state.generate.aiRefs.push({
        id: crypto.randomUUID(),
        dataUrl: img.dataUrl,
        name: img.name,
        assetId: '',
      })
    }
    dom.gAiFileInput.value = ''
    renderAiRefList()
  })
}

function renderAiRefList() {
  dom.gAiRefList.replaceChildren(...state.generate.aiRefs.map((ref, i) => {
    const card = document.createElement('div')
    card.className = 'ai-sidebar-ref-thumb'

    const img = document.createElement('img')
    img.src = ref.dataUrl
    img.alt = ref.name || 'ref'
    card.append(img)

    const rm = document.createElement('button')
    rm.type = 'button'
    rm.className = 'ai-sidebar-ref-rm'
    rm.textContent = '×'
    rm.addEventListener('click', () => {
      state.generate.aiRefs.splice(i, 1)
      renderAiRefList()
    })
    card.append(rm)

    return card
  }))
}

function renderAiMessages() {
  dom.gAiMessages.replaceChildren(...state.generate.aiMessages.map((msg) => {
    const node = document.createElement('div')
    node.className = `msg ${msg.role}`

    // 显示用户消息中附带的参考图
    if (msg.role === 'user' && msg.refs?.length) {
      const refsWrap = document.createElement('div')
      refsWrap.className = 'msg-images'
      refsWrap.style.marginBottom = '4px'
      for (const ref of msg.refs) {
        const img = document.createElement('img')
        img.src = ref.dataUrl
        img.alt = ref.name || 'ref'
        img.style.maxWidth = '60px'
        img.style.maxHeight = '60px'
        img.style.borderRadius = '6px'
        img.style.objectFit = 'cover'
        refsWrap.append(img)
      }
      node.append(refsWrap)
    }

    const bubble = document.createElement('div')
    bubble.className = 'msg-bubble'
    bubble.textContent = msg.content
    node.append(bubble)
    if (msg.imageDataUrl) {
      const imgWrap = document.createElement('div')
      imgWrap.className = 'msg-images'
      const img = document.createElement('img')
      img.className = 'msg-img'
      img.src = msg.imageDataUrl
      img.alt = '生成结果'
      img.style.maxWidth = '200px'
      img.style.borderRadius = '8px'
      img.style.cursor = 'pointer'
      img.addEventListener('click', () => openLightbox({ src: msg.imageDataUrl, caption: '生成结果' }))
      imgWrap.append(img)
      node.append(imgWrap)
    }
    return node
  }))
  dom.gAiMessages.scrollTop = dom.gAiMessages.scrollHeight
}

async function sendCanvasAiMessage() {
  if (state.generate.aiRunning) return
  const text = dom.gInput.value.trim()
  if (!text && state.generate.aiRefs.length === 0) return

  const userMsg = {
    id: crypto.randomUUID(),
    role: 'user',
    content: text || '基于参考图生成一版。',
    refs: state.generate.aiRefs.map((r) => ({ dataUrl: r.dataUrl, name: r.name })),
  }
  state.generate.aiMessages.push(userMsg)
  dom.gInput.value = ''
  state.generate.aiRunning = true
  state.generate.aiMessages.push({ id: crypto.randomUUID(), role: 'assistant', content: '正在生成…' })
  renderAiMessages()

  try {
    // 上传参考图
    const refImages = []
    for (const ref of state.generate.aiRefs) {
      if (ref.assetId) {
        refImages.push({ assetId: ref.assetId, role: 'subject' })
      } else if (ref.dataUrl) {
        const uploaded = await postJson('/api/assets/upload', {
          sessionId: state.runtime.sessionId || undefined,
          kind: 'upload',
          source: 'browser_upload',
          filename: ref.name || 'reference.png',
          mime: 'image/png',
          dataUrl: ref.dataUrl,
        })
        state.runtime.sessionId = uploaded.sessionId || state.runtime.sessionId
        ref.assetId = uploaded.asset.id
        refImages.push({ assetId: uploaded.asset.id, role: 'subject' })
      }
    }

    const data = await postJson('/api/generate-direct', {
      sessionId: state.runtime.sessionId || undefined,
      modelId: dom.gAiModel.value || state.generate.genModel,
      prompt: text || '基于参考图生成一版。',
      referenceImages: refImages,
      aspectRatio: dom.gAiRatio.value || state.generate.genRatio,
      useDesignAgent: state.generate.genUseAgent,
      clientKeys: { ...state.keys },
    })

    state.runtime.sessionId = data.sessionId || state.runtime.sessionId

    const lastMsg = state.generate.aiMessages[state.generate.aiMessages.length - 1]
    lastMsg.content = '已生成图片，已添加到画布。'
    lastMsg.imageDataUrl = data.resultDataUrl

    addImageToCanvas(data.resultDataUrl, `ai-${Date.now()}`)
    state.generate.aiRefs = []
    renderAiRefList()
    renderCanvas()
    saveRuntimeState()
  } catch (error) {
    const lastMsg = state.generate.aiMessages[state.generate.aiMessages.length - 1]
    lastMsg.content = `生成失败：${trimError(error)}`
  } finally {
    state.generate.aiRunning = false
    renderAiMessages()
  }
}

/* ═══════════════ RENDER GENERATE ═══════════════ */

function renderGenerate() {
  dom.gModel.value = state.generate.genModel
  dom.gAiModel.value = state.generate.genModel
  dom.gAgent.checked = state.generate.genUseAgent
  dom.gAiSidebar.classList.toggle('hidden', !state.generate.showAiPanel)
  renderCanvas()
  updateZoomDisplay()
}

function bindOutfit() {
  dom.oModel.addEventListener('change', () => {
    state.outfit.model = dom.oModel.value
    savePrefs()
    renderOutfit()
  })

  dom.oGarmentType.addEventListener('change', () => {
    state.outfit.garmentType = dom.oGarmentType.value
    savePrefs()
    renderOutfit()
  })

  dom.oConcurrency.addEventListener('change', () => {
    state.outfit.concurrency = clamp(Number(dom.oConcurrency.value) || 1, 1, 4)
    savePrefs()
    renderOutfit()
  })

  dom.oInstructions.addEventListener('input', () => {
    state.outfit.instructions = dom.oInstructions.value
    savePrefs()
  })

  dom.oModelAdd.addEventListener('click', () => {
    if (isOutfitBusy()) return
    dom.oModelInput.click()
  })

  dom.oGarmentAdd.addEventListener('click', () => {
    if (isOutfitBusy()) return
    dom.oGarmentInput.click()
  })

  bindDropSurface({
    surface: dom.oModelList.closest('.lane'),
    input: dom.oModelInput,
    onFiles: async (files) => {
      if (isOutfitBusy()) return
      const images = await prepareAssetItems(files)
      state.outfit.models.push(...images)
      pruneOutfitResults()
      saveRuntimeState()
      renderOutfit()
    },
    clickable: false,
  })

  bindDropSurface({
    surface: dom.oGarmentList.closest('.lane'),
    input: dom.oGarmentInput,
    onFiles: async (files) => {
      if (isOutfitBusy()) return
      const images = await prepareAssetItems(files)
      state.outfit.garments.push(...images.map((item) => ({
        ...item,
        role: state.outfit.garmentType,
      })))
      pruneOutfitResults()
      saveRuntimeState()
      renderOutfit()
    },
    clickable: false,
  })

  dom.oRun.addEventListener('click', runOutfitBatch)
  dom.oClear.addEventListener('click', () => {
    if (isOutfitBusy()) return
    outfitWatcherToken += 1
    state.outfit.jobId = ''
    state.outfit.results = {}
    state.outfit.progress = ''
    saveRuntimeState()
    renderOutfit()
  })
  dom.oDl.addEventListener('click', downloadOutfitResults)
}

function bindStyle() {
  dom.sModel.addEventListener('change', () => {
    state.style.model = dom.sModel.value
    savePrefs()
  })

  bindDropSurface({
    surface: dom.sDropzone,
    input: dom.sFileInput,
    onFiles: async (files) => {
      if (state.style.analyzing || state.style.generating) return
      const images = await readImageFiles(files)
      if (images.length === 0) return
      const image = images[0]
      const uploaded = await postJson('/api/assets/upload', {
        sessionId: state.runtime.sessionId || undefined,
        kind: 'upload',
        source: 'browser_upload',
        filename: image.name,
        mime: image.mime,
        dataUrl: image.dataUrl,
      })
      state.runtime.sessionId = uploaded.sessionId || state.runtime.sessionId
      state.style.sourceImage = {
        id: uploaded.asset.id,
        assetId: uploaded.asset.id,
        name: image.name,
        mime: image.mime,
        dataUrl: image.dataUrl,
        base64: image.base64,
      }
      state.style.visualStyle = null
      state.style.styleSummary = ''
      state.style.colorPalette = []
      state.style.tags = []
      state.style.resultDataUrl = ''
      state.style.error = ''
      saveRuntimeState()
      renderStyle()
      analyzeStyle()
    },
  })

  dom.sClearSource.addEventListener('click', () => {
    if (state.style.analyzing || state.style.generating) return
    state.style.sourceImage = null
    state.style.visualStyle = null
    state.style.styleSummary = ''
    state.style.colorPalette = []
    state.style.tags = []
    state.style.resultDataUrl = ''
    state.style.error = ''
    state.style.subject = ''
    state.style.subjectRefs = []
    saveRuntimeState()
    renderStyle()
  })

  dom.sRefAdd.addEventListener('click', () => {
    if (state.style.generating) return
    dom.sRefInput.click()
  })

  dom.sRefInput.addEventListener('change', async () => {
    if (!dom.sRefInput.files?.length || state.style.generating) return
    const images = await prepareAssetItems(dom.sRefInput.files)
    state.style.subjectRefs.push(...images)
    saveRuntimeState()
    renderStyle()
    dom.sRefInput.value = ''
  })

  dom.sSubject.addEventListener('input', () => {
    state.style.subject = dom.sSubject.value
    dom.sGenerate.disabled = (!state.style.subject.trim() && state.style.subjectRefs.length === 0) || state.style.generating || !state.style.visualStyle
  })

  dom.sGenerate.addEventListener('click', generateStyleTransfer)

  dom.sSubject.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      generateStyleTransfer()
    }
  })

  dom.sResultLightbox.addEventListener('click', () => {
    if (state.style.resultDataUrl) {
      openLightbox({
        src: state.style.resultDataUrl,
        caption: `风格迁移 · ${state.style.subject}`,
        downloadName: `style-transfer-${sanitizeFileName(state.style.subject || 'result')}.png`,
      })
    }
  })

  dom.sResultPreview.addEventListener('click', () => {
    if (state.style.resultDataUrl) {
      openLightbox({
        src: state.style.resultDataUrl,
        caption: `风格迁移 · ${state.style.subject}`,
        downloadName: `style-transfer-${sanitizeFileName(state.style.subject || 'result')}.png`,
      })
    }
  })

  dom.sDownload.addEventListener('click', () => {
    if (state.style.resultDataUrl) {
      downloadAsset(
        state.style.resultDataUrl,
        `style-transfer-${sanitizeFileName(state.style.subject || 'result')}.png`,
      )
    }
  })

  dom.sClearHistory.addEventListener('click', () => {
    state.style.history = []
    saveRuntimeState()
    renderStyle()
  })

  dom.sJsonCopy.addEventListener('click', () => {
    if (state.style.visualStyle) {
      const text = JSON.stringify(state.style.visualStyle, null, 2)
      navigator.clipboard?.writeText(text).then(() => {
        const original = dom.sJsonCopy.textContent
        dom.sJsonCopy.textContent = '已复制'
        setTimeout(() => { dom.sJsonCopy.textContent = original }, 1500)
      })
    }
  })
}

function renderStyle() {
  const s = state.style
  const busy = s.analyzing || s.generating

  dom.sModel.value = s.model
  dom.sModel.disabled = busy

  const hasSource = Boolean(s.sourceImage)
  const hasStyle = Boolean(s.visualStyle)
  const hasResult = Boolean(s.resultDataUrl)
  const hasHistory = s.history.length > 0

  dom.sDropzone.classList.toggle('hidden', hasSource)
  dom.sSourcePreview.classList.toggle('hidden', !hasSource)
  dom.sAnalyzeProgress.classList.toggle('hidden', !s.analyzing)
  dom.sStyleResult.classList.toggle('hidden', !hasStyle)
  dom.sGenerateSection.classList.toggle('hidden', !hasStyle)
  dom.sGenProgress.classList.toggle('hidden', !s.generating)
  dom.sResultWrap.classList.toggle('hidden', !hasResult)
  dom.sError.classList.toggle('hidden', !s.error)
  dom.sHistorySection.classList.toggle('hidden', !hasHistory)

  if (hasSource) {
    dom.sSourceImg.src = s.sourceImage.dataUrl
    dom.sClearSource.disabled = busy
  }

  if (hasStyle) {
    dom.sSummary.textContent = s.styleSummary || ''

    dom.sPalette.replaceChildren(...s.colorPalette.map((item) => {
      const swatch = document.createElement('button')
      swatch.type = 'button'
      swatch.className = 'style-swatch'
      swatch.title = `${item.hex} · ${item.role}`

      const colorDot = document.createElement('span')
      colorDot.className = 'style-swatch-color'
      colorDot.style.backgroundColor = item.hex
      swatch.append(colorDot)

      const label = document.createElement('span')
      label.textContent = item.hex
      swatch.append(label)

      swatch.addEventListener('click', () => {
        navigator.clipboard?.writeText(item.hex)
      })
      return swatch
    }))

    dom.sTags.replaceChildren(...s.tags.map((tag) => {
      const el = document.createElement('span')
      el.className = 'style-tag'
      el.textContent = tag
      return el
    }))

    dom.sJsonContent.textContent = JSON.stringify(s.visualStyle, null, 2)
  }

  dom.sRefAdd.disabled = !hasStyle || busy
  dom.sRefList.replaceChildren(...s.subjectRefs.map((ref) => {
    const thumb = document.createElement('div')
    thumb.className = 'style-ref-thumb'

    const img = document.createElement('img')
    img.src = ref.dataUrl
    img.alt = ref.name
    thumb.append(img)

    const rm = document.createElement('button')
    rm.type = 'button'
    rm.className = 'style-ref-thumb-rm'
    rm.textContent = '×'
    rm.disabled = busy
    rm.addEventListener('click', () => {
      if (busy) return
      state.style.subjectRefs = state.style.subjectRefs.filter((item) => item.id !== ref.id)
      saveRuntimeState()
      renderStyle()
    })
    thumb.append(rm)

    return thumb
  }))

  dom.sSubject.disabled = !hasStyle || busy
  dom.sSubject.value = s.subject
  dom.sGenerate.disabled = (!s.subject.trim() && s.subjectRefs.length === 0) || !hasStyle || busy

  if (hasResult) {
    dom.sResultImg.src = s.resultDataUrl
  }

  if (s.error) {
    dom.sError.textContent = s.error
  }

  dom.sHistory.replaceChildren(...s.history.slice().reverse().map((entry) => {
    const card = document.createElement('div')
    card.className = 'style-history-card'

    const img = document.createElement('img')
    img.src = entry.resultDataUrl
    img.alt = entry.subject || '生成结果'
    card.append(img)

    const meta = document.createElement('div')
    meta.className = 'style-history-meta'

    const subj = document.createElement('div')
    subj.className = 'style-history-subject'
    subj.textContent = entry.subject || '（无主题）'
    meta.append(subj)

    const time = document.createElement('div')
    time.className = 'style-history-time'
    time.textContent = formatTimestamp(entry.timestamp)
    meta.append(time)

    card.append(meta)

    card.addEventListener('click', () => {
      openLightbox({
        src: entry.resultDataUrl,
        caption: `风格迁移 · ${entry.subject || ''}`,
        downloadName: `style-transfer-${sanitizeFileName(entry.subject || 'result')}.png`,
      })
    })

    return card
  }))
}

async function analyzeStyle() {
  if (!state.style.sourceImage || state.style.analyzing) return

  state.style.analyzing = true
  state.style.error = ''
  renderStyle()

  try {
    const data = await postJson('/api/style-transfer', {
      action: 'analyze',
      sessionId: state.runtime.sessionId || undefined,
      assetId: state.style.sourceImage.assetId,
      clientKeys: { ...state.keys },
    })

    state.runtime.sessionId = data.sessionId || state.runtime.sessionId
    state.style.visualStyle = data.visualStyle
    state.style.styleSummary = data.styleSummary || ''
    state.style.colorPalette = Array.isArray(data.colorPalette) ? data.colorPalette : []
    state.style.tags = Array.isArray(data.tags) ? data.tags : []
    state.style.analyzing = false
    renderStyle()
  } catch (error) {
    state.style.analyzing = false
    state.style.error = trimError(error)
    renderStyle()
  }
}

async function generateStyleTransfer() {
  if (!state.style.visualStyle || state.style.generating) return
  if (!state.style.subject.trim() && state.style.subjectRefs.length === 0) return

  state.style.generating = true
  state.style.resultDataUrl = ''
  state.style.error = ''
  renderStyle()

  try {
    const data = await postJson('/api/style-transfer', {
      action: 'generate',
      sessionId: state.runtime.sessionId || undefined,
      assetId: state.style.sourceImage?.assetId || '',
      visualStyle: state.style.visualStyle,
      subject: state.style.subject.trim(),
      subjectAssetIds: state.style.subjectRefs.map((ref) => ref.assetId || ref.id),
      modelId: state.style.model,
      clientKeys: { ...state.keys },
    })

    state.runtime.sessionId = data.sessionId || state.runtime.sessionId
    state.style.resultDataUrl = data.resultDataUrl
    state.style.generating = false

    state.style.history.push({
      id: crypto.randomUUID(),
      subject: state.style.subject.trim() || state.style.subjectRefs.map((r) => basename(r.name)).join(', '),
      resultDataUrl: data.resultDataUrl,
      timestamp: Date.now(),
    })

    saveRuntimeState()
    renderStyle()
  } catch (error) {
    state.style.generating = false
    state.style.error = trimError(error)
    renderStyle()
  }
}

function renderAll() {
  renderShell()
  renderTranslateDropdowns()
  renderTranslate()
  renderGenerate()
  renderOutfit()
  renderStyle()
}

function renderShell() {
  document.body.dataset.view = state.activeView

  for (const button of dom.navItems) {
    button.classList.toggle('active', button.dataset.view === state.activeView)
  }

  for (const view of dom.views) {
    view.classList.toggle('active', view.id === `view-${state.activeView}`)
  }
}

function bindLightbox() {
  dom.lightboxDownload.addEventListener('click', async (event) => {
    event.preventDefault()
    if (!dom.lightboxDownload.href) return
    await downloadAsset(dom.lightboxDownload.href, dom.lightboxDownload.download || 'image.png')
  })

  dom.lightbox.addEventListener('click', (event) => {
    if (event.target === dom.lightbox) {
      dom.lightbox.close()
    }
  })

  dom.lightboxClose.addEventListener('click', () => {
    dom.lightbox.close()
  })
}

function renderTranslateDropdowns() {
  renderSourceDropdown()
  renderTargetDropdown()
}

function renderSourceDropdown() {
  const current = getLanguage(state.translate.source) || LANGUAGES[0]
  dom.sourceValue.textContent = current.label
  dom.sourceMenu.replaceChildren(...LANGUAGES.map((language) => {
    const button = createDropdownItem({
      primary: language.label,
      secondary: language.nativeLabel,
      selected: language.code === state.translate.source,
      multiple: false,
    })
    button.dataset.code = language.code
    return button
  }))
}

function renderTargetDropdown() {
  const selected = state.translate.targets
    .map((code) => getLanguage(code))
    .filter(Boolean)

  dom.targetValue.textContent = selected.length === 0
    ? '点击选择…'
    : selected.length <= 2
      ? selected.map((item) => item.label).join(' · ')
      : `已选 ${selected.length} 种语言`

  dom.targetMenu.replaceChildren(...TARGET_LANGUAGES.map((language) => {
    const button = createDropdownItem({
      primary: language.label,
      secondary: language.nativeLabel,
      selected: state.translate.targets.includes(language.code),
      multiple: true,
    })
    button.dataset.code = language.code
    return button
  }))

  dom.targetChips.replaceChildren(...selected.map((language) => {
    const chip = document.createElement('span')
    chip.className = 'chip'

    const text = document.createElement('span')
    text.textContent = language.label
    chip.append(text)

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'chip-rm'
    remove.textContent = '×'
    remove.title = `移除 ${language.label}`
    remove.addEventListener('click', () => toggleTargetLanguage(language.code))
    chip.append(remove)

    return chip
  }))
}

function renderTranslate() {
  const busy = isTranslateBusy()
  dom.tModel.value = state.translate.model
  dom.tConcurrency.value = String(state.translate.concurrency)
  dom.tPreserve.checked = state.translate.preserveBrand
  dom.tProgress.textContent = state.translate.progress

  const hasItems = state.translate.items.length > 0
  const hasFinished = state.translate.items.some((item) =>
    Object.values(item.results).some((result) => result?.status === 'done'),
  )

  dom.tRunBtn.disabled = busy || !hasItems || state.translate.targets.length === 0
  dom.tClearBtn.disabled = busy || !hasItems
  dom.tDlBtn.disabled = !hasFinished
  dom.tModel.disabled = busy
  dom.tConcurrency.disabled = busy
  dom.tPreserve.disabled = busy
  dom.tDropzone.classList.toggle('disabled', busy)
  dom.tEmpty.classList.toggle('hidden', hasItems)

  if (!hasItems) {
    dom.tGrid.replaceChildren()
    return
  }

  const signature = getTranslateSignature({
    sourceLanguage: state.translate.source,
    modelId: state.translate.model,
    preserveBrand: state.translate.preserveBrand,
  })

  const thead = document.createElement('thead')
  const headRow = document.createElement('tr')
  headRow.append(createHeaderCell('原图'))
  for (const code of state.translate.targets) {
    const language = getLanguage(code)
    headRow.append(createHeaderCell(language?.label || code))
  }
  headRow.append(createHeaderCell(''))
  thead.append(headRow)

  const tbody = document.createElement('tbody')
  for (const item of state.translate.items) {
    const row = document.createElement('tr')
    row.append(createImageLabelCell(item))

    for (const code of state.translate.targets) {
      row.append(createTranslateResultCell(item, code, signature))
    }

    const removeCell = document.createElement('td')
    const removeButton = document.createElement('button')
    removeButton.type = 'button'
    removeButton.className = 'row-rm'
    removeButton.textContent = '✕'
    removeButton.disabled = busy
    removeButton.title = '移除图片'
    removeButton.addEventListener('click', () => {
      if (busy) return
      state.translate.items = state.translate.items.filter((entry) => entry.id !== item.id)
      saveRuntimeState()
      renderTranslate()
    })
    removeCell.append(removeButton)
    row.append(removeCell)

    tbody.append(row)
  }

  dom.tGrid.replaceChildren(thead, tbody)
}

function renderOutfit() {
  const busy = isOutfitBusy()
  const looks = buildOutfitLooks()
  dom.oModel.value = state.outfit.model
  dom.oGarmentType.value = state.outfit.garmentType
  dom.oConcurrency.value = String(state.outfit.concurrency)
  dom.oInstructions.value = state.outfit.instructions
  dom.oProgress.textContent = state.outfit.progress
  dom.oModelCount.textContent = String(state.outfit.models.length)
  dom.oGarmentCount.textContent = String(state.outfit.garments.length)
  dom.oLookCount.textContent = String(looks.length)
  dom.oRun.disabled = busy || state.outfit.models.length === 0 || looks.length === 0
  dom.oClear.disabled = busy || !Object.keys(state.outfit.results).length
  dom.oDl.disabled = !Object.values(state.outfit.results).some((item) => item?.status === 'done')
  dom.oModel.disabled = busy
  dom.oGarmentType.disabled = busy
  dom.oConcurrency.disabled = busy
  dom.oInstructions.disabled = busy
  dom.oModelAdd.disabled = busy
  dom.oGarmentAdd.disabled = busy

  renderLaneList(dom.oModelList, state.outfit.models, 'model')
  renderLaneList(dom.oGarmentList, state.outfit.garments, 'garment')

  const hasMatrix = state.outfit.models.length > 0 && looks.length > 0
  dom.oEmpty.classList.toggle('hidden', hasMatrix)

  if (!hasMatrix) {
    dom.oGrid.replaceChildren()
    return
  }

  const signature = getOutfitSignature({
    modelId: state.outfit.model,
    garmentRoles: getOutfitRoleFingerprint(),
    instructions: state.outfit.instructions.trim(),
  })

  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  headerRow.append(createHeaderCell('模特 / 搭配'))
  for (const look of looks) {
    headerRow.append(createOutfitLookHeaderCell(look))
  }
  thead.append(headerRow)

  const tbody = document.createElement('tbody')
  for (const model of state.outfit.models) {
    const row = document.createElement('tr')
    row.append(createVisualHeaderCell(model))
    for (const look of looks) {
      row.append(createOutfitResultCell(model, look, signature))
    }
    tbody.append(row)
  }

  dom.oGrid.replaceChildren(thead, tbody)
}

function renderLaneList(container, items, kind) {
  const busy = isOutfitBusy()
  container.replaceChildren(...items.map((item) => {
    const node = document.createElement('div')
    node.className = `lane-thumb${kind === 'garment' ? ' lane-thumb-garment' : ''}`

    const image = document.createElement('img')
    image.src = item.dataUrl
    image.alt = item.name
    node.append(image)

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'lane-thumb-rm'
    remove.textContent = '×'
    remove.title = '移除'
    remove.disabled = busy
    remove.addEventListener('click', () => {
      if (busy) return
      if (kind === 'model') {
        state.outfit.models = state.outfit.models.filter((entry) => entry.id !== item.id)
      } else {
        state.outfit.garments = state.outfit.garments.filter((entry) => entry.id !== item.id)
      }
      pruneOutfitResults()
      saveRuntimeState()
      renderOutfit()
    })
    node.append(remove)

    if (kind === 'garment') {
      const roleSelect = document.createElement('select')
      roleSelect.className = 'lane-role-sel'
      roleSelect.disabled = busy
      for (const role of GARMENT_ROLE_OPTIONS) {
        const option = document.createElement('option')
        option.value = role.value
        option.textContent = role.label
        option.selected = (item.role || 'full_outfit') === role.value
        roleSelect.append(option)
      }
      roleSelect.addEventListener('change', () => {
        item.role = roleSelect.value
        pruneOutfitResults()
        saveRuntimeState()
        renderOutfit()
      })
      node.append(roleSelect)
    }

    const caption = document.createElement('div')
    caption.className = 'lane-name'
    caption.textContent = basename(item.name)
    node.append(caption)

    return node
  }))
}

async function runTranslateBatch() {
  if (isTranslateBusy() || state.translate.targets.length === 0 || state.translate.items.length === 0) return

  const runConfig = getTranslateRunConfig()
  const signature = getTranslateSignature(runConfig)
  const needsWork = state.translate.items.some((item) =>
    state.translate.targets.some((language) => {
      const existing = item.results[language]
      return !(existing?.status === 'done' && existing.signature === signature)
    }),
  )

  if (!needsWork) {
    state.translate.progress = '当前参数下已全部完成'
    renderTranslate()
    return
  }

  try {
    state.translate.running = true
    state.translate.progress = '正在提交翻译任务…'
    renderTranslate()

    const data = await postJson('/api/jobs/translate-batch', {
      sessionId: state.runtime.sessionId || undefined,
      assetIds: state.translate.items.map((item) => item.assetId || item.id),
      targetLanguages: state.translate.targets,
      sourceLanguage: runConfig.sourceLanguage,
      modelId: runConfig.modelId,
      preserveBrand: runConfig.preserveBrand,
      concurrency: state.translate.concurrency,
      clientKeys: runConfig.clientKeys,
    })

    state.runtime.sessionId = data.sessionId || state.runtime.sessionId
    state.translate.jobId = data.jobId
    saveRuntimeState()
    await syncTranslateJob(data.jobId)
  } catch (error) {
    state.translate.running = false
    state.translate.progress = trimError(error)
    renderTranslate()
  }
}

async function runOutfitBatch() {
  const looks = buildOutfitLooks()
  if (isOutfitBusy() || state.outfit.models.length === 0 || looks.length === 0) return

  const runConfig = getOutfitRunConfig()
  const signature = getOutfitSignature(runConfig)
  const needsWork = state.outfit.models.some((model) =>
    looks.some((look) => {
      const existing = state.outfit.results[pairKey(model.id, look.id)]
      return !(existing?.status === 'done' && existing.signature === signature)
    }),
  )

  if (!needsWork) {
    state.outfit.progress = '当前参数下已全部完成'
    renderOutfit()
    return
  }

  try {
    state.outfit.running = true
    state.outfit.progress = '正在提交换装任务…'
    renderOutfit()

    const data = await postJson('/api/jobs/outfit-batch', {
      sessionId: state.runtime.sessionId || undefined,
      modelAssetIds: state.outfit.models.map((item) => item.assetId || item.id),
      garments: state.outfit.garments.map((item) => ({
        assetId: item.assetId || item.id,
        role: item.role || 'full_outfit',
        label: basename(item.name),
      })),
      modelId: runConfig.modelId,
      instructions: runConfig.instructions,
      concurrency: state.outfit.concurrency,
      clientKeys: runConfig.clientKeys,
    })

    state.runtime.sessionId = data.sessionId || state.runtime.sessionId
    state.outfit.jobId = data.jobId
    saveRuntimeState()
    await syncOutfitJob(data.jobId)
  } catch (error) {
    state.outfit.running = false
    state.outfit.progress = trimError(error)
    renderOutfit()
  }
}

function getTranslateRunConfig() {
  return {
    sourceLanguage: state.translate.source,
    modelId: state.translate.model,
    preserveBrand: state.translate.preserveBrand,
    clientKeys: { ...state.keys },
  }
}

function getOutfitRunConfig() {
  return {
    modelId: state.outfit.model,
    garmentRoles: getOutfitRoleFingerprint(),
    instructions: state.outfit.instructions.trim(),
    clientKeys: { ...state.keys },
  }
}

async function executeTranslateJob({ item, language, runConfig, signature }) {
  try {
    const { result: data, attempts } = await withAutoRetry((attempt) => {
      item.results[language] = { status: 'running', signature, attempt }
      renderTranslate()
      return postJson('/api/translate', {
        imageBase64: item.base64,
        mime: item.mime,
        targetLanguage: language,
        ...runConfig,
      })
    }, {
      onRetry: (nextAttempt) => {
        item.results[language] = { status: 'running', signature, attempt: nextAttempt }
        state.translate.progress = `${basename(item.name)} · ${getLanguage(language)?.label || language} 自动补偿中`
        renderTranslate()
      },
    })

    item.results[language] = {
      status: 'done',
      dataUrl: data.resultDataUrl,
      ocr: data.ocr || null,
      signature,
      attempts,
    }
    renderTranslate()
    return data
  } catch (error) {
    item.results[language] = {
      status: 'error',
      error: trimError(error),
      signature,
      attempts: error?.attempts || 1,
    }
    renderTranslate()
    throw error
  }
}

async function executeOutfitJob({ model, look, key, runConfig, signature }) {
  try {
    const { result: data, attempts } = await withAutoRetry((attempt) => {
      state.outfit.results[key] = { status: 'running', signature, attempt }
      renderOutfit()
      return postJson('/api/outfit-swap', {
        modelId: runConfig.modelId,
        model: { base64: model.base64, mime: model.mime },
        garments: look.items.map((garment) => ({
          base64: garment.base64,
          mime: garment.mime,
          role: garment.role,
          label: basename(garment.name),
        })),
        instructions: runConfig.instructions,
        clientKeys: runConfig.clientKeys,
      })
    }, {
      onRetry: (nextAttempt) => {
        state.outfit.results[key] = { status: 'running', signature, attempt: nextAttempt }
        state.outfit.progress = `${basename(model.name)} · ${look.label} 自动补偿中`
        renderOutfit()
      },
    })

    state.outfit.results[key] = {
      status: 'done',
      dataUrl: data.resultDataUrl,
      signature,
      attempts,
    }
    renderOutfit()
    return data
  } catch (error) {
    state.outfit.results[key] = {
      status: 'error',
      error: trimError(error),
      signature,
      attempts: error?.attempts || 1,
    }
    renderOutfit()
    throw error
  }
}

async function retryTranslateJob(itemId, language) {
  if (isTranslateBusy()) return
  const item = state.translate.items.find((entry) => entry.id === itemId)
  if (!item) return
  const result = item.results?.[language]
  if (!state.translate.jobId || !result?.itemId) {
    await runTranslateBatch()
    return
  }

  state.translate.running = true
  state.translate.progress = `${basename(item.name)} · ${getLanguage(language)?.label || language} 重试中`
  renderTranslate()

  try {
    await postJson(`/api/jobs/${encodeURIComponent(state.translate.jobId)}/items/${encodeURIComponent(result.itemId)}/retry`, {})
    await syncTranslateJob(state.translate.jobId)
  } catch (error) {
    state.translate.running = false
    state.translate.progress = trimError(error)
    renderTranslate()
  }
}

async function retryOutfitJob(modelId, lookId) {
  if (isOutfitBusy()) return
  const model = state.outfit.models.find((entry) => entry.id === modelId)
  const look = buildOutfitLooks().find((entry) => entry.id === lookId)
  const result = state.outfit.results[pairKey(modelId, lookId)]
  if (!model || !look) return

  if (!state.outfit.jobId || !result?.itemId) {
    await runOutfitBatch()
    return
  }

  state.outfit.running = true
  state.outfit.progress = `${basename(model.name)} · ${look.label} 重试中`
  renderOutfit()

  try {
    await postJson(`/api/jobs/${encodeURIComponent(state.outfit.jobId)}/items/${encodeURIComponent(result.itemId)}/retry`, {})
    await syncOutfitJob(state.outfit.jobId)
  } catch (error) {
    state.outfit.running = false
    state.outfit.progress = trimError(error)
    renderOutfit()
  }
}

function openLightbox({ src, caption = '', downloadName = 'image.png' }) {
  if (!src) return

  dom.lightboxImage.src = src
  dom.lightboxCaption.textContent = caption
  dom.lightboxDownload.href = src
  dom.lightboxDownload.download = downloadName

  if (!dom.lightbox.open) {
    dom.lightbox.showModal()
  }
}

function createPreviewButton({
  src,
  alt,
  caption = '',
  downloadName = 'image.png',
  className = 'img-button',
  imageClassName = '',
}) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.disabled = !src

  const image = document.createElement('img')
  image.src = src || ''
  image.alt = alt || ''
  if (imageClassName) {
    image.className = imageClassName
  }
  button.append(image)

  button.addEventListener('click', () => {
    openLightbox({ src, caption, downloadName })
  })

  return button
}

async function withAutoRetry(task, { retries = AUTO_RETRY_LIMIT, onRetry = null } = {}) {
  let attempt = 0

  while (attempt <= retries) {
    attempt += 1
    try {
      const result = await task(attempt)
      return { result, attempts: attempt }
    } catch (error) {
      error.attempts = attempt
      if (attempt > retries || !shouldAutoRetry(error)) {
        throw error
      }
      onRetry?.(attempt + 1, error)
      await wait(AUTO_RETRY_DELAY_MS * attempt)
    }
  }

  throw new Error('Retry loop exhausted')
}

function shouldAutoRetry(error) {
  const status = Number(error?.status || 0)
  if (!status) return true
  return status >= 500 || status === 408 || status === 409 || status === 425 || status === 429
}

function isTranslateBusy() {
  return state.translate.running || state.translate.items.some((item) =>
    Object.values(item.results).some((result) => result?.status === 'queue' || result?.status === 'running'),
  )
}

function isOutfitBusy() {
  return state.outfit.running || Object.values(state.outfit.results).some((result) =>
    result?.status === 'queue' || result?.status === 'running',
  )
}

function getRunningLabel(base, attempt = 1) {
  return attempt > 1 ? `${base} · 自动补偿第 ${attempt - 1} 次` : base
}

function getFailureLabel(base, attempts = 1) {
  return attempts > 1 ? `${base} · 已自动补偿 ${attempts - 1} 次` : base
}

async function downloadTranslateResults() {
  const entries = []
  for (const item of state.translate.items) {
    for (const [language, result] of Object.entries(item.results)) {
      if (result?.status !== 'done') continue
      entries.push({
        href: result.dataUrl,
        name: `${sanitizeFileName(basename(item.name))}.${language}.png`,
      })
    }
  }
  await downloadAll(entries)
}

async function downloadOutfitResults() {
  const looks = buildOutfitLooks()
  const entries = []
  for (const model of state.outfit.models) {
    for (const look of looks) {
      const result = state.outfit.results[pairKey(model.id, look.id)]
      if (result?.status !== 'done') continue
      entries.push({
        href: result.dataUrl,
        name: `${sanitizeFileName(basename(model.name))}__${sanitizeFileName(getOutfitLookFileLabel(look))}.png`,
      })
    }
  }
  await downloadAll(entries)
}

function createHeaderCell(text) {
  const cell = document.createElement('th')
  cell.textContent = text
  return cell
}

function createVisualHeaderCell(item) {
  const cell = document.createElement('th')
  cell.className = 'matrix-head'

  cell.append(createPreviewButton({
    src: item.dataUrl,
    alt: item.name,
    caption: basename(item.name),
    downloadName: `${sanitizeFileName(basename(item.name))}.png`,
    className: 'img-button',
    imageClassName: 'matrix-thumb',
  }))

  const label = document.createElement('div')
  label.className = 'matrix-label'
  label.textContent = basename(item.name)
  cell.append(label)

  return cell
}

function createOutfitLookHeaderCell(look) {
  const cell = document.createElement('th')
  cell.className = 'matrix-head matrix-head-look'

  cell.append(createPreviewButton({
    src: look.items[0]?.dataUrl || '',
    alt: look.label,
    caption: look.label,
    downloadName: `${sanitizeFileName(getOutfitLookFileLabel(look))}.png`,
    className: 'img-button',
    imageClassName: 'matrix-thumb',
  }))

  const label = document.createElement('div')
  label.className = 'matrix-label'
  label.textContent = look.label
  cell.append(label)

  const meta = document.createElement('div')
  meta.className = 'matrix-meta'
  meta.textContent = look.roles.map((role) => getGarmentRoleLabel(role)).join(' + ')
  cell.append(meta)

  return cell
}

function createImageLabelCell(item) {
  const cell = document.createElement('td')

  cell.append(createPreviewButton({
    src: item.dataUrl,
    alt: item.name,
    caption: basename(item.name),
    downloadName: `${sanitizeFileName(basename(item.name))}.png`,
    className: 'img-button',
    imageClassName: 'thumb',
  }))

  const name = document.createElement('div')
  name.className = 'grid-meta'
  name.textContent = basename(item.name)
  cell.append(name)

  return cell
}

function createTranslateResultCell(item, language, signature) {
  const cell = document.createElement('td')
  cell.className = 'cell'
  const result = item.results[language]

  if (!result) {
    cell.append(createStatusLine('待处理'))
    return cell
  }

  if (result.status === 'queue') {
    cell.append(createStatusLine('排队中…'))
    return cell
  }

  if (result.status === 'running') {
    cell.append(createStatusLine(getRunningLabel('翻译中…', result.attempt), 'run', true))
    return cell
  }

  if (result.status === 'error') {
    cell.append(createStatusLine(getFailureLabel('生成失败', result.attempts), 'err'))
    const tip = document.createElement('div')
    tip.className = 'err-tip'
    tip.textContent = result.error || ''
    cell.append(tip)

    const actions = document.createElement('div')
    actions.className = 'cell-actions'

    const retry = document.createElement('button')
    retry.type = 'button'
    retry.className = 'retry-btn'
    retry.textContent = '重试'
    retry.disabled = isTranslateBusy()
    retry.addEventListener('click', () => {
      retryTranslateJob(item.id, language)
    })
    actions.append(retry)

    cell.append(actions)
    return cell
  }

  const wrap = document.createElement('div')
  wrap.className = 'img-wrap'
  wrap.append(createPreviewButton({
    src: result.dataUrl,
    alt: `${item.name}-${language}`,
    caption: `${basename(item.name)} · ${getLanguage(language)?.label || language}`,
    downloadName: `${sanitizeFileName(basename(item.name))}.${language}.png`,
    className: 'img-button',
  }))
  cell.append(wrap)

  const details = []
  if (result.ocr) {
    details.push(`OCR ${result.ocr.textCount} 处`)
    details.push(`保留 ${result.ocr.keepCount}`)
    details.push(`翻译 ${result.ocr.translateCount}`)
  } else {
    details.push('已生成')
  }
  if (result.attempts > 1) {
    details.push(`自动补偿 ${result.attempts - 1} 次`)
  }
  if (result.signature !== signature) {
    details.push('旧参数结果')
  }

  cell.append(createStatusLine(details.join(' · '), result.signature === signature ? 'ok' : ''))

  const actions = document.createElement('div')
  actions.className = 'cell-actions'

  const preview = document.createElement('button')
  preview.type = 'button'
  preview.className = 'retry-btn'
  preview.textContent = '放大查看'
  preview.addEventListener('click', () => {
    openLightbox({
      src: result.dataUrl,
      caption: `${basename(item.name)} · ${getLanguage(language)?.label || language}`,
      downloadName: `${sanitizeFileName(basename(item.name))}.${language}.png`,
    })
  })
  actions.append(preview)

  const download = document.createElement('button')
  download.type = 'button'
  download.className = 'download'
  download.textContent = '下载'
  download.addEventListener('click', () => {
    downloadAsset(
      result.dataUrl,
      `${sanitizeFileName(basename(item.name))}.${language}.png`,
    )
  })
  actions.append(download)

  cell.append(actions)

  return cell
}

function createOutfitResultCell(model, look, signature) {
  const cell = document.createElement('td')
  cell.className = 'cell'
  const result = state.outfit.results[pairKey(model.id, look.id)]

  if (!result) {
    cell.append(createStatusLine('待生成'))
    return cell
  }

  if (result.status === 'queue') {
    cell.append(createStatusLine('排队中…'))
    return cell
  }

  if (result.status === 'running') {
    cell.append(createStatusLine(getRunningLabel('换装中…', result.attempt), 'run', true))
    return cell
  }

  if (result.status === 'error') {
    cell.append(createStatusLine(getFailureLabel('换装失败', result.attempts), 'err'))
    const tip = document.createElement('div')
    tip.className = 'err-tip'
    tip.textContent = result.error || ''
    cell.append(tip)

    const actions = document.createElement('div')
    actions.className = 'cell-actions'

    const retry = document.createElement('button')
    retry.type = 'button'
    retry.className = 'retry-btn'
    retry.textContent = '重试'
    retry.disabled = isOutfitBusy()
    retry.addEventListener('click', () => {
      retryOutfitJob(model.id, look.id)
    })
    actions.append(retry)

    cell.append(actions)
    return cell
  }

  const wrap = document.createElement('div')
  wrap.className = 'img-wrap'
  wrap.append(createPreviewButton({
    src: result.dataUrl,
    alt: `${model.name}-${look.label}`,
    caption: `${basename(model.name)} · ${look.label}`,
    downloadName: `${sanitizeFileName(basename(model.name))}__${sanitizeFileName(getOutfitLookFileLabel(look))}.png`,
    className: 'img-button',
  }))
  cell.append(wrap)

  const meta = result.signature === signature
    ? `已完成 · ${look.items.length} 件搭配${result.attempts > 1 ? ` · 自动补偿 ${result.attempts - 1} 次` : ''}`
    : '旧参数结果'
  cell.append(createStatusLine(meta, result.signature === signature ? 'ok' : ''))

  const actions = document.createElement('div')
  actions.className = 'cell-actions'

  const preview = document.createElement('button')
  preview.type = 'button'
  preview.className = 'retry-btn'
  preview.textContent = '放大查看'
  preview.addEventListener('click', () => {
    openLightbox({
      src: result.dataUrl,
      caption: `${basename(model.name)} · ${look.label}`,
      downloadName: `${sanitizeFileName(basename(model.name))}__${sanitizeFileName(getOutfitLookFileLabel(look))}.png`,
    })
  })
  actions.append(preview)

  const download = document.createElement('button')
  download.type = 'button'
  download.className = 'download'
  download.textContent = '下载'
  download.addEventListener('click', () => {
    downloadAsset(
      result.dataUrl,
      `${sanitizeFileName(basename(model.name))}__${sanitizeFileName(getOutfitLookFileLabel(look))}.png`,
    )
  })
  actions.append(download)

  cell.append(actions)

  return cell
}

function createStatusLine(text, tone = '', spinning = false) {
  const line = document.createElement('div')
  line.className = `status${tone ? ` ${tone}` : ''}`
  if (spinning) {
    const spinner = document.createElement('span')
    spinner.className = 'spinner'
    line.append(spinner)
  }
  line.append(document.createTextNode(text))
  return line
}

function toggleTargetLanguage(code) {
  if (state.translate.targets.includes(code)) {
    state.translate.targets = state.translate.targets.filter((item) => item !== code)
  } else {
    state.translate.targets = [...state.translate.targets, code]
  }
  savePrefs()
  renderTranslateDropdowns()
  renderTranslate()
}

function setActiveView(view) {
  state.activeView = normalizeView(view)
  savePrefs()
  renderShell()
  const scrollToTop = () => {
    $('.main')?.scrollTo({ top: 0, behavior: 'auto' })
    window.scrollTo({ top: 0, behavior: 'auto' })
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }
  scrollToTop()
  requestAnimationFrame(scrollToTop)
}

function toggleDropdown(name) {
  state.openDropdown = state.openDropdown === name ? null : name
  dom.sourceDropdown.classList.toggle('open', state.openDropdown === 'source')
  dom.targetDropdown.classList.toggle('open', state.openDropdown === 'target')
}

function closeDropdowns() {
  state.openDropdown = null
  dom.sourceDropdown.classList.remove('open')
  dom.targetDropdown.classList.remove('open')
}

function populateModelSelects() {
  for (const select of [dom.tModel, dom.gModel, dom.oModel, dom.sModel, dom.gAiModel]) {
    select.replaceChildren(...MODEL_OPTIONS.map((model) => {
      const option = document.createElement('option')
      option.value = model.id
      option.textContent = `${model.label} · ${model.hint}`
      return option
    }))
  }
}

function bindDropSurface({ surface, input, onFiles, onClick = null, clickable = true }) {
  if (clickable) {
    surface.addEventListener('click', () => {
      if (onClick && !onClick()) return
      input.click()
    })
  }

  input.addEventListener('change', async () => {
    if (!input.files?.length) return
    await onFiles(input.files)
    input.value = ''
  })

  for (const eventName of ['dragenter', 'dragover']) {
    surface.addEventListener(eventName, (event) => {
      event.preventDefault()
      surface.classList.add('drag')
    })
  }

  for (const eventName of ['dragleave', 'drop']) {
    surface.addEventListener(eventName, (event) => {
      event.preventDefault()
      surface.classList.remove('drag')
    })
  }

  surface.addEventListener('drop', async (event) => {
    if (!event.dataTransfer?.files?.length) return
    await onFiles(event.dataTransfer.files)
  })
}

async function readImageFiles(fileList) {
  const files = Array.from(fileList).filter((file) => file.type.startsWith('image/'))
  const images = []
  for (const file of files) {
    const data = await readAsDataUrl(file)
    images.push({
      id: crypto.randomUUID(),
      name: file.name,
      mime: file.type || 'image/jpeg',
      base64: data.base64,
      dataUrl: data.dataUrl,
    })
  }
  return images
}

async function prepareAssetItems(fileList, { kind = 'upload', source = 'browser_upload' } = {}) {
  const images = await readImageFiles(fileList)
  const uploaded = []

  for (const image of images) {
    const data = await postJson('/api/assets/upload', {
      sessionId: state.runtime.sessionId || undefined,
      kind,
      source,
      filename: image.name,
      mime: image.mime,
      dataUrl: image.dataUrl,
    })

    state.runtime.sessionId = data.sessionId || state.runtime.sessionId
    uploaded.push({
      id: data.asset.id,
      assetId: data.asset.id,
      name: image.name,
      mime: image.mime,
      base64: image.base64,
      dataUrl: image.dataUrl,
      label: basename(image.name),
      role: '',
    })
  }

  saveRuntimeState()
  return uploaded
}

async function hydrateAssetItems(items) {
  const hydrated = await Promise.all(items.map(async (item) => {
    try {
      const data = await getJson(`/api/assets/${encodeURIComponent(item.assetId || item.id)}?includeData=1`)
      if (!data?.asset || !data?.dataUrl) return null
      return {
        ...item,
        id: data.asset.id,
        assetId: data.asset.id,
        name: item.name || data.asset.filename || data.asset.id,
        mime: data.asset.mime || item.mime || 'image/png',
        dataUrl: data.dataUrl,
        base64: splitDataUrl(data.dataUrl)?.base64 || '',
      }
    } catch {
      return null
    }
  }))

  return hydrated.filter(Boolean)
}

async function restoreRuntimeState() {
  const runtime = sanitizeRuntimeState(loadRuntimeState())
  state.runtime.sessionId = runtime.sessionId
  state.translate.jobId = runtime.translate.jobId
  state.generate.elements = runtime.generate.elements || []
  state.generate.scale = runtime.generate.scale || 1
  state.generate.panX = runtime.generate.panX || 0
  state.generate.panY = runtime.generate.panY || 0
  state.outfit.jobId = runtime.outfit.jobId

  const [translateItems, outfitModels, outfitGarments] = await Promise.all([
    hydrateAssetItems(runtime.translate.items),
    hydrateAssetItems(runtime.outfit.models),
    hydrateAssetItems(runtime.outfit.garments),
  ])

  state.translate.items = translateItems.map((item) => ({ ...item, results: {} }))
  state.outfit.models = outfitModels
  state.outfit.garments = outfitGarments.map((item) => ({ ...item, role: item.role || 'full_outfit' }))

  const savedResults = loadResultsStore()
  restoreTranslateResults(savedResults)
  restoreOutfitResults(savedResults)

  if (runtime.style?.sourceImage) {
    const hydratedSource = await hydrateAssetItems([runtime.style.sourceImage])
    state.style.sourceImage = hydratedSource[0] || null
  }
  if (runtime.style?.subjectRefs?.length) {
    state.style.subjectRefs = await hydrateAssetItems(runtime.style.subjectRefs)
  }
  state.style.visualStyle = runtime.style?.visualStyle || null
  state.style.styleSummary = runtime.style?.styleSummary || ''
  state.style.colorPalette = runtime.style?.colorPalette || []
  state.style.tags = runtime.style?.tags || []
  state.style.history = runtime.style?.history || []

  saveRuntimeState()
  renderAll()

  if (state.translate.jobId) {
    void syncTranslateJob(state.translate.jobId, { passive404: true })
  }
  if (state.outfit.jobId) {
    void syncOutfitJob(state.outfit.jobId, { passive404: true })
  }
}

function assetResultUrl(assetId) {
  return `/api/results/${encodeURIComponent(assetId)}`
}

function formatBatchProgress(job) {
  const total = Number(job?.progressTotal || 0)
  const done = Number(job?.progressDone || 0)
  const failed = Number(job?.progressFailed || 0)
  const finished = done + failed

  if (job?.status === 'queued') return total ? `0 / ${total}` : '排队中…'
  if (job?.status === 'running') return `${finished} / ${total}${failed ? ` · 失败 ${failed}` : ''}`
  if (job?.status === 'completed') return `完成 ${done} / ${total}`
  if (job?.status === 'partial_failed') return `完成 ${done} / ${total} · 失败 ${failed}`
  if (job?.status === 'failed') return total ? `完成 ${done} / ${total} · 失败 ${failed || total}` : '任务失败'
  if (job?.status === 'cancelled') return '任务已取消'
  return ''
}

function getTranslateSignatureFromJob(job) {
  return getTranslateSignature({
    sourceLanguage: String(job?.configJson?.sourceLanguage || 'auto'),
    modelId: String(job?.configJson?.modelId || state.translate.model),
    preserveBrand: job?.configJson?.preserveBrand !== false,
  })
}

function getOutfitSignatureFromJob(job) {
  return getOutfitSignature({
    modelId: String(job?.configJson?.modelId || state.outfit.model),
    garmentRoles: Array.isArray(job?.configJson?.garmentRoles)
      ? job.configJson.garmentRoles.join('|')
      : String(job?.configJson?.garmentRoles || ''),
    instructions: String(job?.configJson?.instructions || ''),
  })
}

function mapTranslateJobItem(item, signature) {
  if (item.status === 'completed') {
    return {
      status: 'done',
      dataUrl: assetResultUrl(String(item.outputJson?.resultAssetId || '')),
      ocr: item.outputJson?.ocr || null,
      signature,
      attempts: Number(item.attemptCount || 1),
      itemId: item.id,
      assetId: String(item.outputJson?.resultAssetId || ''),
    }
  }

  if (item.status === 'failed') {
    return {
      status: 'error',
      error: String(item.errorMessage || '翻译失败'),
      signature,
      attempts: Number(item.attemptCount || 1),
      itemId: item.id,
    }
  }

  if (item.status === 'running') {
    return {
      status: 'running',
      signature,
      attempt: Math.max(1, Number(item.attemptCount || 1)),
      itemId: item.id,
    }
  }

  return {
    status: 'queue',
    signature,
    attempt: Number(item.attemptCount || 0),
    itemId: item.id,
  }
}

function applyTranslateJobSnapshot(job, items) {
  const signature = getTranslateSignatureFromJob(job)
  const translateByAsset = new Map(state.translate.items.map((item) => [item.assetId || item.id, item]))

  for (const item of state.translate.items) {
    if (!item.results || typeof item.results !== 'object') {
      item.results = {}
    }
  }

  for (const item of items) {
    const assetId = String(item.inputJson?.assetId || '')
    const language = String(item.inputJson?.targetLanguage || '')
    const target = translateByAsset.get(assetId)
    if (!target || !language) continue
    const mapped = mapTranslateJobItem(item, signature)
    target.results[language] = mapped
    if (mapped.status === 'done' && mapped.dataUrl) {
      saveTranslateResult(assetId, language, mapped)
    }
  }

  state.translate.running = !TERMINAL_JOB_STATUSES.has(job.status)
  state.translate.progress = formatBatchProgress(job)
  renderTranslate()
}

async function syncTranslateJob(jobId, { passive404 = false } = {}) {
  const token = ++translateWatcherToken

  while (token === translateWatcherToken && state.translate.jobId === jobId) {
    try {
      const [{ job }, { items }] = await Promise.all([
        getJson(`/api/jobs/${encodeURIComponent(jobId)}`),
        getJson(`/api/jobs/${encodeURIComponent(jobId)}/items`),
      ])

      applyTranslateJobSnapshot(job, items)
      saveRuntimeState()

      if (TERMINAL_JOB_STATUSES.has(job.status)) {
        break
      }

      await wait(900)
    } catch (error) {
      if (Number(error?.status || 0) === 404) {
        if (state.translate.jobId === jobId) {
          state.translate.jobId = ''
          state.translate.running = false
          if (!passive404) {
            state.translate.progress = '任务记录已失效，请重新提交'
          }
          saveRuntimeState()
          renderTranslate()
        }
        return
      }

      state.translate.progress = trimError(error)
      renderTranslate()
      await wait(1200)
    }
  }
}

function mapOutfitJobItem(item, signature) {
  if (item.status === 'completed') {
    return {
      status: 'done',
      dataUrl: assetResultUrl(String(item.outputJson?.resultAssetId || '')),
      signature,
      attempts: Number(item.attemptCount || 1),
      itemId: item.id,
      assetId: String(item.outputJson?.resultAssetId || ''),
    }
  }

  if (item.status === 'failed') {
    return {
      status: 'error',
      error: String(item.errorMessage || '换装失败'),
      signature,
      attempts: Number(item.attemptCount || 1),
      itemId: item.id,
    }
  }

  if (item.status === 'running') {
    return {
      status: 'running',
      signature,
      attempt: Math.max(1, Number(item.attemptCount || 1)),
      itemId: item.id,
    }
  }

  return {
    status: 'queue',
    signature,
    attempt: Number(item.attemptCount || 0),
    itemId: item.id,
  }
}

function applyOutfitJobSnapshot(job, items) {
  const signature = getOutfitSignatureFromJob(job)
  const nextResults = {}

  for (const [key, value] of Object.entries(state.outfit.results)) {
    nextResults[key] = value
  }

  for (const item of items) {
    const key = pairKey(String(item.inputJson?.modelAssetId || ''), String(item.inputJson?.lookId || ''))
    if (!key || !key.includes('::')) continue
    const mapped = mapOutfitJobItem(item, signature)
    nextResults[key] = mapped
    if (mapped.status === 'done' && mapped.dataUrl) {
      saveOutfitResult(String(item.inputJson?.modelAssetId || ''), String(item.inputJson?.lookId || ''), mapped)
    }
  }

  state.outfit.results = nextResults
  state.outfit.running = !TERMINAL_JOB_STATUSES.has(job.status)
  state.outfit.progress = formatBatchProgress(job)
  renderOutfit()
}

async function syncOutfitJob(jobId, { passive404 = false } = {}) {
  const token = ++outfitWatcherToken

  while (token === outfitWatcherToken && state.outfit.jobId === jobId) {
    try {
      const [{ job }, { items }] = await Promise.all([
        getJson(`/api/jobs/${encodeURIComponent(jobId)}`),
        getJson(`/api/jobs/${encodeURIComponent(jobId)}/items`),
      ])

      applyOutfitJobSnapshot(job, items)
      saveRuntimeState()

      if (TERMINAL_JOB_STATUSES.has(job.status)) {
        break
      }

      await wait(900)
    } catch (error) {
      if (Number(error?.status || 0) === 404) {
        if (state.outfit.jobId === jobId) {
          state.outfit.jobId = ''
          state.outfit.running = false
          if (!passive404) {
            state.outfit.progress = '任务记录已失效，请重新提交'
          }
          saveRuntimeState()
          renderOutfit()
        }
        return
      }

      state.outfit.progress = trimError(error)
      renderOutfit()
      await wait(1200)
    }
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      resolve({
        dataUrl,
        base64: dataUrl.split(',', 2)[1] || '',
      })
    }
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

async function runPool(items, limit, worker) {
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index]
      index += 1
      await worker(current)
    }
  })
  await Promise.all(workers)
}

async function getJson(url) {
  const response = await fetch(url)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`)
    error.status = response.status
    error.payload = data
    throw error
  }
  return data
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`)
    error.status = response.status
    error.payload = data
    throw error
  }
  return data
}

async function fetchSseEvents(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/event-stream',
    },
  })

  const text = await response.text()
  if (!response.ok) {
    let payload = {}
    try {
      payload = JSON.parse(text)
    } catch {
      payload = {}
    }
    const error = new Error(payload.error || text.trim() || `HTTP ${response.status}`)
    error.status = response.status
    error.payload = payload
    throw error
  }

  return parseSseEvents(text)
}

function parseSseEvents(text) {
  const events = []
  for (const block of String(text || '').split(/\n\n+/)) {
    const dataLines = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())

    if (dataLines.length === 0) continue

    try {
      events.push(JSON.parse(dataLines.join('\n')))
    } catch {
      // ignore malformed event blocks
    }
  }
  return events
}

async function streamGenerateRequest(url, body, { onEvent = null } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const error = new Error(data.error || `HTTP ${response.status}`)
    error.status = response.status
    error.payload = data
    throw error
  }

  if (!response.body) {
    throw new Error('Generate stream unavailable')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result = null

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)

      if (line) {
        let event = null
        try {
          event = JSON.parse(line)
        } catch {
          event = null
        }

        if (event) {
          onEvent?.(event)

          if (event.type === 'error') {
            const error = new Error(event.error || 'Generate stream failed')
            error.status = event.status
            error.payload = event
            throw error
          }

          if (event.type === 'result') {
            result = event
          }
        }
      }

      newlineIndex = buffer.indexOf('\n')
    }

    if (done) break
  }

  const tail = buffer.trim()
  if (tail) {
    try {
      const event = JSON.parse(tail)
      onEvent?.(event)
      if (event.type === 'error') {
        const error = new Error(event.error || 'Generate stream failed')
        error.status = event.status
        error.payload = event
        throw error
      }
      if (event.type === 'result') {
        result = event
      }
    } catch {
      // ignore trailing non-json noise
    }
  }

  if (!result) {
    throw new Error('Generate stream ended without result')
  }

  return result
}

async function downloadAll(entries) {
  for (const entry of entries) {
    await downloadAsset(entry.href, entry.name)
    await wait(80)
  }
}

async function downloadAsset(href, name) {
  const link = document.createElement('a')

  try {
    if (href.startsWith('data:')) {
      link.href = href
    } else {
      const response = await fetch(href)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      link.href = URL.createObjectURL(blob)
    }

    link.download = ensureImageExtension(name, href)
    document.body.append(link)
    link.click()
    link.remove()
  } finally {
    if (link.href.startsWith('blob:')) {
      URL.revokeObjectURL(link.href)
    }
  }
}

function pruneOutfitResults() {
  const validModelIds = new Set(state.outfit.models.map((item) => item.id))
  const validLookIds = new Set(buildOutfitLooks().map((look) => look.id))
  const next = {}

  for (const [key, value] of Object.entries(state.outfit.results)) {
    const [modelId, lookId] = key.split('::')
    if (validModelIds.has(modelId) && validLookIds.has(lookId)) {
      next[key] = value
    }
  }

  state.outfit.results = next
}

function createDropdownItem({ primary, secondary, selected, multiple }) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `dd-item${selected ? ' selected' : ''}`

  if (multiple) {
    const check = document.createElement('span')
    check.className = 'dd-check'
    check.textContent = selected ? '✓' : ''
    button.append(check)
  }

  const label = document.createElement('div')
  label.className = 'dd-item-label'

  const primaryNode = document.createElement('div')
  primaryNode.textContent = primary
  label.append(primaryNode)

  if (secondary && secondary !== primary) {
    const secondaryNode = document.createElement('div')
    secondaryNode.className = 'dd-item-sub'
    secondaryNode.textContent = secondary
    label.append(secondaryNode)
  }

  button.append(label)
  return button
}

function hydrateKeyForm() {
  $('#k-vision').value = state.keys.visionApiKey || ''
  $('#k-banana2').value = state.keys.banana2ApiKey || ''
  $('#k-bananapro').value = state.keys.bananaProApiKey || ''
  $('#k-gptimage').value = state.keys.gptImageApiKey || ''
}

function loadKeys() {
  return readJson(KEY_STORAGE, {})
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function getLanguage(code) {
  return LANGUAGES.find((item) => item.code === code)
}

function getModel(id) {
  return MODEL_OPTIONS.find((item) => item.id === id)
}

function getGarmentRoleLabel(role) {
  return GARMENT_ROLE_OPTIONS.find((item) => item.value === role)?.label || role
}

function splitDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return {
    mime: match[1],
    base64: match[2],
  }
}

function normalizeView(view) {
  return ['translate', 'generate', 'outfit', 'style'].includes(view) ? view : 'translate'
}

function basename(name = '') {
  return String(name).replace(/\.[^.]+$/, '')
}

function formatTimestamp(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function sanitizeFileName(name = '') {
  return String(name).replace(/[\\/:*?"<>|]+/g, '-')
}

function ensureImageExtension(name = '', href = '') {
  const normalized = String(name || 'image').trim() || 'image'
  if (/\.(png|jpg|jpeg|webp|gif)$/i.test(normalized)) return normalized
  const mime = splitDataUrl(href)?.mime || ''
  if (/jpeg/i.test(mime)) return `${normalized}.jpg`
  if (/webp/i.test(mime)) return `${normalized}.webp`
  if (/gif/i.test(mime)) return `${normalized}.gif`
  return `${normalized}.png`
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function unique(values) {
  return [...new Set(values)]
}

function trimError(error) {
  return String(error?.message || error || 'Unknown error').trim().slice(0, 1600)
}

function pairKey(modelId, garmentId) {
  return `${modelId}::${garmentId}`
}

function getTranslateSignature(config) {
  return JSON.stringify({
    sourceLanguage: config.sourceLanguage,
    modelId: config.modelId,
    preserveBrand: Boolean(config.preserveBrand),
  })
}

function getOutfitSignature(config) {
  return JSON.stringify({
    modelId: config.modelId,
    garmentRoles: config.garmentRoles || '',
    instructions: config.instructions || '',
  })
}

function getOutfitRoleFingerprint() {
  return state.outfit.garments
    .map((item) => `${item.id}:${item.role || 'full_outfit'}`)
    .sort()
    .join('|')
}

function buildOutfitLooks() {
  const groups = {
    full_outfit: state.outfit.garments.filter((item) => (item.role || 'full_outfit') === 'full_outfit'),
    dress: state.outfit.garments.filter((item) => item.role === 'dress'),
    top: state.outfit.garments.filter((item) => item.role === 'top'),
    bottom: state.outfit.garments.filter((item) => item.role === 'bottom'),
    outerwear: state.outfit.garments.filter((item) => item.role === 'outerwear'),
    accessory: state.outfit.garments.filter((item) => item.role === 'accessory'),
  }

  let baseLooks = []
  let optionalOuterwear = groups.outerwear
  let optionalAccessory = groups.accessory

  if (groups.full_outfit.length > 0) {
    baseLooks.push(...groups.full_outfit.map((item) => [item]))
  }

  if (groups.dress.length > 0) {
    baseLooks.push(...groups.dress.map((item) => [item]))
  }

  if (groups.top.length > 0 && groups.bottom.length > 0) {
    baseLooks.push(...cartesianGarmentItems([groups.top, groups.bottom]))
  } else if (groups.top.length > 0) {
    baseLooks.push(...groups.top.map((item) => [item]))
  } else if (groups.bottom.length > 0) {
    baseLooks.push(...groups.bottom.map((item) => [item]))
  }

  if (baseLooks.length === 0 && groups.outerwear.length > 0) {
    baseLooks.push(...groups.outerwear.map((item) => [item]))
    optionalOuterwear = []
  }

  if (baseLooks.length === 0 && groups.accessory.length > 0) {
    baseLooks.push(...groups.accessory.map((item) => [item]))
    optionalAccessory = []
  }

  let looks = [...baseLooks]

  if (optionalOuterwear.length > 0 && looks.length > 0) {
    looks = expandOutfitLooks(looks, optionalOuterwear)
  }

  if (optionalAccessory.length > 0 && looks.length > 0) {
    looks = expandOutfitLooks(looks, optionalAccessory)
  }

  return dedupeOutfitLooks(looks)
}

function cartesianGarmentItems(groups) {
  let combos = [[]]
  for (const group of groups) {
    const items = Array.isArray(group) ? group : []
    const next = []
    for (const combo of combos) {
      for (const item of items) {
        next.push([...combo, item])
      }
    }
    combos = next
  }
  return combos
}

function expandOutfitLooks(looks, items) {
  const next = [...looks]
  for (const look of looks) {
    for (const item of items) {
      next.push([...look, item])
    }
  }
  return next
}

function dedupeOutfitLooks(looks) {
  const map = new Map()
  for (const items of looks) {
    const look = createLook(items)
    if (!map.has(look.id)) {
      map.set(look.id, look)
    }
  }
  return [...map.values()]
}

function createLook(items) {
  const orderedItems = [...items].sort((a, b) => garmentRoleOrder(a.role) - garmentRoleOrder(b.role))
  return {
    id: orderedItems.map((item) => item.id).join('+'),
    items: orderedItems,
    roles: orderedItems.map((item) => item.role || 'full_outfit'),
    label: orderedItems.map((item) => basename(item.name)).join(' + '),
  }
}

function garmentRoleOrder(role) {
  return ['full_outfit', 'dress', 'top', 'bottom', 'outerwear', 'accessory'].indexOf(role || 'full_outfit')
}

function getOutfitLookFileLabel(look) {
  return look.items.map((item) => basename(item.name)).join('__')
}

function loadResultsStore() {
  return readJson(RESULTS_STORAGE, { translate: {}, outfit: {}, style: { history: [] } })
}

function saveResultsStore(data) {
  try {
    const json = JSON.stringify(data)
    if (json.length > 4_500_000) {
      pruneResultsStore(data)
    }
    localStorage.setItem(RESULTS_STORAGE, JSON.stringify(data))
  } catch {
    pruneResultsStore(data)
    try {
      localStorage.setItem(RESULTS_STORAGE, JSON.stringify(data))
    } catch { /* storage full, skip */ }
  }
}

function pruneResultsStore(data) {
  if (Array.isArray(data.style?.history) && data.style.history.length > 5) {
    data.style.history = data.style.history.slice(-5)
  }
  const translateKeys = Object.keys(data.translate || {})
  if (translateKeys.length > 20) {
    for (const key of translateKeys.slice(0, translateKeys.length - 20)) {
      delete data.translate[key]
    }
  }
  const outfitKeys = Object.keys(data.outfit || {})
  if (outfitKeys.length > 20) {
    for (const key of outfitKeys.slice(0, outfitKeys.length - 20)) {
      delete data.outfit[key]
    }
  }
}

function saveTranslateResult(itemAssetId, language, result) {
  const store = loadResultsStore()
  if (!store.translate) store.translate = {}
  const key = `${itemAssetId}::${language}`
  store.translate[key] = {
    dataUrl: result.dataUrl || '',
    ocr: result.ocr || null,
    signature: result.signature || '',
  }
  saveResultsStore(store)
}

function saveOutfitResult(modelId, lookId, result) {
  const store = loadResultsStore()
  if (!store.outfit) store.outfit = {}
  const key = `${modelId}::${lookId}`
  store.outfit[key] = {
    dataUrl: result.dataUrl || '',
    signature: result.signature || '',
  }
  saveResultsStore(store)
}

function restoreTranslateResults(store) {
  if (!store?.translate) return
  for (const item of state.translate.items) {
    for (const lang of state.translate.targets) {
      const key = `${item.assetId || item.id}::${lang}`
      const saved = store.translate[key]
      if (saved?.dataUrl && !item.results[lang]) {
        item.results[lang] = {
          status: 'done',
          dataUrl: saved.dataUrl,
          ocr: saved.ocr || null,
          signature: saved.signature || '',
          attempts: 1,
        }
      }
    }
  }
}

function restoreOutfitResults(store) {
  if (!store?.outfit) return
  for (const [key, saved] of Object.entries(store.outfit)) {
    if (saved?.dataUrl && !state.outfit.results[key]) {
      state.outfit.results[key] = {
        status: 'done',
        dataUrl: saved.dataUrl,
        signature: saved.signature || '',
        attempts: 1,
      }
    }
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
