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
const CANVAS_GUIDE_STORAGE = 'img-translator:canvas-guide:v1'
const CANVAS_AI_FIRST_OPEN_STORAGE = 'img-translator:canvas-ai-opened:v1'
const DEFAULT_CANVAS_PROJECT_TITLE = '未命名画布'
const CANVAS_SHAPES = new Set(['square', 'circle', 'triangle', 'message', 'arrow-left', 'arrow-right'])
const CANVAS_RESOLUTIONS = new Set(['1k', '2k', '4k'])
const VIEW_ROUTES = {
  home: '/',
  translate: '/?view=translate',
  generate: '/lovart/canvas',
  projects: '/lovart/projects',
  outfit: '/?view=outfit',
  style: '/?view=style',
}
const TERMINAL_JOB_STATUSES = new Set(['completed', 'partial_failed', 'failed', 'cancelled'])
let translateWatcherToken = 0
let outfitWatcherToken = 0
let canvasSpaceHeld = false
let canvasSaveTimer = 0
let canvasSaveInFlight = null
let canvasSavePending = false
let canvasProjectCreateInFlight = null
let restoringRuntimeState = false
let runtimeStateReady = false

const state = {
  activeView: 'home',
  openDropdown: null,
  theme: 'dark',
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
    projectId: '',
    projectTitle: DEFAULT_CANVAS_PROJECT_TITLE,
    projectSaveStatus: '',
    // canvas
    scale: 1,
    panX: 0,
    panY: 0,
    elements: [],
    selectedIds: [],
    activeTool: 'select',
    shapeTool: 'square',
    isDragging: false,
    isPanning: false,
    isResizing: false,
    isBoxSelecting: false,
    isDrawing: false,
    suppressCanvasClick: false,
    dragStartX: 0,
    dragStartY: 0,
    dragElementStartX: 0,
    dragElementStartY: 0,
    dragStartPositions: [],
    resizeHandle: '',
    resizeStartWidth: 0,
    resizeStartHeight: 0,
    resizeStartAspect: 1,
    boxStartClientX: 0,
    boxStartClientY: 0,
    boxEndClientX: 0,
    boxEndClientY: 0,
    boxSelectAdditive: false,
    drawElementId: '',
    drawPoints: [],
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
    genResolution: '1k',
    genUseAgent: false,
    genRefs: [],
    genRunning: false,
    // runtime
    model: 'nano-banana-2',
  },
  projects: {
    items: [],
    loading: false,
    loadedSessionId: '',
    error: '',
  },
  home: {
    prompt: '',
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
  hPrompt: $('#h-prompt'),
  hStart: $('#h-start'),
  hTools: $('#h-tools'),
  hProjects: $('#h-projects'),
  hSettings: $('#h-settings'),
  hSeeAll: $('#h-see-all'),
  hRecentStatus: $('#h-recent-status'),
  hRecentList: $('#h-recent-list'),
  gModel: $('#g-model'),
  gAgent: $('#g-agent'),
  gNew: $('#g-new'),
  gProjects: $('#g-projects'),
  gProjectTitle: $('#g-project-title'),
  gProjectStatus: $('#g-project-status'),
  gInput: $('#g-input'),
  gSend: $('#g-send'),
  gCanvasContainer: $('#g-canvas-container'),
  gCanvas: $('#g-canvas'),
  gCanvasEmpty: $('#g-canvas-empty'),
  gConnectors: $('#g-connectors'),
  gSelectionBox: $('#g-selection-box'),
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
  gGenResolution: $('#g-gen-resolution'),
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
  gAiResolution: $('#g-ai-resolution'),
  gAiUpload: $('#g-ai-upload'),
  gAiFileInput: $('#g-ai-file-input'),
  gAiRefList: $('#g-ai-ref-list'),
  gGuide: $('#g-guide'),
  gGuideAddImage: $('#g-guide-add-image'),
  gGuideAddGen: $('#g-guide-add-gen'),
  gGuideClose: $('#g-guide-close'),
  pList: $('#p-list'),
  pCount: $('#p-count'),
  pStatus: $('#p-status'),
  pEmpty: $('#p-empty'),
  pNew: $('#p-new'),
  pEmptyNew: $('#p-empty-new'),
  pRefresh: $('#p-refresh'),
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
  applyTheme()
  state.activeView = viewFromLocation(state.activeView)
  const routeProjectId = canvasProjectIdFromLocation()
  if (state.activeView === 'generate' && routeProjectId) {
    state.generate.projectId = routeProjectId
  }
  ensureCanvasFirstOpenAiPanel()
  populateModelSelects()
  bindShell()
  bindSettings()
  bindLightbox()
  bindHome()
  bindTranslate()
  bindProjects()
  bindGenerate()
  bindOutfit()
  bindStyle()
  renderAll()
  void restoreRuntimeState()
}

function viewFromLocation(fallback = 'home') {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/lovart/canvas') return 'generate'
  if (path === '/lovart/projects') return 'projects'
  if (path === '/lovart') return 'home'
  const view = new URLSearchParams(window.location.search).get('view')
  if (view) return normalizeView(view)
  if (path === '/') return 'home'
  return normalizeView(fallback)
}

function canvasProjectIdFromLocation() {
  return new URLSearchParams(window.location.search).get('id') || ''
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
    state.theme = normalizeTheme(stored.theme || stored.appearance?.theme)
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
  const model = getModel(raw.model)?.id || state.generate.model
  return {
    model,
    genModel: model,
    genRatio: normalizeAspectRatio(raw.genRatio || raw.aspectRatio || state.generate.genRatio),
    genResolution: normalizeCanvasResolution(raw.genResolution || raw.resolution || state.generate.genResolution),
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
    theme: state.theme,
    translate: {
      source: state.translate.source,
      targets: state.translate.targets,
      model: state.translate.model,
      preserveBrand: state.translate.preserveBrand,
      concurrency: state.translate.concurrency,
    },
    generate: {
      model: state.generate.model,
      genRatio: state.generate.genRatio,
      genResolution: state.generate.genResolution,
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

function saveRuntimeState(options = {}) {
  const persistCanvas = options.persistCanvas !== false
  localStorage.setItem(RUNTIME_STORAGE, JSON.stringify({
    sessionId: state.runtime.sessionId || '',
    translate: {
      jobId: state.translate.jobId || '',
      items: state.translate.items.map((item) => serializeAssetBackedItem(item)),
    },
    generate: {
      projectId: state.generate.projectId || '',
      projectTitle: state.generate.projectTitle || DEFAULT_CANVAS_PROJECT_TITLE,
      elements: state.generate.elements.map((el) => serializeCanvasElement(el)),
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
  if (persistCanvas) scheduleCanvasProjectSave()
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
    ? raw.generate.elements.map((el) => sanitizeCanvasElement(el)).filter(Boolean)
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
      projectId: typeof raw.generate?.projectId === 'string' ? raw.generate.projectId : '',
      projectTitle: typeof raw.generate?.projectTitle === 'string' && raw.generate.projectTitle.trim()
        ? raw.generate.projectTitle.trim()
        : DEFAULT_CANVAS_PROJECT_TITLE,
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

function sanitizeCanvasElement(raw = {}) {
  const type = String(raw.type || '')
  if (!raw.id || !['image', 'text', 'shape', 'path', 'image-generator', 'connector'].includes(type)) return null
  const defaultWidth = type === 'connector' ? 0 : (type === 'text' ? 220 : 300)
  const defaultHeight = type === 'connector' ? 0 : (type === 'text' ? 48 : 300)
  const rawWidth = Number(raw.width)
  const rawHeight = Number(raw.height)
  const width = Math.max(0, Number.isFinite(rawWidth) ? rawWidth : defaultWidth)
  const height = Math.max(0, Number.isFinite(rawHeight) ? rawHeight : defaultHeight)
  const shape = normalizeCanvasShape(raw.shape || raw.shapeType)
  const path = sanitizeCanvasPath(raw.path || raw.points)
  const pathBoxWidth = Math.max(1, Number(raw.pathBoxWidth) || width || 1)
  const pathBoxHeight = Math.max(1, Number(raw.pathBoxHeight) || height || 1)
  return {
    id: String(raw.id),
    type,
    x: Number(raw.x) || 0,
    y: Number(raw.y) || 0,
    width,
    height,
    content: typeof raw.content === 'string' ? raw.content : '',
    name: typeof raw.name === 'string' ? raw.name : '',
    mime: typeof raw.mime === 'string' ? raw.mime : '',
    assetId: typeof raw.assetId === 'string' ? raw.assetId : '',
    referenceImageId: raw.referenceImageId ? String(raw.referenceImageId) : null,
    generatingPrompt: typeof raw.generatingPrompt === 'string' ? raw.generatingPrompt : '',
    connectorFrom: typeof raw.connectorFrom === 'string' ? raw.connectorFrom : '',
    connectorTo: typeof raw.connectorTo === 'string' ? raw.connectorTo : '',
    aspectRatio: normalizeAspectRatio(raw.aspectRatio || raw.ratio || ''),
    resolution: normalizeCanvasResolution(raw.resolution || ''),
    shape,
    shapeType: shape,
    path,
    pathBoxWidth,
    pathBoxHeight,
    color: typeof raw.color === 'string' ? raw.color : '',
    fill: typeof raw.fill === 'string' ? raw.fill : '',
    stroke: typeof raw.stroke === 'string' ? raw.stroke : '',
    fontSize: clamp(Number(raw.fontSize) || 16, 10, 96),
    fontFamily: typeof raw.fontFamily === 'string' ? raw.fontFamily : '',
    strokeWidth: clamp(Number(raw.strokeWidth) || 2, 1, 16),
    groupId: typeof raw.groupId === 'string' ? raw.groupId : '',
    linkedElements: Array.isArray(raw.linkedElements) ? unique(raw.linkedElements.map(String).filter(Boolean)) : [],
    connectorStyle: typeof raw.connectorStyle === 'string' ? raw.connectorStyle : 'bezier',
  }
}

function serializeCanvasElement(el) {
  return {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    content: el.type === 'image' && el.assetId ? '' : (el.content || ''),
    name: el.name || '',
    mime: el.mime || '',
    assetId: el.assetId || '',
    referenceImageId: el.referenceImageId || null,
    generatingPrompt: el.generatingPrompt || '',
    connectorFrom: el.connectorFrom || '',
    connectorTo: el.connectorTo || '',
    aspectRatio: el.aspectRatio || '',
    resolution: el.resolution || '',
    shape: el.shape || el.shapeType || '',
    shapeType: el.shape || el.shapeType || '',
    path: sanitizeCanvasPath(el.path),
    pathBoxWidth: Number(el.pathBoxWidth) || Number(el.width) || 1,
    pathBoxHeight: Number(el.pathBoxHeight) || Number(el.height) || 1,
    color: el.color || '',
    fill: el.fill || '',
    stroke: el.stroke || '',
    fontSize: Number(el.fontSize) || 16,
    fontFamily: el.fontFamily || '',
    strokeWidth: Number(el.strokeWidth) || 2,
    groupId: el.groupId || '',
    linkedElements: Array.isArray(el.linkedElements) ? unique(el.linkedElements.map(String).filter(Boolean)) : [],
    connectorStyle: el.connectorStyle || 'bezier',
  }
}

function sanitizeCanvasPath(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((point) => ({
      x: Number(point?.x),
      y: Number(point?.y),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .slice(0, 2000)
}

function normalizeCanvasShape(value) {
  const shape = String(value || 'square')
  return CANVAS_SHAPES.has(shape) ? shape : 'square'
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

  window.addEventListener('popstate', () => {
    state.activeView = viewFromLocation(state.activeView)
    const routeProjectId = state.activeView === 'generate' ? canvasProjectIdFromLocation() : ''
    if (routeProjectId) state.generate.projectId = routeProjectId
    savePrefs()
    renderAll()
    if (state.activeView === 'home' || state.activeView === 'projects') void loadCanvasProjects()
  })

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
    hydrateSettingsForm()
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
    state.theme = getSelectedSettingsTheme()
    applyTheme()
    localStorage.setItem(KEY_STORAGE, JSON.stringify(state.keys))
    savePrefs()
    dom.settingsDialog.close()
  })

  dom.settingsClear.addEventListener('click', () => {
    localStorage.removeItem(KEY_STORAGE)
    state.keys = {}
    hydrateSettingsForm()
  })

  for (const input of $$('input[name="settings-theme"]')) {
    input.addEventListener('change', () => {
      if (!input.checked) return
      state.theme = normalizeTheme(input.value)
      applyTheme()
      savePrefs()
    })
  }
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

function bindHome() {
  dom.hPrompt?.addEventListener('input', () => {
    state.home.prompt = dom.hPrompt.value
  })
  dom.hPrompt?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void startCanvasFromHomePrompt()
    }
  })
  dom.hStart?.addEventListener('click', () => {
    void startCanvasFromHomePrompt()
  })
  dom.hTools?.addEventListener('click', (event) => {
    const tool = event.target.closest('[data-view]')
    if (!tool) return
    setActiveView(tool.dataset.view || 'home')
  })
  dom.hProjects?.addEventListener('click', () => setActiveView('projects'))
  dom.hSeeAll?.addEventListener('click', () => setActiveView('projects'))
  dom.hSettings?.addEventListener('click', () => {
    hydrateSettingsForm()
    dom.settingsDialog.showModal()
  })
  dom.hRecentList?.addEventListener('click', (event) => {
    const newCard = event.target.closest('[data-home-new]')
    if (newCard) {
      void startNewCanvasProject()
      return
    }
    const card = event.target.closest('[data-project-id]')
    if (card) void openCanvasProject(card.dataset.projectId)
  })
}

function bindProjects() {
  dom.pNew?.addEventListener('click', () => {
    void startNewCanvasProject()
  })
  dom.pEmptyNew?.addEventListener('click', () => {
    void startNewCanvasProject()
  })
  dom.pRefresh?.addEventListener('click', () => {
    void loadCanvasProjects({ force: true })
  })
  dom.pList?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-project-id]')
    if (!card) return
    void openCanvasProject(card.dataset.projectId)
  })
}

function bindGenerate() {
  bindCanvas()
  bindToolbar()
  bindZoom()
  bindGenPanel()
  bindAiSidebar()
  bindCanvasGuide()

  dom.gProjectTitle.addEventListener('input', () => {
    state.generate.projectTitle = dom.gProjectTitle.value.trim() || DEFAULT_CANVAS_PROJECT_TITLE
    saveRuntimeState()
  })
  dom.gProjectTitle.addEventListener('blur', () => {
    dom.gProjectTitle.value = state.generate.projectTitle || DEFAULT_CANVAS_PROJECT_TITLE
    saveRuntimeState()
  })

  dom.gProjects.addEventListener('click', () => {
    setActiveView('projects')
  })

  dom.gNew.addEventListener('click', () => {
    if (state.generate.genRunning || state.generate.aiRunning) return
    void startNewCanvasProject()
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
  dom.gCanvasContainer.style.backgroundPosition = `${panX}px ${panY}px`
  dom.gCanvasContainer.style.backgroundSize = `${22 * scale}px ${22 * scale}px`
}

function isCanvasBackgroundTarget(target) {
  return target === dom.gCanvasContainer || target === dom.gCanvas
}

function startCanvasPan(e) {
  e.preventDefault()
  state.generate.isPanning = true
  state.generate.dragStartX = e.clientX
  state.generate.dragStartY = e.clientY
  state.generate.dragElementStartX = state.generate.panX
  state.generate.dragElementStartY = state.generate.panY
  dom.gCanvasContainer.style.cursor = 'grabbing'
}

function startCanvasDrag(e) {
  state.generate.isDragging = true
  state.generate.dragStartX = e.clientX
  state.generate.dragStartY = e.clientY
  state.generate.dragStartPositions = state.generate.selectedIds
    .map((id) => state.generate.elements.find((item) => item.id === id))
    .filter(Boolean)
    .map((el) => ({ id: el.id, x: el.x, y: el.y }))
}

function applyCanvasToolCursor() {
  const tool = state.generate.activeTool
  dom.gCanvasContainer.classList.toggle('tool-hand', tool === 'hand')
  dom.gCanvasContainer.classList.toggle('tool-draw', tool === 'draw')
  dom.gCanvasContainer.classList.toggle('tool-shape', isShapeTool(tool))
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
    const images = await prepareAssetItems(e.dataTransfer.files, { kind: 'upload', source: 'canvas_drop' })
    const pos = screenToCanvas(e.clientX, e.clientY)
    for (let i = 0; i < images.length; i++) {
      addImageToCanvas(images[i].dataUrl, images[i].name, pos.x + i * 40, pos.y + i * 40, {
        assetId: images[i].assetId,
        mime: images[i].mime,
        width: images[i].width,
        height: images[i].height,
      })
    }
    renderCanvas()
    saveRuntimeState()
  })

  // Click outside elements deselects
  dom.gCanvasContainer.addEventListener('click', (e) => {
    if (state.generate.suppressCanvasClick) {
      state.generate.suppressCanvasClick = false
      return
    }
    if (state.generate.activeTool !== 'select') return
    if (isCanvasBackgroundTarget(e.target)) {
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
      setCanvasTool('select')
      renderCanvas()
      saveRuntimeState()
    } else if (tool === 'ai-gen') {
      addGeneratorToCanvas(pos.x, pos.y)
      setCanvasTool('select')
      renderCanvas()
      saveRuntimeState()
    } else if (isShapeTool(tool)) {
      addShapeToCanvas(getShapeFromTool(tool), pos.x, pos.y)
      setCanvasTool('select')
      renderCanvas()
      saveRuntimeState()
    }
  })
}

function handleCanvasMouseDown(e) {
  if (state.activeView !== 'generate') return
  hideContextMenu()
  const tool = state.generate.activeTool

  // Middle button or space+left = pan
  if (e.button === 1 || (e.button === 0 && (canvasSpaceHeld || tool === 'hand'))) {
    startCanvasPan(e)
    return
  }

  // Left click on element = select or drag
  if (e.button === 0) {
    if (tool === 'draw' && !e.target.closest('.canvas-el')) {
      beginCanvasDraw(e)
      return
    }

    const handleNode = e.target.closest('.resize-handle')
    if (handleNode) {
      const elNode = handleNode.closest('.canvas-el')
      const elId = elNode?.dataset.elId
      const el = state.generate.elements.find((item) => item.id === elId)
      if (el) {
        e.preventDefault()
        e.stopPropagation()
        state.generate.selectedIds = [el.id]
        state.generate.isResizing = true
        state.generate.resizeHandle = handleNode.dataset.handle || 'se'
        state.generate.dragStartX = e.clientX
        state.generate.dragStartY = e.clientY
        state.generate.dragElementStartX = el.x
        state.generate.dragElementStartY = el.y
        state.generate.resizeStartWidth = el.width
        state.generate.resizeStartHeight = el.height
        state.generate.resizeStartAspect = el.width && el.height ? el.width / el.height : 1
        hideGenPanel()
        renderCanvas()
      }
      return
    }

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

        const el = state.generate.elements.find((item) => item.id === elId)
        if (!el) return

        const wasSelected = state.generate.selectedIds.includes(elId)
        if (e.shiftKey) {
          state.generate.selectedIds = wasSelected
            ? state.generate.selectedIds.filter((id) => id !== elId)
            : [...state.generate.selectedIds, elId]
        } else if (!wasSelected) {
          state.generate.selectedIds = [elId]
        }

        if (state.generate.selectedIds.includes(elId)) {
          startCanvasDrag(e)
        }

        if (state.generate.selectedIds.length === 1 && el.type === 'image-generator') {
          showGenPanel(elId)
        } else {
          hideGenPanel()
        }

        renderCanvas()
        return
      }
    }

    // Click empty canvas area with tool
    if (tool === 'image' && isCanvasBackgroundTarget(e.target)) {
      dom.gFileInput.click()
    } else if (isShapeTool(tool) && isCanvasBackgroundTarget(e.target)) {
      const pos = screenToCanvas(e.clientX, e.clientY)
      addShapeToCanvas(getShapeFromTool(tool), pos.x, pos.y)
      setCanvasTool('select')
      state.generate.suppressCanvasClick = true
      renderCanvas()
      saveRuntimeState()
    } else if (tool === 'select' && isCanvasBackgroundTarget(e.target)) {
      beginBoxSelection(e)
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

  if (state.generate.isDrawing) {
    updateCanvasDraw(e)
    return
  }

  if (state.generate.isBoxSelecting) {
    updateBoxSelection(e)
    return
  }

  if (state.generate.isResizing && state.generate.selectedIds.length === 1) {
    const el = state.generate.elements.find((item) => item.id === state.generate.selectedIds[0])
    if (!el) return
    const dx = (e.clientX - state.generate.dragStartX) / state.generate.scale
    const dy = (e.clientY - state.generate.dragStartY) / state.generate.scale
    const handle = state.generate.resizeHandle || 'se'

    let nextX = state.generate.dragElementStartX
    let nextY = state.generate.dragElementStartY
    let nextW = state.generate.resizeStartWidth
    let nextH = state.generate.resizeStartHeight

    if (handle.includes('e')) nextW = state.generate.resizeStartWidth + dx
    if (handle.includes('s')) nextH = state.generate.resizeStartHeight + dy
    if (handle.includes('w')) {
      nextW = state.generate.resizeStartWidth - dx
      nextX = state.generate.dragElementStartX + dx
    }
    if (handle.includes('n')) {
      nextH = state.generate.resizeStartHeight - dy
      nextY = state.generate.dragElementStartY + dy
    }

    if (el.type === 'image' && state.generate.resizeStartAspect > 0) {
      if (handle.includes('e') || handle.includes('w')) {
        nextH = nextW / state.generate.resizeStartAspect
        if (handle.includes('n')) nextY = state.generate.dragElementStartY + state.generate.resizeStartHeight - nextH
      } else if (handle.includes('n') || handle.includes('s')) {
        nextW = nextH * state.generate.resizeStartAspect
        if (handle.includes('w')) nextX = state.generate.dragElementStartX + state.generate.resizeStartWidth - nextW
      }
    }

    const minW = el.type === 'text' ? 80 : 28
    const minH = el.type === 'text' ? 32 : 28
    if (nextW < minW) {
      nextX = handle.includes('w') ? state.generate.dragElementStartX + state.generate.resizeStartWidth - minW : nextX
      nextW = minW
    }
    if (nextH < minH) {
      nextY = handle.includes('n') ? state.generate.dragElementStartY + state.generate.resizeStartHeight - minH : nextY
      nextH = minH
    }
    el.x = nextX
    el.y = nextY
    el.width = nextW
    el.height = nextH

    const node = dom.gCanvas.querySelector(`[data-el-id="${el.id}"]`)
    if (node) {
      node.style.left = `${el.x}px`
      node.style.top = `${el.y}px`
      node.style.width = `${el.width}px`
      node.style.height = `${el.height}px`
    }
    renderConnectors()
    return
  }

  if (state.generate.isDragging && state.generate.selectedIds.length > 0) {
    const dx = (e.clientX - state.generate.dragStartX) / state.generate.scale
    const dy = (e.clientY - state.generate.dragStartY) / state.generate.scale

    for (const start of state.generate.dragStartPositions) {
      const el = state.generate.elements.find((item) => item.id === start.id)
      if (!el) continue
      el.x = start.x + dx
      el.y = start.y + dy

      const node = dom.gCanvas.querySelector(`[data-el-id="${el.id}"]`)
      if (node) {
        node.style.left = `${el.x}px`
        node.style.top = `${el.y}px`
      }
    }
    renderConnectors()
    refreshGenPanelPosition()
  }
}

function handleCanvasMouseUp(e) {
  if (state.generate.isPanning) {
    state.generate.isPanning = false
    dom.gCanvasContainer.style.cursor = canvasSpaceHeld ? 'grab' : ''
    refreshGenPanelPosition()
    saveRuntimeState()
  }
  if (state.generate.isDrawing) {
    finishCanvasDraw()
    saveRuntimeState()
  }
  if (state.generate.isBoxSelecting) {
    finishBoxSelection(e)
  }
  if (state.generate.isDragging) {
    state.generate.isDragging = false
    state.generate.dragStartPositions = []
    refreshGenPanelPosition()
    saveRuntimeState()
  }
  if (state.generate.isResizing) {
    state.generate.isResizing = false
    state.generate.resizeHandle = ''
    renderCanvas()
    saveRuntimeState()
  }
}

function beginBoxSelection(e) {
  e.preventDefault()
  state.generate.isBoxSelecting = true
  state.generate.boxSelectAdditive = e.shiftKey
  state.generate.boxStartClientX = e.clientX
  state.generate.boxStartClientY = e.clientY
  state.generate.boxEndClientX = e.clientX
  state.generate.boxEndClientY = e.clientY
  state.generate.suppressCanvasClick = true
  updateBoxSelection(e)
}

function updateBoxSelection(e) {
  state.generate.boxEndClientX = e.clientX
  state.generate.boxEndClientY = e.clientY
  const rect = dom.gCanvasContainer.getBoundingClientRect()
  const left = Math.min(state.generate.boxStartClientX, state.generate.boxEndClientX) - rect.left
  const top = Math.min(state.generate.boxStartClientY, state.generate.boxEndClientY) - rect.top
  const width = Math.abs(state.generate.boxEndClientX - state.generate.boxStartClientX)
  const height = Math.abs(state.generate.boxEndClientY - state.generate.boxStartClientY)
  dom.gSelectionBox.classList.remove('hidden')
  dom.gSelectionBox.style.left = `${left}px`
  dom.gSelectionBox.style.top = `${top}px`
  dom.gSelectionBox.style.width = `${width}px`
  dom.gSelectionBox.style.height = `${height}px`
}

function finishBoxSelection(e) {
  const dx = Math.abs(e.clientX - state.generate.boxStartClientX)
  const dy = Math.abs(e.clientY - state.generate.boxStartClientY)
  state.generate.isBoxSelecting = false
  dom.gSelectionBox.classList.add('hidden')

  if (dx < 4 && dy < 4) {
    if (!state.generate.boxSelectAdditive) {
      state.generate.selectedIds = []
      hideGenPanel()
    }
    renderCanvas()
    return
  }

  const start = screenToCanvas(state.generate.boxStartClientX, state.generate.boxStartClientY)
  const end = screenToCanvas(e.clientX, e.clientY)
  const selection = {
    x1: Math.min(start.x, end.x),
    y1: Math.min(start.y, end.y),
    x2: Math.max(start.x, end.x),
    y2: Math.max(start.y, end.y),
  }
  const matched = state.generate.elements
    .filter((el) => el.type !== 'connector')
    .filter((el) => rectsIntersect(
      { x1: el.x, y1: el.y, x2: el.x + el.width, y2: el.y + el.height },
      selection,
    ))
    .map((el) => el.id)

  state.generate.selectedIds = state.generate.boxSelectAdditive
    ? unique([...state.generate.selectedIds, ...matched])
    : matched
  hideGenPanel()
  renderCanvas()
}

function beginCanvasDraw(e) {
  e.preventDefault()
  const point = screenToCanvas(e.clientX, e.clientY)
  const el = {
    id: crypto.randomUUID(),
    type: 'path',
    x: point.x,
    y: point.y,
    width: 2,
    height: 2,
    path: [{ x: 0, y: 0 }],
    pathBoxWidth: 2,
    pathBoxHeight: 2,
    strokeWidth: 3,
    color: '',
  }
  state.generate.elements.push(el)
  state.generate.selectedIds = [el.id]
  state.generate.drawElementId = el.id
  state.generate.drawPoints = [point]
  state.generate.isDrawing = true
  state.generate.suppressCanvasClick = true
  renderCanvas()
}

function updateCanvasDraw(e) {
  const point = screenToCanvas(e.clientX, e.clientY)
  const last = state.generate.drawPoints[state.generate.drawPoints.length - 1]
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2) return
  state.generate.drawPoints.push(point)
  const el = state.generate.elements.find((item) => item.id === state.generate.drawElementId)
  if (!el) return
  normalizePathElementFromPoints(el, state.generate.drawPoints)
  renderCanvas()
}

function finishCanvasDraw() {
  const el = state.generate.elements.find((item) => item.id === state.generate.drawElementId)
  state.generate.isDrawing = false
  state.generate.drawElementId = ''
  if (!el) return
  if (state.generate.drawPoints.length < 2) {
    el.width = 6
    el.height = 6
    el.path = [{ x: 3, y: 3 }, { x: 3.1, y: 3.1 }]
    el.pathBoxWidth = 6
    el.pathBoxHeight = 6
  } else {
    normalizePathElementFromPoints(el, state.generate.drawPoints)
  }
  state.generate.drawPoints = []
  renderCanvas()
}

function normalizePathElementFromPoints(el, points) {
  const minX = Math.min(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxX = Math.max(...points.map((point) => point.x))
  const maxY = Math.max(...points.map((point) => point.y))
  const padding = Math.max(3, Number(el.strokeWidth) || 3)
  el.x = minX - padding
  el.y = minY - padding
  el.width = Math.max(2, maxX - minX + padding * 2)
  el.height = Math.max(2, maxY - minY + padding * 2)
  el.pathBoxWidth = el.width
  el.pathBoxHeight = el.height
  el.path = points.map((point) => ({
    x: point.x - el.x,
    y: point.y - el.y,
  }))
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
  refreshGenPanelPosition()
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
  const viewRect = $('#view-generate').getBoundingClientRect()
  menu.classList.remove('hidden')
  menu.style.left = `${clamp(e.clientX - viewRect.left, 8, viewRect.width - 180)}px`
  menu.style.top = `${clamp(e.clientY - viewRect.top, 8, viewRect.height - 140)}px`
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

function addImageToCanvas(dataUrl, name, x, y, meta = {}) {
  markCanvasGuideSeen()
  const size = getCanvasImageSize(meta.aspectRatio, meta.width, meta.height)
  const cx = typeof x === 'number' ? x : (dom.gCanvasContainer.clientWidth / 2 - state.generate.panX) / state.generate.scale - size.width / 2
  const cy = typeof y === 'number' ? y : (dom.gCanvasContainer.clientHeight / 2 - state.generate.panY) / state.generate.scale - size.height / 2
  const el = {
    id: crypto.randomUUID(),
    type: 'image',
    x: cx,
    y: cy,
    width: size.width,
    height: size.height,
    content: dataUrl,
    name: name || 'image',
    mime: meta.mime || splitDataUrl(dataUrl)?.mime || 'image/png',
    assetId: meta.assetId || '',
    aspectRatio: normalizeAspectRatio(meta.aspectRatio || ''),
    resolution: normalizeCanvasResolution(meta.resolution || ''),
  }
  state.generate.elements.push(el)
  state.generate.selectedIds = [el.id]
  return el
}

function addTextToCanvas(x, y) {
  markCanvasGuideSeen()
  const cx = typeof x === 'number' ? x : (dom.gCanvasContainer.clientWidth / 2 - state.generate.panX) / state.generate.scale - 100
  const cy = typeof y === 'number' ? y : (dom.gCanvasContainer.clientHeight / 2 - state.generate.panY) / state.generate.scale - 20
  const el = {
    id: crypto.randomUUID(),
    type: 'text',
    x: cx,
    y: cy,
    width: 200,
    height: 40,
    content: '双击编辑文字',
    fontSize: 16,
    fontFamily: '',
  }
  state.generate.elements.push(el)
  state.generate.selectedIds = [el.id]
  return el
}

function addShapeToCanvas(shape, x, y) {
  markCanvasGuideSeen()
  const normalizedShape = normalizeCanvasShape(shape)
  const isArrow = normalizedShape === 'arrow-left' || normalizedShape === 'arrow-right'
  const isMessage = normalizedShape === 'message'
  const width = isArrow ? 180 : (isMessage ? 190 : 140)
  const height = isArrow ? 90 : (isMessage ? 120 : 140)
  const cx = typeof x === 'number' ? x - width / 2 : (dom.gCanvasContainer.clientWidth / 2 - state.generate.panX) / state.generate.scale - width / 2
  const cy = typeof y === 'number' ? y - height / 2 : (dom.gCanvasContainer.clientHeight / 2 - state.generate.panY) / state.generate.scale - height / 2
  const el = {
    id: crypto.randomUUID(),
    type: 'shape',
    x: cx,
    y: cy,
    width,
    height,
    content: '',
    shape: normalizedShape,
    shapeType: normalizedShape,
    strokeWidth: 2,
    color: '',
  }
  state.generate.elements.push(el)
  state.generate.selectedIds = [el.id]
  return el
}

function addGeneratorToCanvas(x, y, refImageId) {
  markCanvasGuideSeen()
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
  const groupId = crypto.randomUUID()

  // Create connector
  const connector = {
    id: crypto.randomUUID(),
    type: 'connector',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    content: '',
    connectorFrom: sourceElementId,
    connectorTo: gen.id,
    connectorStyle: 'bezier',
    groupId,
    linkedElements: [sourceElementId, gen.id],
  }
  source.groupId = source.groupId || groupId
  gen.groupId = groupId
  source.linkedElements = unique([...(source.linkedElements || []), gen.id, connector.id])
  gen.linkedElements = unique([...(gen.linkedElements || []), sourceElementId, connector.id])
  state.generate.elements.push(connector)

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
  for (const el of state.generate.elements) {
    if (Array.isArray(el.linkedElements)) {
      el.linkedElements = el.linkedElements.filter((linkedId) => linkedId !== id)
    }
  }
}

function renderCanvas() {
  const elements = state.generate.elements.filter((el) => el.type !== 'connector')
  const linkedIds = getLinkedCanvasElementIds()
  dom.gCanvasEmpty.classList.toggle('hidden', elements.length > 0)
  renderCanvasGuide(elements.length)

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
    const selected = state.generate.selectedIds.includes(el.id)
    node.classList.toggle('selected', selected)
    node.classList.toggle('linked', !selected && linkedIds.has(el.id))

    // Update image src if changed
    if (el.type === 'image') {
      const img = node.querySelector('.canvas-el-image')
      if (img && img.src !== el.content) img.src = el.content
      const size = node.querySelector('.canvas-el-size')
      if (size) size.textContent = `${Math.round(el.width)} × ${Math.round(el.height)}`
    } else if (el.type === 'text') {
      const text = node.querySelector('.canvas-el-text')
      if (text && text.textContent !== el.content) text.textContent = el.content || ''
      applyTextElementStyle(text, el)
    } else if (el.type === 'shape') {
      const shape = node.querySelector('.canvas-shape-svg')
      if (shape) renderShapeSvg(shape, el)
    } else if (el.type === 'path') {
      const path = node.querySelector('.canvas-path-svg')
      if (path) renderPathSvg(path, el)
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
    node.append(createCanvasElementActions(el))
  } else if (el.type === 'text') {
    const text = document.createElement('div')
    text.className = 'canvas-el-text'
    text.contentEditable = 'true'
    text.textContent = el.content || ''
    applyTextElementStyle(text, el)
    text.addEventListener('blur', () => {
      el.content = text.textContent || ''
      saveRuntimeState()
    })
    node.append(text)
  } else if (el.type === 'shape') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.classList.add('canvas-shape-svg')
    renderShapeSvg(svg, el)
    node.append(svg)
  } else if (el.type === 'path') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.classList.add('canvas-path-svg')
    renderPathSvg(svg, el)
    node.append(svg)
  } else if (el.type === 'image-generator') {
    const placeholder = document.createElement('div')
    placeholder.className = 'canvas-el-generator'
    placeholder.innerHTML = '<span class="canvas-gen-icon">&#x2726;</span><span class="canvas-gen-label">AI 生图</span><span class="gen-hint">选中后设置参数并生成</span>'
    node.append(placeholder)
  }

  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const grip = document.createElement('span')
    grip.className = `resize-handle ${handle}`
    grip.dataset.handle = handle
    node.append(grip)
  }

  // Right-click
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    showContextMenu(e, el.id)
  })

  return node
}

function applyTextElementStyle(node, el) {
  if (!node) return
  node.style.fontSize = `${Number(el.fontSize) || 16}px`
  node.style.fontFamily = el.fontFamily || ''
}

function renderShapeSvg(svg, el) {
  const shape = normalizeCanvasShape(el.shape || el.shapeType)
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('aria-hidden', 'true')
  const strokeWidth = Number(el.strokeWidth) || 2
  const attrs = `class="canvas-shape-mark" vector-effect="non-scaling-stroke" stroke-width="${strokeWidth}"`
  if (shape === 'circle') {
    svg.innerHTML = `<ellipse ${attrs} cx="50" cy="50" rx="43" ry="43"></ellipse>`
  } else if (shape === 'triangle') {
    svg.innerHTML = `<polygon ${attrs} points="50 7 94 92 6 92"></polygon>`
  } else if (shape === 'message') {
    svg.innerHTML = `<path ${attrs} d="M14 12H86Q94 12 94 20V64Q94 72 86 72H43L27 91V72H14Q6 72 6 64V20Q6 12 14 12Z"></path>`
  } else if (shape === 'arrow-left') {
    svg.innerHTML = `<polygon ${attrs} points="6 50 36 18 36 36 94 36 94 64 36 64 36 82"></polygon>`
  } else if (shape === 'arrow-right') {
    svg.innerHTML = `<polygon ${attrs} points="94 50 64 18 64 36 6 36 6 64 64 64 64 82"></polygon>`
  } else {
    svg.innerHTML = `<rect ${attrs} x="8" y="8" width="84" height="84" rx="8"></rect>`
  }
}

function renderPathSvg(svg, el) {
  const points = sanitizeCanvasPath(el.path)
  const width = Math.max(1, Number(el.pathBoxWidth) || Number(el.width) || 1)
  const height = Math.max(1, Number(el.pathBoxHeight) || Number(el.height) || 1)
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.replaceChildren()
  if (!points.length) return
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  polyline.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '))
  polyline.setAttribute('class', 'canvas-path-mark')
  polyline.setAttribute('fill', 'none')
  polyline.setAttribute('stroke-width', String(Number(el.strokeWidth) || 3))
  polyline.setAttribute('stroke-linecap', 'round')
  polyline.setAttribute('stroke-linejoin', 'round')
  polyline.setAttribute('vector-effect', 'non-scaling-stroke')
  svg.append(polyline)
}

function createCanvasElementActions(el) {
  const actions = document.createElement('div')
  actions.className = 'canvas-el-actions'

  const size = document.createElement('span')
  size.className = 'canvas-el-size'
  size.textContent = `${Math.round(el.width)} × ${Math.round(el.height)}`
  actions.append(size)

  const flow = document.createElement('button')
  flow.type = 'button'
  flow.className = 'canvas-el-action'
  flow.textContent = '用此图生成'
  flow.addEventListener('mousedown', (event) => event.stopPropagation())
  flow.addEventListener('click', (event) => {
    event.stopPropagation()
    connectFlow(el.id)
  })
  actions.append(flow)

  const download = document.createElement('button')
  download.type = 'button'
  download.className = 'canvas-el-action'
  download.textContent = '下载'
  download.addEventListener('mousedown', (event) => event.stopPropagation())
  download.addEventListener('click', (event) => {
    event.stopPropagation()
    if (el.content) downloadAsset(el.content, `${sanitizeFileName(el.name || 'canvas-image')}.png`)
  })
  actions.append(download)

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'canvas-el-action danger'
  remove.textContent = '删除'
  remove.addEventListener('mousedown', (event) => event.stopPropagation())
  remove.addEventListener('click', (event) => {
    event.stopPropagation()
    deleteElement(el.id)
    state.generate.selectedIds = state.generate.selectedIds.filter((id) => id !== el.id)
    hideGenPanel()
    renderCanvas()
    saveRuntimeState()
  })
  actions.append(remove)

  return actions
}

function getLinkedCanvasElementIds() {
  const selectedIds = new Set(state.generate.selectedIds)
  const linkedIds = new Set()
  const groupIds = new Set()

  for (const el of state.generate.elements) {
    if (!selectedIds.has(el.id)) continue
    if (el.groupId) groupIds.add(el.groupId)
    for (const linkedId of el.linkedElements || []) linkedIds.add(linkedId)
    if (el.type === 'connector') {
      if (el.connectorFrom) linkedIds.add(el.connectorFrom)
      if (el.connectorTo) linkedIds.add(el.connectorTo)
    }
  }

  for (const el of state.generate.elements) {
    if (el.groupId && groupIds.has(el.groupId)) linkedIds.add(el.id)
    if (el.type === 'connector' && (selectedIds.has(el.connectorFrom) || selectedIds.has(el.connectorTo))) {
      linkedIds.add(el.connectorFrom)
      linkedIds.add(el.connectorTo)
    }
  }

  for (const id of selectedIds) linkedIds.delete(id)
  return linkedIds
}

function renderConnectors() {
  const svg = dom.gConnectors
  svg.innerHTML = ''
  const linkedIds = getLinkedCanvasElementIds()
  const selectedIds = new Set(state.generate.selectedIds)
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
  marker.setAttribute('id', 'canvas-arrowhead')
  marker.setAttribute('markerWidth', '10')
  marker.setAttribute('markerHeight', '10')
  marker.setAttribute('refX', '8')
  marker.setAttribute('refY', '3')
  marker.setAttribute('orient', 'auto')
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
  arrow.setAttribute('points', '0 0, 8 3, 0 6')
  arrow.setAttribute('fill', 'var(--accent)')
  marker.append(arrow)
  defs.append(marker)
  svg.append(defs)

  const connectors = state.generate.elements.filter((el) => el.type === 'connector')
  for (const conn of connectors) {
    const from = state.generate.elements.find((item) => item.id === conn.connectorFrom)
    const to = state.generate.elements.find((item) => item.id === conn.connectorTo)
    if (!from || !to) continue

    const x1 = (from.x + from.width) * state.generate.scale + state.generate.panX
    const y1 = (from.y + from.height / 2) * state.generate.scale + state.generate.panY
    const x2 = to.x * state.generate.scale + state.generate.panX
    const y2 = (to.y + to.height / 2) * state.generate.scale + state.generate.panY

    const bend = Math.max(60, Math.abs(x2 - x1) * 0.4)
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', 'var(--accent)')
    path.setAttribute('stroke-width', '2')
    path.setAttribute('stroke-dasharray', '6 5')
    path.setAttribute('marker-end', 'url(#canvas-arrowhead)')
    path.setAttribute('class', `canvas-connector${selectedIds.has(from.id) || selectedIds.has(to.id) || linkedIds.has(from.id) || linkedIds.has(to.id) ? ' linked' : ''}`)
    svg.append(path)
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
        setCanvasTool('select')
        renderCanvas()
        saveRuntimeState()
      } else if (tool === 'ai-gen') {
        addGeneratorToCanvas()
        setCanvasTool('select')
        renderCanvas()
        saveRuntimeState()
      } else if (isShapeTool(tool)) {
        addShapeToCanvas(getShapeFromTool(tool))
        setCanvasTool('select')
        renderCanvas()
        saveRuntimeState()
      }
    })
  }

  dom.gFileInput.addEventListener('change', async () => {
    if (!dom.gFileInput.files?.length) return
    const images = await prepareAssetItems(dom.gFileInput.files, { kind: 'upload', source: 'canvas_upload' })
    for (let i = 0; i < images.length; i++) {
      addImageToCanvas(images[i].dataUrl, images[i].name, undefined, undefined, {
        assetId: images[i].assetId,
        mime: images[i].mime,
        width: images[i].width,
        height: images[i].height,
      })
    }
    dom.gFileInput.value = ''
    setCanvasTool('select')
    renderCanvas()
    saveRuntimeState()
  })
}

function setCanvasTool(tool) {
  state.generate.activeTool = tool
  if (isShapeTool(tool)) state.generate.shapeTool = getShapeFromTool(tool)
  for (const btn of $$('.toolbar-btn', dom.gToolbar)) {
    btn.classList.toggle('active', btn.dataset.tool === tool)
  }
  applyCanvasToolCursor()
}

function isShapeTool(tool) {
  return String(tool || '').startsWith('shape:')
}

function getShapeFromTool(tool) {
  return normalizeCanvasShape(String(tool || '').replace(/^shape:/, ''))
}

function bindCanvasGuide() {
  dom.gGuideClose.addEventListener('click', dismissCanvasGuide)
  dom.gGuideAddImage.addEventListener('click', () => {
    dismissCanvasGuide()
    dom.gFileInput.click()
  })
  dom.gGuideAddGen.addEventListener('click', () => {
    dismissCanvasGuide()
    addGeneratorToCanvas()
    setCanvasTool('select')
    renderCanvas()
    saveRuntimeState()
  })
}

function ensureCanvasFirstOpenAiPanel() {
  if (state.activeView !== 'generate') return
  if (localStorage.getItem(CANVAS_AI_FIRST_OPEN_STORAGE) === 'opened') return
  state.generate.showAiPanel = true
  localStorage.setItem(CANVAS_AI_FIRST_OPEN_STORAGE, 'opened')
}

function renderCanvasGuide(elementCount = state.generate.elements.filter((el) => el.type !== 'connector').length) {
  if (!dom.gGuide) return
  const dismissed = localStorage.getItem(CANVAS_GUIDE_STORAGE) === 'dismissed'
  const shouldShow = state.activeView === 'generate' && elementCount === 0 && !dismissed
  dom.gGuide.classList.toggle('hidden', !shouldShow)
}

function dismissCanvasGuide() {
  localStorage.setItem(CANVAS_GUIDE_STORAGE, 'dismissed')
  dom.gGuide.classList.add('hidden')
}

function markCanvasGuideSeen() {
  localStorage.setItem(CANVAS_GUIDE_STORAGE, 'dismissed')
  if (dom.gGuide) dom.gGuide.classList.add('hidden')
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
  dom.gGenResolution.value = state.generate.genResolution
  dom.gAgent.checked = state.generate.genUseAgent
  dom.gGenRun.disabled = false

  renderGenPanelRefs()
  dom.gGenPanel.classList.remove('hidden')
  dom.gGenProgress.classList.add('hidden')

  // Position panel near the element
  const rect = dom.gCanvasContainer.getBoundingClientRect()
  const viewRect = $('#view-generate').getBoundingClientRect()
  const panelWidth = 380
  const panelGap = 16
  const reservedRight = state.generate.showAiPanel && !dom.gAiSidebar.classList.contains('hidden')
    ? dom.gAiSidebar.offsetWidth + 32
    : 8
  const elScreenX = el.x * state.generate.scale + state.generate.panX + rect.left + el.width * state.generate.scale + 16
  const elScreenY = el.y * state.generate.scale + state.generate.panY + rect.top
  const elLeftScreenX = el.x * state.generate.scale + state.generate.panX + rect.left
  const maxPanelLeft = Math.max(8, viewRect.width - panelWidth - reservedRight)
  let panelLeft = elScreenX - viewRect.left
  if (panelLeft > maxPanelLeft) {
    panelLeft = elLeftScreenX - viewRect.left - panelWidth - panelGap
  }
  dom.gGenPanel.style.left = `${clamp(panelLeft, 8, maxPanelLeft)}px`
  dom.gGenPanel.style.top = `${clamp(elScreenY - viewRect.top, 8, viewRect.height - 400)}px`
}

function hideGenPanel() {
  dom.gGenPanel.classList.add('hidden')
  state.generate.genTargetId = ''
}

function refreshGenPanelPosition() {
  if (dom.gGenPanel.classList.contains('hidden') || !state.generate.genTargetId) return
  showGenPanel(state.generate.genTargetId)
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
    state.generate.genRatio = normalizeAspectRatio(dom.gGenRatio.value)
    dom.gAiRatio.value = state.generate.genRatio
    savePrefs()
  })

  dom.gGenResolution.addEventListener('change', () => {
    state.generate.genResolution = normalizeCanvasResolution(dom.gGenResolution.value)
    dom.gAiResolution.value = state.generate.genResolution
    savePrefs()
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
      resolution: state.generate.genResolution,
      useDesignAgent: state.generate.genUseAgent,
      clientKeys: { ...state.keys },
    })

    state.runtime.sessionId = data.sessionId || state.runtime.sessionId
    const storedResult = await uploadCanvasImageAsset(data.resultDataUrl, `generated-${el.id}.png`, {
      kind: 'result',
      source: 'canvas_generation',
    })
    const imageSize = await getImageDimensions(data.resultDataUrl).catch(() => null)

    // Replace generator with image element
    el.type = 'image'
    el.content = data.resultDataUrl
    el.name = `generated-${el.id}`
    el.mime = storedResult.mime
    el.assetId = storedResult.assetId
    el.aspectRatio = state.generate.genRatio
    el.resolution = state.generate.genResolution
    const size = getCanvasImageSize(state.generate.genRatio, imageSize?.width, imageSize?.height)
    el.width = size.width
    el.height = size.height

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

  dom.gAiMessages.addEventListener('click', (event) => {
    const suggestion = event.target.closest('[data-ai-prompt]')
    if (!suggestion) return
    dom.gInput.value = suggestion.dataset.aiPrompt || ''
    dom.gInput.focus()
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
    state.generate.genRatio = normalizeAspectRatio(dom.gAiRatio.value)
    dom.gGenRatio.value = state.generate.genRatio
    savePrefs()
  })

  dom.gAiResolution.addEventListener('change', () => {
    state.generate.genResolution = normalizeCanvasResolution(dom.gAiResolution.value)
    dom.gGenResolution.value = state.generate.genResolution
    savePrefs()
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
  if (state.generate.aiMessages.length === 0) {
    dom.gAiMessages.replaceChildren(createAiWelcomeNode())
    dom.gAiMessages.scrollTop = 0
    return
  }

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
    if (Array.isArray(msg.steps) && msg.steps.length) {
      const steps = document.createElement('ul')
      steps.className = 'msg-steps'
      for (const step of msg.steps.slice(0, 4)) {
        const item = document.createElement('li')
        item.textContent = step
        steps.append(item)
      }
      node.append(steps)
    }
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

function createAiWelcomeNode() {
  const wrap = document.createElement('div')
  wrap.className = 'ai-welcome'

  const mark = document.createElement('div')
  mark.className = 'ai-welcome-mark'
  mark.textContent = 'AI'
  wrap.append(mark)

  const title = document.createElement('h4')
  title.textContent = 'Hi，我是你的 AI 设计师'
  wrap.append(title)

  const copy = document.createElement('p')
  copy.textContent = '我会读取当前画布上下文，先整理设计意图，再按需生成图片并放回画布。'
  wrap.append(copy)

  const suggestions = document.createElement('div')
  suggestions.className = 'ai-suggestions'
  const items = [
    ['生成一张品牌主图', '基于当前参考图生成一张电商主图，留出标题区，背景干净但有质感。'],
    ['整理画布方案', '帮我分析当前画布，给出下一步生成流和视觉改进建议，先不要出图。'],
    ['延展同款风格', '沿用当前画布里的风格和主体，生成一张不同构图的社媒海报。'],
  ]
  for (const [label, prompt] of items) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ai-suggestion'
    button.dataset.aiPrompt = prompt
    const strong = document.createElement('strong')
    strong.textContent = label
    const span = document.createElement('span')
    span.textContent = prompt
    button.append(strong, span)
    suggestions.append(button)
  }
  wrap.append(suggestions)

  return wrap
}

function getCanvasAgentContext() {
  const visible = state.generate.elements.filter((el) => el.type !== 'connector')
  const counts = visible.reduce((acc, el) => {
    acc[el.type] = (acc[el.type] || 0) + 1
    return acc
  }, {})
  return {
    projectTitle: state.generate.projectTitle || DEFAULT_CANVAS_PROJECT_TITLE,
    elementCount: visible.length,
    selectedIds: [...state.generate.selectedIds],
    counts,
    elements: visible.slice(0, 24).map((el) => ({
      id: el.id,
      type: el.type,
      name: el.name || '',
      selected: state.generate.selectedIds.includes(el.id),
      aspectRatio: el.aspectRatio || '',
      resolution: el.resolution || '',
      width: Math.round(Number(el.width) || 0),
      height: Math.round(Number(el.height) || 0),
      prompt: el.generatingPrompt || '',
    })),
  }
}

async function sendCanvasAiMessage() {
  if (state.generate.aiRunning) return
  const text = dom.gInput.value.trim()
  if (!text && state.generate.aiRefs.length === 0) return
  const requestText = text || '基于参考图生成一版。'
  const history = state.generate.aiMessages
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
    .map((msg) => ({ role: msg.role, content: msg.content || '' }))
    .slice(-8)

  const userMsg = {
    id: crypto.randomUUID(),
    role: 'user',
    content: requestText,
    refs: state.generate.aiRefs.map((r) => ({ dataUrl: r.dataUrl, name: r.name })),
  }
  const assistantMsg = { id: crypto.randomUUID(), role: 'assistant', content: '正在理解画布和需求…', steps: [] }
  state.generate.aiMessages.push(userMsg)
  dom.gInput.value = ''
  state.generate.aiRunning = true
  state.generate.aiMessages.push(assistantMsg)
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

    const agentData = await postJson('/api/canvas/agent', {
      sessionId: state.runtime.sessionId || undefined,
      message: requestText,
      history,
      canvasContext: getCanvasAgentContext(),
      modelId: dom.gAiModel.value || state.generate.genModel,
      aspectRatio: normalizeAspectRatio(dom.gAiRatio.value || state.generate.genRatio),
      resolution: normalizeCanvasResolution(dom.gAiResolution.value || state.generate.genResolution),
      hasReferenceImages: refImages.length > 0,
      clientKeys: { ...state.keys },
    })
    state.runtime.sessionId = agentData.sessionId || state.runtime.sessionId
    assistantMsg.content = agentData.reply || '我已经整理好设计方向。'
    assistantMsg.steps = Array.isArray(agentData.steps) ? agentData.steps : []
    renderAiMessages()

    if (!agentData.shouldGenerate) {
      saveRuntimeState()
      return
    }

    assistantMsg.content = `${assistantMsg.content}\n\n正在按这个方向生成图片…`
    renderAiMessages()

    const data = await postJson('/api/generate-direct', {
      sessionId: state.runtime.sessionId || undefined,
      modelId: dom.gAiModel.value || state.generate.genModel,
      prompt: agentData.prompt || requestText,
      referenceImages: refImages,
      aspectRatio: normalizeAspectRatio(dom.gAiRatio.value || state.generate.genRatio),
      resolution: normalizeCanvasResolution(dom.gAiResolution.value || state.generate.genResolution),
      useDesignAgent: false,
      clientKeys: { ...state.keys },
    })

    state.runtime.sessionId = data.sessionId || state.runtime.sessionId
    const storedResult = await uploadCanvasImageAsset(data.resultDataUrl, `ai-${Date.now()}.png`, {
      kind: 'result',
      source: 'canvas_ai_sidebar',
    })
    const imageSize = await getImageDimensions(data.resultDataUrl).catch(() => null)

    assistantMsg.content = `${agentData.reply || '已生成图片'}\n\n图片已添加到画布。`
    assistantMsg.imageDataUrl = data.resultDataUrl
    assistantMsg.aspectRatio = normalizeAspectRatio(dom.gAiRatio.value || state.generate.genRatio)

    addImageToCanvas(data.resultDataUrl, `ai-${Date.now()}`, undefined, undefined, {
      assetId: storedResult.assetId,
      mime: storedResult.mime,
      aspectRatio: normalizeAspectRatio(dom.gAiRatio.value || state.generate.genRatio),
      resolution: normalizeCanvasResolution(dom.gAiResolution.value || state.generate.genResolution),
      width: imageSize?.width,
      height: imageSize?.height,
    })
    state.generate.aiRefs = []
    renderAiRefList()
    renderCanvas()
    saveRuntimeState()
  } catch (error) {
    assistantMsg.content = `处理失败：${trimError(error)}`
  } finally {
    state.generate.aiRunning = false
    renderAiMessages()
  }
}

/* ═══════════════ RENDER GENERATE ═══════════════ */

function renderGenerate() {
  if (state.activeView === 'generate' && runtimeStateReady && !state.generate.projectId && !restoringRuntimeState) {
    void ensureCanvasProjectRecord().catch(() => {
      state.generate.projectSaveStatus = 'local'
      renderCanvasProjectMeta()
    })
  }
  dom.gModel.value = state.generate.genModel
  dom.gAiModel.value = state.generate.genModel
  dom.gGenRatio.value = state.generate.genRatio
  dom.gAiRatio.value = state.generate.genRatio
  dom.gGenResolution.value = state.generate.genResolution
  dom.gAiResolution.value = state.generate.genResolution
  dom.gAgent.checked = state.generate.genUseAgent
  dom.gAiSidebar.classList.toggle('hidden', !state.generate.showAiPanel)
  renderCanvasProjectMeta()
  renderAiMessages()
  renderAiRefList()
  applyCanvasToolCursor()
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
  renderHome()
  renderTranslateDropdowns()
  renderTranslate()
  renderProjects()
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

function renderHome() {
  if (!dom.hRecentList) return
  if (dom.hPrompt && document.activeElement !== dom.hPrompt) {
    dom.hPrompt.value = state.home.prompt || ''
  }

  const { items, loading, error } = state.projects
  if (dom.hRecentStatus) {
    dom.hRecentStatus.textContent = loading
      ? '正在读取最近项目…'
      : error
        ? error
        : items.length
          ? `${items.length} 个已保存项目`
          : '还没有保存项目'
  }

  const cards = [createHomeNewProjectCard()]
  if (loading && !items.length) {
    cards.push(createProjectSkeleton(), createProjectSkeleton(), createProjectSkeleton())
  } else {
    cards.push(...items.slice(0, 3).map(createProjectCard))
  }
  dom.hRecentList.replaceChildren(...cards)
}

function createHomeNewProjectCard() {
  const card = document.createElement('button')
  card.type = 'button'
  card.className = 'home-new-card'
  card.dataset.homeNew = '1'

  const mark = document.createElement('span')
  mark.className = 'home-new-mark'
  mark.textContent = '＋'

  const text = document.createElement('strong')
  text.textContent = '新建画布'

  card.append(mark, text)
  return card
}

function renderProjects() {
  if (!dom.pList) return
  const { items, loading, error } = state.projects
  dom.pCount.textContent = `${items.length} 个项目`
  dom.pStatus.textContent = loading ? '加载中…' : (error || '')
  dom.pRefresh.disabled = loading
  dom.pNew.disabled = loading && !items.length

  if (loading && !items.length) {
    dom.pList.replaceChildren(createProjectSkeleton(), createProjectSkeleton(), createProjectSkeleton())
    dom.pEmpty.classList.add('hidden')
    return
  }

  dom.pList.replaceChildren(...items.map(createProjectCard))
  dom.pEmpty.classList.toggle('hidden', items.length > 0 || loading)
}

function createProjectSkeleton() {
  const card = document.createElement('div')
  card.className = 'project-card'
  card.innerHTML = `
    <div class="project-thumb"><span class="project-thumb-placeholder">·</span></div>
    <div class="project-meta"><strong>加载中…</strong><span>正在读取项目</span></div>
  `
  return card
}

function createProjectCard(project) {
  const card = document.createElement('button')
  card.type = 'button'
  card.className = 'project-card'
  card.dataset.projectId = project.id
  card.title = `打开 ${project.title || DEFAULT_CANVAS_PROJECT_TITLE}`

  const thumb = document.createElement('div')
  thumb.className = 'project-thumb'
  if (project.previewUrl) {
    const img = document.createElement('img')
    img.src = project.previewUrl
    img.alt = project.title || DEFAULT_CANVAS_PROJECT_TITLE
    thumb.append(img)
  } else {
    const placeholder = document.createElement('span')
    placeholder.className = 'project-thumb-placeholder'
    placeholder.textContent = '◇'
    thumb.append(placeholder)
  }
  card.append(thumb)

  const meta = document.createElement('div')
  meta.className = 'project-meta'
  const title = document.createElement('strong')
  title.textContent = project.title || DEFAULT_CANVAS_PROJECT_TITLE
  const detail = document.createElement('span')
  const count = Number(project.elementCount || 0)
  detail.textContent = `${formatRelativeTime(project.updatedAt)} · ${count} 个元素`
  meta.append(title, detail)
  card.append(meta)

  return card
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

function setActiveView(view, { updateRoute = true } = {}) {
  state.activeView = normalizeView(view)
  if (state.activeView === 'generate') {
    ensureCanvasFirstOpenAiPanel()
  }
  if (updateRoute) {
    const targetPath = routeForView(state.activeView)
    const currentPath = `${window.location.pathname}${window.location.search}`
    if (targetPath && currentPath !== targetPath) {
      window.history.pushState({}, '', targetPath)
    }
  }
  savePrefs()
  renderShell()
  if (state.activeView === 'generate') {
    renderGenerate()
  } else if (state.activeView === 'home') {
    renderHome()
    void loadCanvasProjects()
  } else if (state.activeView === 'projects') {
    renderProjects()
    void loadCanvasProjects()
  }
  const scrollToTop = () => {
    $('.main')?.scrollTo({ top: 0, behavior: 'auto' })
    window.scrollTo({ top: 0, behavior: 'auto' })
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }
  scrollToTop()
  requestAnimationFrame(scrollToTop)
}

function routeForView(view) {
  if (view === 'generate' && state.generate.projectId) {
    return `/lovart/canvas?id=${encodeURIComponent(state.generate.projectId)}`
  }
  return VIEW_ROUTES[view]
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
    const size = await getImageDimensions(data.dataUrl).catch(() => null)
    images.push({
      id: crypto.randomUUID(),
      name: file.name,
      mime: file.type || 'image/jpeg',
      base64: data.base64,
      dataUrl: data.dataUrl,
      width: size?.width || 0,
      height: size?.height || 0,
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
      width: image.width,
      height: image.height,
      label: basename(image.name),
      role: '',
    })
  }

  saveRuntimeState()
  return uploaded
}

async function uploadCanvasImageAsset(dataUrl, name, { kind = 'upload', source = 'canvas_upload' } = {}) {
  const mime = splitDataUrl(dataUrl)?.mime || 'image/png'
  const data = await postJson('/api/assets/upload', {
    sessionId: state.runtime.sessionId || undefined,
    kind,
    source,
    filename: name || 'canvas-image.png',
    mime,
    dataUrl,
  })
  state.runtime.sessionId = data.sessionId || state.runtime.sessionId
  return {
    assetId: data.asset.id,
    mime: data.asset.mime || mime,
  }
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

function renderCanvasProjectMeta() {
  if (dom.gProjectTitle && document.activeElement !== dom.gProjectTitle) {
    dom.gProjectTitle.value = state.generate.projectTitle || DEFAULT_CANVAS_PROJECT_TITLE
  }
  if (!dom.gProjectStatus) return
  const status = state.generate.projectSaveStatus
  dom.gProjectStatus.textContent = status === 'saving'
    ? '保存中'
    : status === 'saved'
      ? '已保存'
      : status === 'local'
        ? '本地缓存'
        : ''
}

async function startCanvasFromHomePrompt() {
  const prompt = (dom.hPrompt?.value || state.home.prompt || '').trim()
  await startNewCanvasProject({ initialPrompt: prompt })
}

async function startNewCanvasProject({ initialPrompt = '' } = {}) {
  if (state.generate.genRunning || state.generate.aiRunning) return
  state.generate.projectId = ''
  state.generate.projectTitle = initialPrompt ? initialPrompt.slice(0, 36) : DEFAULT_CANVAS_PROJECT_TITLE
  state.generate.projectSaveStatus = ''
  state.generate.elements = []
  state.generate.selectedIds = []
  state.generate.scale = 1
  state.generate.panX = 0
  state.generate.panY = 0
  state.generate.genTargetId = ''
  state.generate.showAiPanel = true
  hideGenPanel()
  hideContextMenu()
  ensureCanvasFirstOpenAiPanel()
  window.history.pushState({}, '', '/lovart/canvas')
  state.activeView = 'generate'
  saveRuntimeState({ persistCanvas: false })
  renderShell()
  renderGenerate()
  if (initialPrompt && dom.gInput) {
    dom.gInput.value = initialPrompt
    dom.gInput.focus()
  }
  try {
    await ensureCanvasProjectRecord()
    await persistCanvasProject()
    state.projects.loadedSessionId = ''
  } catch {
    state.generate.projectSaveStatus = 'local'
    renderCanvasProjectMeta()
  }
}

async function openCanvasProject(projectId) {
  if (!projectId) return
  state.projects.error = '正在打开项目…'
  renderProjects()
  try {
    const snapshot = await loadCanvasProjectSnapshot(projectId)
    state.generate.projectId = projectId
    state.generate.projectTitle = snapshot.project?.title || DEFAULT_CANVAS_PROJECT_TITLE
    state.generate.elements = await hydrateCanvasElements(snapshot.elements || [])
    state.generate.selectedIds = []
    state.generate.scale = 1
    state.generate.panX = 0
    state.generate.panY = 0
    state.generate.projectSaveStatus = 'saved'
    hideGenPanel()
    hideContextMenu()
    ensureCanvasFirstOpenAiPanel()
    window.history.pushState({}, '', `/lovart/canvas?id=${encodeURIComponent(projectId)}`)
    state.activeView = 'generate'
    saveRuntimeState({ persistCanvas: false })
    renderShell()
    renderGenerate()
    state.projects.error = ''
  } catch (error) {
    state.projects.error = trimError(error)
    renderProjects()
  }
}

async function loadCanvasProjects({ force = false } = {}) {
  if (!dom.pList) return
  const sessionId = state.runtime.sessionId || ''
  if (!sessionId) {
    state.projects.items = []
    state.projects.loading = false
    state.projects.loadedSessionId = ''
    state.projects.error = ''
    renderProjects()
    renderHome()
    return
  }
  if (!force && state.projects.loadedSessionId === sessionId && state.projects.items.length) {
    renderProjects()
    renderHome()
    return
  }

  state.projects.loading = true
  state.projects.error = ''
  renderProjects()
  renderHome()

  try {
    const data = await getJson(`/api/canvas/projects?sessionId=${encodeURIComponent(sessionId)}`)
    const projects = Array.isArray(data.projects) ? data.projects : []
    const enriched = await Promise.all(projects.map(enrichCanvasProjectCard))
    state.projects.items = enriched.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    state.projects.loadedSessionId = sessionId
  } catch (error) {
    state.projects.error = trimError(error)
  } finally {
    state.projects.loading = false
    renderProjects()
    renderHome()
  }
}

async function enrichCanvasProjectCard(project) {
  try {
    const data = await getJson(`/api/canvas/projects/${encodeURIComponent(project.id)}/elements`)
    const elements = Array.isArray(data.elements) ? data.elements : []
    const visibleElements = elements.filter((el) => el?.type !== 'connector')
    const firstImage = visibleElements.find((el) => el?.type === 'image' && (el.content || el.assetId))
    return {
      ...project,
      elementCount: visibleElements.length,
      previewUrl: firstImage?.content || (firstImage?.assetId ? assetResultUrl(firstImage.assetId) : ''),
    }
  } catch {
    return {
      ...project,
      elementCount: 0,
      previewUrl: '',
    }
  }
}

function scheduleCanvasProjectSave() {
  if (restoringRuntimeState) return
  if (state.activeView !== 'generate' && !state.generate.projectId) return
  window.clearTimeout(canvasSaveTimer)
  canvasSaveTimer = window.setTimeout(() => {
    void persistCanvasProject()
  }, 450)
}

async function ensureCanvasProjectRecord() {
  if (state.generate.projectId) return state.generate.projectId
  if (canvasProjectCreateInFlight) return canvasProjectCreateInFlight

  canvasProjectCreateInFlight = (async () => {
    const data = await postJson('/api/canvas/projects', {
      sessionId: state.runtime.sessionId || undefined,
      title: state.generate.projectTitle || DEFAULT_CANVAS_PROJECT_TITLE,
    })
    state.runtime.sessionId = data.sessionId || state.runtime.sessionId
    state.generate.projectId = data.project?.id || ''
    state.generate.projectTitle = data.project?.title || state.generate.projectTitle || DEFAULT_CANVAS_PROJECT_TITLE
    if (state.activeView === 'generate' && state.generate.projectId && window.location.pathname === '/lovart/canvas' && !canvasProjectIdFromLocation()) {
      window.history.replaceState({}, '', `/lovart/canvas?id=${encodeURIComponent(state.generate.projectId)}`)
    }
    saveRuntimeState({ persistCanvas: false })
    renderCanvasProjectMeta()
    return state.generate.projectId
  })()

  try {
    return await canvasProjectCreateInFlight
  } finally {
    canvasProjectCreateInFlight = null
  }
}

async function persistCanvasProject() {
  if (restoringRuntimeState) return
  if (canvasSaveInFlight) {
    canvasSavePending = true
    return canvasSaveInFlight
  }

  canvasSaveInFlight = (async () => {
    state.generate.projectSaveStatus = 'saving'
    renderCanvasProjectMeta()
    try {
      await ensureCanvasProjectRecord()
      if (!state.generate.projectId) throw new Error('Canvas project id missing')
      const projectUrl = `/api/canvas/projects/${encodeURIComponent(state.generate.projectId)}`
      const projectBody = {
        sessionId: state.runtime.sessionId || undefined,
        title: state.generate.projectTitle || DEFAULT_CANVAS_PROJECT_TITLE,
      }

      try {
        await putJson(projectUrl, projectBody)
      } catch (error) {
        if (error?.status !== 404) throw error
        state.generate.projectId = ''
        await ensureCanvasProjectRecord()
      }

      await putJson(`/api/canvas/projects/${encodeURIComponent(state.generate.projectId)}/elements`, {
        sessionId: state.runtime.sessionId || undefined,
        elements: state.generate.elements.map((el) => serializeCanvasElement(el)),
      })
      state.generate.projectSaveStatus = 'saved'
      state.projects.loadedSessionId = ''
    } catch {
      state.generate.projectSaveStatus = 'local'
    } finally {
      renderCanvasProjectMeta()
      saveRuntimeState({ persistCanvas: false })
      canvasSaveInFlight = null
      if (canvasSavePending) {
        canvasSavePending = false
        scheduleCanvasProjectSave()
      }
    }
  })()

  return canvasSaveInFlight
}

async function loadCanvasProjectSnapshot(projectId) {
  if (!projectId) return null
  const projectUrl = `/api/canvas/projects/${encodeURIComponent(projectId)}`
  const [projectData, elementsData] = await Promise.all([
    getJson(projectUrl),
    getJson(`${projectUrl}/elements`),
  ])
  return {
    project: projectData.project,
    elements: Array.isArray(elementsData.elements)
      ? elementsData.elements.map((el) => sanitizeCanvasElement(el)).filter(Boolean)
      : [],
  }
}

async function hydrateCanvasElements(elements) {
  const imageElements = elements.filter((el) => el.type === 'image' && el.assetId)
  if (!imageElements.length) return elements

  const hydratedImages = await hydrateAssetItems(imageElements.map((el) => ({
    id: el.assetId,
    assetId: el.assetId,
    name: el.name,
    mime: el.mime || 'image/png',
  })))
  const byAssetId = new Map(hydratedImages.map((item) => [item.assetId || item.id, item]))

  return elements.map((el) => {
    if (el.type !== 'image' || !el.assetId) return el
    const hydrated = byAssetId.get(el.assetId)
    if (!hydrated?.dataUrl) return el
    return {
      ...el,
      content: hydrated.dataUrl,
      name: el.name || hydrated.name,
      mime: hydrated.mime || el.mime,
    }
  })
}

async function restoreRuntimeState() {
  restoringRuntimeState = true
  const runtime = sanitizeRuntimeState(loadRuntimeState())
  const routeProjectId = state.activeView === 'generate' ? canvasProjectIdFromLocation() : ''
  state.runtime.sessionId = runtime.sessionId
  state.translate.jobId = runtime.translate.jobId
  state.generate.projectId = routeProjectId || runtime.generate.projectId || ''
  state.generate.projectTitle = runtime.generate.projectTitle || DEFAULT_CANVAS_PROJECT_TITLE
  let canvasElements = runtime.generate.elements || []
  if (state.generate.projectId) {
    try {
      const snapshot = await loadCanvasProjectSnapshot(state.generate.projectId)
      if (snapshot) {
        state.generate.projectTitle = snapshot.project?.title || state.generate.projectTitle
        canvasElements = snapshot.elements
        state.generate.projectSaveStatus = 'saved'
      }
    } catch {
      state.generate.projectSaveStatus = 'local'
    }
  }
  state.generate.elements = await hydrateCanvasElements(canvasElements)
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

  restoringRuntimeState = false
  runtimeStateReady = true
  saveRuntimeState({ persistCanvas: false })
  renderAll()
  if (state.activeView === 'home' || state.activeView === 'projects') {
    void loadCanvasProjects()
  }

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

function getImageDimensions(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({
      width: image.naturalWidth || image.width || 0,
      height: image.naturalHeight || image.height || 0,
    })
    image.onerror = () => reject(new Error('Failed to read image dimensions'))
    image.src = src
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

async function putJson(url, body) {
  const response = await fetch(url, {
    method: 'PUT',
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

function hydrateSettingsForm() {
  hydrateKeyForm()
  hydrateThemeForm()
}

function hydrateKeyForm() {
  $('#k-vision').value = state.keys.visionApiKey || ''
  $('#k-banana2').value = state.keys.banana2ApiKey || ''
  $('#k-bananapro').value = state.keys.bananaProApiKey || ''
  $('#k-gptimage').value = state.keys.gptImageApiKey || ''
}

function hydrateThemeForm() {
  for (const input of $$('input[name="settings-theme"]')) {
    input.checked = input.value === state.theme
  }
}

function getSelectedSettingsTheme() {
  const selected = $('input[name="settings-theme"]:checked')
  return normalizeTheme(selected?.value)
}

function normalizeTheme(value) {
  return value === 'light' ? 'light' : 'dark'
}

function normalizeAspectRatio(value, fallback = '1:1') {
  const ratio = String(value || '').trim()
  return ['1:1', '4:3', '3:4', '16:9', '9:16'].includes(ratio) ? ratio : fallback
}

function normalizeCanvasResolution(value, fallback = '1k') {
  const resolution = String(value || '').trim().toLowerCase()
  return CANVAS_RESOLUTIONS.has(resolution) ? resolution : fallback
}

function applyTheme() {
  state.theme = normalizeTheme(state.theme)
  document.documentElement.dataset.theme = state.theme
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
  return ['home', 'translate', 'generate', 'projects', 'outfit', 'style'].includes(view) ? view : 'home'
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

function formatRelativeTime(ts) {
  if (!ts) return '刚刚编辑'
  const time = new Date(ts).getTime()
  if (!Number.isFinite(time)) return '刚刚编辑'
  const diff = Date.now() - time
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚编辑'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前编辑`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前编辑`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前编辑`
  return new Date(ts).toLocaleDateString('zh-CN')
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

function getCanvasImageSize(aspectRatio = '1:1', width, height) {
  const explicitWidth = Number(width)
  const explicitHeight = Number(height)
  if (Number.isFinite(explicitWidth) && explicitWidth > 0 && Number.isFinite(explicitHeight) && explicitHeight > 0) {
    const maxSide = 360
    const scale = Math.min(1, maxSide / Math.max(explicitWidth, explicitHeight))
    return {
      width: Math.max(80, Math.round(explicitWidth * scale)),
      height: Math.max(80, Math.round(explicitHeight * scale)),
    }
  }

  const [w, h] = normalizeAspectRatio(aspectRatio).split(':').map((part) => Number(part) || 1)
  const baseArea = 300 * 300
  const ratio = w / h
  const nextWidth = Math.sqrt(baseArea * ratio)
  const nextHeight = nextWidth / ratio
  return {
    width: Math.round(clamp(nextWidth, 180, 420)),
    height: Math.round(clamp(nextHeight, 180, 420)),
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function rectsIntersect(a, b) {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1
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
