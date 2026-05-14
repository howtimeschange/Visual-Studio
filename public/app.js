import {
  basename,
  clamp,
  ensureImageExtension,
  formatRelativeTime,
  formatTimestamp,
  normalizeAspectRatio,
  normalizeCanvasResolution,
  normalizeView,
  readJson,
  rectsIntersect,
  sanitizeFileName,
  splitDataUrl,
  trimError,
  unique,
  wait,
} from './js/shared.js'

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
  { value: 'shoes', label: '鞋品' },
  { value: 'accessory', label: '配饰' },
]

const MODEL_LIBRARY_ITEMS = [
  {
    id: 'child-boy-baby',
    label: '婴儿男孩',
    age: 'child',
    ageLabel: '儿童',
    gender: 'male',
    genderLabel: '男',
    src: '/model-library/children/baby-boy.png',
  },
  {
    id: 'child-boy-toddler',
    label: '幼童男孩',
    age: 'child',
    ageLabel: '儿童',
    gender: 'male',
    genderLabel: '男',
    src: '/model-library/children/toddler-boy.jpg',
  },
  {
    id: 'child-boy-kids',
    label: '儿童男孩',
    age: 'child',
    ageLabel: '儿童',
    gender: 'male',
    genderLabel: '男',
    src: '/model-library/children/kids-boy.jpg',
  },
  {
    id: 'child-girl-baby',
    label: '婴儿女孩',
    age: 'child',
    ageLabel: '儿童',
    gender: 'female',
    genderLabel: '女',
    src: '/model-library/children/baby-girl.jpg',
  },
  {
    id: 'child-girl-toddler',
    label: '幼童女孩',
    age: 'child',
    ageLabel: '儿童',
    gender: 'female',
    genderLabel: '女',
    src: '/model-library/children/toddler-girl.jpg',
  },
  {
    id: 'child-girl-kids',
    label: '儿童女孩',
    age: 'child',
    ageLabel: '儿童',
    gender: 'female',
    genderLabel: '女',
    src: '/model-library/children/kids-girl.jpg',
  },
  {
    id: 'adult-female-1',
    label: '成人女模 1',
    age: 'adult',
    ageLabel: '成人',
    gender: 'female',
    genderLabel: '女',
    src: '/model-library/adults/female-1.png',
  },
  {
    id: 'adult-female-2',
    label: '成人女模 2',
    age: 'adult',
    ageLabel: '成人',
    gender: 'female',
    genderLabel: '女',
    src: '/model-library/adults/female-2.png',
  },
  {
    id: 'adult-female-3',
    label: '成人女模 3',
    age: 'adult',
    ageLabel: '成人',
    gender: 'female',
    genderLabel: '女',
    src: '/model-library/adults/female-3.png',
  },
  {
    id: 'adult-female-4',
    label: '成人女模 4',
    age: 'adult',
    ageLabel: '成人',
    gender: 'female',
    genderLabel: '女',
    src: '/model-library/adults/female-4.png',
  },
  {
    id: 'adult-male-1',
    label: '成人男模 1',
    age: 'adult',
    ageLabel: '成人',
    gender: 'male',
    genderLabel: '男',
    src: '/model-library/adults/male-1.png',
  },
]

const REFERENCE_ROLES = [
  { value: 'character', label: '人物一致性' },
  { value: 'subject', label: '主体 / 产品' },
  { value: 'style', label: '风格 / 色调' },
  { value: 'scene', label: '场景 / 构图' },
  { value: 'other', label: '其他参考' },
]

const AI_STREAM_CHUNK_SIZE = 2
const AI_STREAM_DELAY_MS = 16
const AI_STREAM_PUNCTUATION_DELAY_MS = 80
const AI_HISTORY_LIMIT = 40
const AI_HISTORY_INLINE_DATA_URL_LIMIT = 220_000
const AI_STORED_SESSION_LIMIT = 8
const AI_STORED_MESSAGE_LIMIT = 16
const AUTO_RETRY_LIMIT = 2
const AUTO_RETRY_DELAY_MS = 1200
const DEFAULT_AI_SESSION_TITLE = '当前会话'
const STYLE_HISTORY_LIMIT = 12
const RUNTIME_FALLBACK_TASK_LIMIT = 8
const RUNTIME_FALLBACK_ITEM_LIMIT = 24
const RUNTIME_FALLBACK_ELEMENT_LIMIT = 80
const RUNTIME_FALLBACK_SUBJECT_REF_LIMIT = 12
const RUNTIME_MIGRATION_NOTICE_MS = 5200
const CANVAS_SAVE_DEBOUNCE_MS = 2200
const CANVAS_GENERATE_POLL_INTERVAL_MS = 1600
const CANVAS_GENERATE_POLL_TIMEOUT_MS = 25 * 60 * 1000

const KEY_STORAGE = 'img-translator:keys:v1'
const PREF_STORAGE = 'img-translator:workbench:prefs:v1'
const LEGACY_TRANSLATE_PREF_STORAGE = 'img-translator:prefs:v1'
const RUNTIME_STORAGE = 'img-translator:runtime:v2'
const RESULTS_STORAGE = 'img-translator:results:v1'
const AUTH_RETURN_STORAGE = 'img-translator:auth-return:v1'
const CANVAS_AI_HISTORY_STORAGE = 'img-translator:canvas-ai-history:v1'
const CANVAS_AI_HISTORY_PROJECT_PREFIX = `${CANVAS_AI_HISTORY_STORAGE}:project:`
const CANVAS_GUIDE_STORAGE = 'img-translator:canvas-guide:v1'
const CANVAS_AI_FIRST_OPEN_STORAGE = 'img-translator:canvas-ai-opened:v1'
const DEFAULT_CANVAS_PROJECT_TITLE = '未命名画布'
const CANVAS_SHAPES = new Set(['square', 'circle', 'triangle', 'message', 'arrow-left', 'arrow-right'])
const VIEW_ROUTES = {
  home: '/',
  auth: '/lovart/auth',
  translate: '/?view=translate',
  generate: '/lovart/canvas',
  projects: '/lovart/projects',
  outfit: '/?view=outfit',
  style: '/?view=style',
}
const TERMINAL_JOB_STATUSES = new Set(['completed', 'partial_failed', 'failed', 'cancelled'])
const ACTIVE_JOB_STATUSES = new Set(['queued', 'running'])
const CURRENT_TASK_JOB_STATUSES = new Set(['queued', 'running', 'paused', 'partial_failed', 'failed'])
const KNOWN_JOB_STATUSES = new Set(['', 'queued', 'running', 'paused', 'completed', 'partial_failed', 'failed', 'cancelled'])
const JOB_TASKS_PER_PAGE = 5
let translateWatcherToken = 0
let outfitWatcherToken = 0
const translateJobWatchers = new Map()
const outfitJobWatchers = new Map()
let translateWorkspaceLoadToken = 0
let outfitWorkspaceLoadToken = 0
let canvasSpaceHeld = false
let canvasSaveTimer = 0
let canvasSaveInFlight = null
let canvasSavePending = false
let canvasProjectCreateInFlight = null
let canvasLastSavedSignature = ''
let restoringRuntimeState = false
let runtimeStateReady = false
let modelLibrarySelectedIds = new Set()

const state = {
  activeView: 'home',
  openDropdown: null,
  theme: 'light',
  keys: {},
  notice: {
    message: '',
    tone: '',
  },
  runtime: {
    sessionId: '',
  },
  translate: {
    source: 'auto',
    targets: ['en'],
    model: 'nano-banana-2',
    preserveBrand: true,
    concurrency: 3,
    items: [],
    running: false,
    progress: '',
    jobId: '',
    jobTab: 'current',
    jobPage: 1,
    jobs: [],
  },
  generate: {
    projectId: '',
    projectTitle: DEFAULT_CANVAS_PROJECT_TITLE,
    projectMetadata: {},
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
    aiSessionId: '',
    aiSessions: [],
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
    filterShared: false,
    deleting: false,
    deleteTargetId: '',
    deleteStatus: '',
  },
  taskDelete: {
    kind: '',
    jobId: '',
    deleting: false,
    status: '',
  },
  account: {
    user: null,
    usage: null,
    apiKeys: { keys: {}, updatedAt: '' },
    apiKeysLoadedFor: '',
    loading: false,
    error: '',
    status: '',
  },
  share: {
    loading: false,
    members: [],
    invites: [],
    owner: null,
    role: '',
    status: '',
  },
  home: {
    prompt: '',
  },
  outfit: {
    model: 'nano-banana-2',
    garmentType: 'full_outfit',
    concurrency: 3,
    models: [],
    garments: [],
    results: {},
    running: false,
    progress: '',
    jobId: '',
    jobTab: 'current',
    jobPage: 1,
    jobs: [],
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
  accountBtn: $('#account-btn'),
  settingsBtn: $('#settings-btn'),
  settingsDialog: $('#settings-dialog'),
  settingsForm: $('#settings-form'),
  settingsClear: $('#settings-clear'),
  settingsClearAccount: $('#settings-clear-account'),
  settingsSaveAccount: $('#settings-save-account'),
  settingsAccountStatus: $('#settings-account-status'),
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
  tProgress: $('#t-progress'),
  tGrid: $('#t-grid'),
  tEmpty: $('#t-empty'),
  hPrompt: $('#h-prompt'),
  hStart: $('#h-start'),
  hTools: $('#h-tools'),
  hAccount: $('#h-account'),
  hProjects: $('#h-projects'),
  hSettings: $('#h-settings'),
  hSeeAll: $('#h-see-all'),
  hRecentStatus: $('#h-recent-status'),
  hRecentList: $('#h-recent-list'),
  authBack: $('#auth-back'),
  authSettings: $('#auth-settings'),
  gModel: $('#g-model'),
  gAgent: $('#g-agent'),
  gNew: $('#g-new'),
  gShare: $('#g-share'),
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
  gAiSession: $('#g-ai-session'),
  gAiNewSession: $('#g-ai-new-session'),
  gAiClearSession: $('#g-ai-clear-session'),
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
  pShared: $('#p-shared'),
  tJobList: $('#t-job-list'),
  tJobEmpty: $('#t-job-empty'),
  tJobTabs: $$('#t-job-tabs [data-job-tab]'),
  accountSummary: $('#account-summary'),
  accountName: $('#account-name'),
  accountEmail: $('#account-email'),
  accountFormHead: $('#account-form-head'),
  accountForm: $('#account-form'),
  accountEmailInput: $('#account-email-input'),
  accountNameInput: $('#account-name-input'),
  accountPasswordInput: $('#account-password-input'),
  accountLogin: $('#account-login'),
  accountRegister: $('#account-register'),
  accountLogout: $('#account-logout'),
  accountUsage: $('#account-usage'),
  accountStatus: $('#account-status'),
  shareDialog: $('#share-dialog'),
  shareForm: $('#share-form'),
  shareHint: $('#share-hint'),
  shareEmail: $('#share-email'),
  shareRole: $('#share-role'),
  shareInvite: $('#share-invite'),
  shareStatus: $('#share-status'),
  shareMembers: $('#share-members'),
  projectDeleteDialog: $('#project-delete-dialog'),
  projectDeleteForm: $('#project-delete-form'),
  projectDeleteTitle: $('#project-delete-title'),
  projectDeleteMeta: $('#project-delete-meta'),
  projectDeleteConfirm: $('#project-delete-confirm'),
  projectDeleteStatus: $('#project-delete-status'),
  taskDeleteDialog: $('#task-delete-dialog'),
  taskDeleteForm: $('#task-delete-form'),
  taskDeleteTitle: $('#task-delete-title'),
  taskDeleteMeta: $('#task-delete-meta'),
  taskDeleteConfirm: $('#task-delete-confirm'),
  taskDeleteStatus: $('#task-delete-status'),
  oModel: $('#o-model'),
  oGarmentType: $('#o-garment-type'),
  oConcurrency: $('#o-concurrency'),
  oModelInput: $('#o-model-input'),
  oModelAdd: $('#o-model-add'),
  oModelLibraryOpen: $('#o-model-library-open'),
  oModelList: $('#o-model-list'),
  oModelCount: $('#o-model-count'),
  oModelLibraryDialog: $('#o-model-library-dialog'),
  oModelLibraryForm: $('#o-model-library-form'),
  oModelLibraryGrid: $('#o-model-library-grid'),
  oModelLibraryCount: $('#o-model-library-count'),
  oModelLibraryConfirm: $('#o-model-library-confirm'),
  oModelLibraryStatus: $('#o-model-library-status'),
  oModelLibraryAge: $$('#o-model-library-dialog [name="model-library-age"]'),
  oModelLibraryGender: $$('#o-model-library-dialog [name="model-library-gender"]'),
  oGarmentInput: $('#o-garment-input'),
  oGarmentAdd: $('#o-garment-add'),
  oGarmentList: $('#o-garment-list'),
  oGarmentCount: $('#o-garment-count'),
  oLookCount: $('#o-look-count'),
  oRun: $('#o-run'),
  oProgress: $('#o-progress'),
  oJobList: $('#o-job-list'),
  oJobEmpty: $('#o-job-empty'),
  oJobTabs: $$('#o-job-tabs [data-job-tab]'),
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
  promptDialog: $('#prompt-dialog'),
  promptForm: $('#prompt-form'),
  promptContent: $('#prompt-content'),
  promptCopy: $('#prompt-copy'),
  promptCopyStatus: $('#prompt-copy-status'),
  notice: $('#app-notice'),
  noticeText: $('#app-notice-text'),
  noticeClose: $('#app-notice-close'),
}

init()

function init() {
  const runtimeMigration = migrateLegacyRuntimeStorage()
  hydrateStoredState()
  if (runtimeMigration.migrated) {
    state.notice.message = '已清理旧版本地缓存，释放浏览器存储空间。'
    state.notice.tone = 'ok'
  }
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
  bindAccount()
  bindLightbox()
  bindPromptDialog()
  bindAppNotice()
  bindTaskDeleteDialog()
  bindHome()
  bindTranslate()
  bindProjects()
  bindShare()
  bindGenerate()
  bindOutfit()
  bindStyle()
  renderAll()
  renderAppNotice()
  void loadAccount()
  void restoreRuntimeState()
}

function viewFromLocation(fallback = 'home') {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/lovart/auth') return 'auth'
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

function currentRoutePath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function sanitizeAuthReturnPath(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  let url
  try {
    url = new URL(value, window.location.origin)
  } catch {
    return ''
  }
  if (url.origin !== window.location.origin) return ''
  const path = `${url.pathname}${url.search}${url.hash}`
  if (!path.startsWith('/') || path.startsWith('//')) return ''
  if (url.pathname.replace(/\/+$/, '') === '/lovart/auth') return ''
  return path || '/'
}

function getAuthReturnTarget() {
  const params = new URLSearchParams(window.location.search)
  const queryTarget = sanitizeAuthReturnPath(params.get('returnTo') || '')
  if (queryTarget) return queryTarget
  if (window.location.pathname.replace(/\/+$/, '') === '/lovart/auth') return '/'
  return sanitizeAuthReturnPath(sessionStorage.getItem(AUTH_RETURN_STORAGE) || '') || '/'
}

function setAuthReturnTarget(value) {
  const target = sanitizeAuthReturnPath(value)
  if (!target) return ''
  sessionStorage.setItem(AUTH_RETURN_STORAGE, target)
  return target
}

function clearAuthReturnTarget() {
  sessionStorage.removeItem(AUTH_RETURN_STORAGE)
}

function showAuthView({ returnTo = currentRoutePath(), invite = '', replace = false } = {}) {
  const target = setAuthReturnTarget(returnTo) || '/'
  const params = new URLSearchParams()
  if (invite) params.set('invite', invite)
  if (target) params.set('returnTo', target)
  const path = `/lovart/auth${params.toString() ? `?${params.toString()}` : ''}`
  window.history[replace ? 'replaceState' : 'pushState']({}, '', path)
  setActiveView('auth', { updateRoute: false })
}

function redirectToLoginForApi(error) {
  if (Number(error?.status || 0) !== 401) return
  const message = String(error?.message || error?.payload?.error || '')
  if (!/login required/i.test(message)) return
  state.account.user = null
  state.account.usage = null
  state.account.apiKeys = { keys: {}, updatedAt: '' }
  state.account.apiKeysLoadedFor = ''
  state.account.error = ''
  state.account.status = '请先登录后继续使用'
  showAuthView({ returnTo: currentRoutePath() })
  renderAccount()
}

function redirectAfterAuth() {
  const target = getAuthReturnTarget()
  clearAuthReturnTarget()
  window.location.assign(target || '/')
}

function hydrateStoredState() {
  state.keys = loadKeys()
  const runtime = sanitizeRuntimeState(loadRuntimeState())
  const storedResults = loadResultsStore()
  state.runtime.sessionId = runtime.sessionId
  state.translate.jobId = getLoadedStoredJobId(runtime.translate.jobs)
  state.translate.jobTab = runtime.translate.jobTab
  state.translate.jobPage = runtime.translate.jobPage
  state.translate.jobs = runtime.translate.jobs
  state.translate.items = runtime.translate.items
  state.generate.elements = runtime.generate.elements || []
  state.generate.aiMessages = []
  state.generate.scale = runtime.generate.scale || 1
  state.generate.panX = runtime.generate.panX || 0
  state.generate.panY = runtime.generate.panY || 0
  state.outfit.jobId = getLoadedStoredJobId(runtime.outfit.jobs)
  state.outfit.jobTab = runtime.outfit.jobTab
  state.outfit.jobPage = runtime.outfit.jobPage
  state.outfit.jobs = runtime.outfit.jobs
  state.outfit.models = runtime.outfit.models
  state.outfit.garments = runtime.outfit.garments
  state.style.sourceImage = runtime.style?.sourceImage || null
  state.style.visualStyle = runtime.style?.visualStyle || null
  state.style.styleSummary = runtime.style?.styleSummary || ''
  state.style.colorPalette = runtime.style?.colorPalette || []
  state.style.tags = runtime.style?.tags || []
  state.style.subjectRefs = runtime.style?.subjectRefs || []
  state.style.history = getStoredStyleHistory(storedResults, runtime.style?.history)
    .filter((entry) => entry.resultDataUrl)

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
    },
    style: {
      model: state.style.model,
    },
  }))
}

function saveRuntimeState(options = {}) {
  const persistCanvas = options.persistCanvas !== false
  persistCurrentAiSession()
  saveAiHistory()
  saveStyleHistory()
  writeRuntimeStorageSnapshot(createRuntimeStorageSnapshot())
  if (persistCanvas) scheduleCanvasProjectSave()
}

function createRuntimeStorageSnapshot() {
  return {
    sessionId: state.runtime.sessionId || '',
    translate: {
      jobId: state.translate.jobId || '',
      jobTab: state.translate.jobTab === 'history' ? 'history' : 'current',
      jobPage: Math.max(1, Number(state.translate.jobPage) || 1),
      jobs: state.translate.jobs.map(serializeJobTask),
      items: state.translate.items.map((item) => serializeAssetBackedItem(item)),
    },
    generate: {
      projectId: state.generate.projectId || '',
      projectTitle: state.generate.projectTitle || DEFAULT_CANVAS_PROJECT_TITLE,
      elements: state.generate.elements.map((el) => serializeCanvasElement(el)),
      aiSessionId: state.generate.aiSessionId || '',
      scale: state.generate.scale,
      panX: state.generate.panX,
      panY: state.generate.panY,
    },
    outfit: {
      jobId: state.outfit.jobId || '',
      jobTab: state.outfit.jobTab === 'history' ? 'history' : 'current',
      jobPage: Math.max(1, Number(state.outfit.jobPage) || 1),
      jobs: state.outfit.jobs.map(serializeJobTask),
      models: state.outfit.models.map((item) => serializeAssetBackedItem(item)),
      garments: state.outfit.garments.map((item) => serializeAssetBackedItem(item, {
        role: item.role || 'full_outfit',
        instructions: normalizeGarmentInstructions(item.instructions),
      })),
    },
    style: {
      sourceImage: state.style.sourceImage ? serializeAssetBackedItem(state.style.sourceImage) : null,
      visualStyle: state.style.visualStyle,
      styleSummary: state.style.styleSummary,
      colorPalette: state.style.colorPalette,
      tags: state.style.tags,
      subjectRefs: state.style.subjectRefs.map((item) => serializeAssetBackedItem(item)),
    },
  }
}

function createCompactRuntimeStorageSnapshot(snapshot = {}) {
  return {
    sessionId: typeof snapshot.sessionId === 'string' ? snapshot.sessionId : '',
    translate: {
      jobId: String(snapshot.translate?.jobId || ''),
      jobTab: snapshot.translate?.jobTab === 'history' ? 'history' : 'current',
      jobPage: Math.max(1, Number(snapshot.translate?.jobPage) || 1),
      jobs: Array.isArray(snapshot.translate?.jobs) ? snapshot.translate.jobs.slice(-RUNTIME_FALLBACK_TASK_LIMIT) : [],
      items: Array.isArray(snapshot.translate?.items) ? snapshot.translate.items.slice(-RUNTIME_FALLBACK_ITEM_LIMIT) : [],
    },
    generate: {
      projectId: String(snapshot.generate?.projectId || ''),
      projectTitle: String(snapshot.generate?.projectTitle || DEFAULT_CANVAS_PROJECT_TITLE),
      elements: Array.isArray(snapshot.generate?.elements)
        ? snapshot.generate.elements.slice(-RUNTIME_FALLBACK_ELEMENT_LIMIT).map((el) => {
            if (!el || typeof el !== 'object') return null
            if (el.type === 'image' && !el.assetId) {
              return {
                ...el,
                content: '',
              }
            }
            return el
          }).filter(Boolean)
        : [],
      aiSessionId: String(snapshot.generate?.aiSessionId || ''),
      scale: Number(snapshot.generate?.scale) || 1,
      panX: Number(snapshot.generate?.panX) || 0,
      panY: Number(snapshot.generate?.panY) || 0,
    },
    outfit: {
      jobId: String(snapshot.outfit?.jobId || ''),
      jobTab: snapshot.outfit?.jobTab === 'history' ? 'history' : 'current',
      jobPage: Math.max(1, Number(snapshot.outfit?.jobPage) || 1),
      jobs: Array.isArray(snapshot.outfit?.jobs) ? snapshot.outfit.jobs.slice(-RUNTIME_FALLBACK_TASK_LIMIT) : [],
      models: Array.isArray(snapshot.outfit?.models) ? snapshot.outfit.models.slice(-RUNTIME_FALLBACK_ITEM_LIMIT) : [],
      garments: Array.isArray(snapshot.outfit?.garments) ? snapshot.outfit.garments.slice(-RUNTIME_FALLBACK_ITEM_LIMIT) : [],
    },
    style: {
      sourceImage: snapshot.style?.sourceImage || null,
      visualStyle: snapshot.style?.visualStyle || null,
      styleSummary: String(snapshot.style?.styleSummary || ''),
      colorPalette: Array.isArray(snapshot.style?.colorPalette) ? snapshot.style.colorPalette : [],
      tags: Array.isArray(snapshot.style?.tags) ? snapshot.style.tags : [],
      subjectRefs: Array.isArray(snapshot.style?.subjectRefs)
        ? snapshot.style.subjectRefs.slice(-RUNTIME_FALLBACK_SUBJECT_REF_LIMIT)
        : [],
    },
  }
}

function writeRuntimeStorageSnapshot(snapshot) {
  for (const candidate of [snapshot, createCompactRuntimeStorageSnapshot(snapshot)]) {
    try {
      localStorage.setItem(RUNTIME_STORAGE, JSON.stringify(candidate))
      return true
    } catch {
      // Keep the UI responsive even if local storage is full.
    }
  }
  return false
}

function loadRuntimeState() {
  return readJson(RUNTIME_STORAGE, {})
}

function createRuntimeMigrationInfo(overrides = {}) {
  return {
    migrated: Boolean(overrides.migrated),
    compacted: Boolean(overrides.compacted),
    aiHistory: Boolean(overrides.aiHistory),
    styleHistory: Boolean(overrides.styleHistory),
  }
}

function isLegacyRuntimeStorageHeavy(raw = {}) {
  return Boolean(
    raw.generate?.aiMessages
      || raw.generate?.aiSessions
      || raw.style?.history
      || (Array.isArray(raw.generate?.elements)
        && raw.generate.elements.some((el) => el?.type === 'image' && !el.assetId && el.content)),
  )
}

function persistLegacyAiHistory(raw = {}) {
  const sessions = sanitizeAiSessions(raw.generate?.aiSessions)
  const messages = sanitizeAiMessages(raw.generate?.aiMessages)
  if (!sessions.length && !messages.length) return false

  const activeSessionId = typeof raw.generate?.aiSessionId === 'string' ? raw.generate.aiSessionId : ''
  const payloadSessions = sessions.length
    ? sessions
    : [createAiSessionRecord({
        id: activeSessionId,
        title: DEFAULT_AI_SESSION_TITLE,
        messages,
      })]
  const payload = {
    activeSessionId: activeSessionId || payloadSessions[0]?.id || '',
    sessions: serializeStoredAiSessions(payloadSessions),
  }
  if (!payload.sessions.length) return false

  try {
    localStorage.setItem(canvasAiHistoryStorageKey(raw.generate?.projectId), JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

function persistLegacyStyleHistory(raw = {}) {
  const history = sanitizeStyleHistoryEntries(raw.style?.history)
  if (!history.length) return false
  const store = loadResultsStore()
  if (!store.style) store.style = { history: [] }
  const existing = sanitizeStyleHistoryEntries(store.style.history)
  const seen = new Set(existing.map((entry) => entry.id))
  store.style.history = serializeStyleHistoryEntries([
    ...existing,
    ...history.filter((entry) => !seen.has(entry.id)),
  ])
  saveResultsStore(store)
  return true
}

function migrateLegacyRuntimeStorage() {
  const raw = loadRuntimeState()
  if (!isLegacyRuntimeStorageHeavy(raw)) return createRuntimeMigrationInfo()

  const aiHistory = persistLegacyAiHistory(raw)
  const styleHistory = persistLegacyStyleHistory(raw)
  const sanitized = sanitizeRuntimeState(raw)
  const compacted = writeRuntimeStorageSnapshot(createCompactRuntimeStorageSnapshot(sanitized))
  return createRuntimeMigrationInfo({
    migrated: compacted || aiHistory || styleHistory,
    compacted,
    aiHistory,
    styleHistory,
  })
}

function canvasAiHistoryStorageKey(projectId = state.generate.projectId) {
  const id = String(projectId || '').trim()
  return id ? `${CANVAS_AI_HISTORY_PROJECT_PREFIX}${id}` : CANVAS_AI_HISTORY_STORAGE
}

function loadAiHistory(projectId = state.generate.projectId, options = {}) {
  const id = String(projectId || '').trim()
  const allowLegacy = options.allowLegacy !== false
  const scoped = resolveStoredAiHistoryPayload(readJson(canvasAiHistoryStorageKey(id), null))
  if (scoped.length || id || !allowLegacy) return scoped
  return resolveStoredAiHistoryPayload(readJson(CANVAS_AI_HISTORY_STORAGE, null))
}

function saveAiHistory() {
  return saveAiSessions()
}

function resolveStoredAiHistoryPayload(raw) {
  if (Array.isArray(raw)) return sanitizeAiMessages(raw)
  const sessions = sanitizeAiSessions(raw?.sessions)
  if (!sessions.length) return []
  const activeSessionId = typeof raw?.activeSessionId === 'string' ? raw.activeSessionId : ''
  const session = sessions.find((item) => item.id === activeSessionId) || sessions[sessions.length - 1] || sessions[0]
  return sanitizeAiMessages(session?.messages)
}

function serializeStoredAiSessions(value) {
  return sanitizeAiSessions(value)
    .slice(-AI_STORED_SESSION_LIMIT)
    .map((session) => ({
      ...session,
      messages: Array.isArray(session.messages)
        ? session.messages.slice(-AI_STORED_MESSAGE_LIMIT).map((msg) => serializeAiMessage(msg)).filter(Boolean)
        : [],
    }))
}

function saveAiSessions() {
  persistCurrentAiSession()
  const sessions = serializeStoredAiSessions(state.generate.aiSessions)
  if (!sessions.length) return false
  const activeSessionId = state.generate.aiSessionId || sessions[sessions.length - 1]?.id || ''
  const activeSession = sessions.find((item) => item.id === activeSessionId) || sessions[sessions.length - 1] || null
  const payloads = [
    {
      activeSessionId,
      sessions,
    },
    activeSession
      ? {
          activeSessionId: activeSession.id,
          sessions: [activeSession],
        }
      : null,
  ].filter(Boolean)

  for (const payload of payloads) {
    try {
      localStorage.setItem(canvasAiHistoryStorageKey(), JSON.stringify(payload))
      return true
    } catch {
      // Fall back to the active session only when storage is tight.
    }
  }
  return false
}

function getSerializedAiHistory() {
  return serializeAiMessages(state.generate.aiMessages)
}

function serializeAiMessages(messages) {
  return Array.isArray(messages)
    ? messages.slice(-AI_HISTORY_LIMIT).map((msg) => serializeAiMessage(msg)).filter(Boolean)
    : []
}

function getProjectAiHistory(project) {
  const metadata = project?.metadataJson && typeof project.metadataJson === 'object' ? project.metadataJson : {}
  return sanitizeAiMessages(metadata.aiMessages)
}

function getProjectAiSessions(project) {
  const metadata = project?.metadataJson && typeof project.metadataJson === 'object' ? project.metadataJson : {}
  const sessions = sanitizeAiSessions(metadata.aiSessions)
  const legacyMessages = sanitizeAiMessages(metadata.aiMessages)
  if (sessions.length) return sessions
  return legacyMessages.length || Array.isArray(metadata.aiMessages)
    ? [createAiSessionRecord({
        id: typeof metadata.aiSessionId === 'string' ? metadata.aiSessionId : '',
        title: DEFAULT_AI_SESSION_TITLE,
        messages: legacyMessages,
      })]
    : []
}

function getProjectMetadata(project) {
  return project?.metadataJson && typeof project.metadataJson === 'object' ? project.metadataJson : {}
}

function hasProjectAiHistory(project) {
  return Array.isArray(getProjectMetadata(project).aiMessages)
}

function resolveCanvasAiHistory(project, projectId = state.generate.projectId, runtimeMessages = []) {
  const sessions = getProjectAiSessions(project)
  if (sessions.length) {
    const metadata = getProjectMetadata(project)
    const targetId = typeof metadata.aiSessionId === 'string' ? metadata.aiSessionId : ''
    const session = sessions.find((item) => item.id === targetId) || sessions[0]
    return session.messages
  }
  if (hasProjectAiHistory(project)) return getProjectAiHistory(project)
  const id = String(projectId || '').trim()
  if (id) return loadAiHistory(id, { allowLegacy: false })
  return runtimeMessages?.length ? runtimeMessages : loadAiHistory('', { allowLegacy: true })
}

function resolveCanvasAiSessions(project, projectId = state.generate.projectId, runtimeSessions = [], runtimeMessages = []) {
  const projectSessions = getProjectAiSessions(project)
  if (projectSessions.length) return projectSessions
  const storedSessions = loadAiSessions(projectId, { allowLegacy: false })
  if (storedSessions.length) return storedSessions
  const sanitizedRuntimeSessions = sanitizeAiSessions(runtimeSessions)
  if (sanitizedRuntimeSessions.length) return sanitizedRuntimeSessions
  const legacyMessages = resolveCanvasAiHistory(project, projectId, runtimeMessages)
  return legacyMessages.length ? [createAiSessionRecord({ title: DEFAULT_AI_SESSION_TITLE, messages: legacyMessages })] : []
}

function loadAiSessions(projectId = state.generate.projectId, options = {}) {
  const id = String(projectId || '').trim()
  const raw = readJson(canvasAiHistoryStorageKey(id), null)
  const sessions = Array.isArray(raw)
    ? []
    : sanitizeAiSessions(raw?.sessions)
  if (sessions.length || id || options.allowLegacy === false) return sessions
  const legacy = readJson(CANVAS_AI_HISTORY_STORAGE, null)
  return Array.isArray(legacy)
    ? []
    : sanitizeAiSessions(legacy?.sessions)
}

function createAiSessionRecord({ id = '', title = '', messages = [], createdAt = '', updatedAt = '' } = {}) {
  const now = new Date().toISOString()
  return {
    id: id || crypto.randomUUID(),
    title: String(title || '').trim() || DEFAULT_AI_SESSION_TITLE,
    messages: sanitizeAiMessages(messages),
    createdAt: createdAt || now,
    updatedAt: updatedAt || now,
  }
}

function sanitizeAiSessions(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((session) => {
      const id = typeof session?.id === 'string' && session.id ? session.id : crypto.randomUUID()
      const messages = sanitizeAiMessages(session?.messages)
      return {
        id,
        title: typeof session?.title === 'string' && session.title.trim() ? session.title.trim().slice(0, 48) : inferAiSessionTitle(messages),
        messages,
        createdAt: typeof session?.createdAt === 'string' ? session.createdAt : new Date().toISOString(),
        updatedAt: typeof session?.updatedAt === 'string' ? session.updatedAt : new Date().toISOString(),
      }
    })
    .filter(Boolean)
    .slice(-20)
}

function serializeAiSessions(value) {
  return sanitizeAiSessions(value).map((session) => ({
    ...session,
    messages: serializeAiMessages(session.messages),
  }))
}

function inferAiSessionTitle(messages) {
  const firstUser = messages.find((msg) => msg.role === 'user' && msg.content)
  return firstUser?.content ? firstUser.content.slice(0, 24) : DEFAULT_AI_SESSION_TITLE
}

function persistCurrentAiSession() {
  if (!state.generate.aiSessionId) {
    if (!state.generate.aiMessages.length) return
    const created = createAiSessionRecord({ messages: state.generate.aiMessages })
    state.generate.aiSessions.push(created)
    state.generate.aiSessionId = created.id
  }
  let session = state.generate.aiSessions.find((item) => item.id === state.generate.aiSessionId)
  if (!session) {
    session = createAiSessionRecord({ id: state.generate.aiSessionId, messages: [] })
    state.generate.aiSessions.push(session)
  }
  session.messages = sanitizeAiMessages(state.generate.aiMessages)
  session.title = inferAiSessionTitle(session.messages)
  session.updatedAt = new Date().toISOString()
}

function activateAiSession(sessionId) {
  persistCurrentAiSession()
  const session = state.generate.aiSessions.find((item) => item.id === sessionId)
  if (!session) return
  state.generate.aiSessionId = session.id
  state.generate.aiMessages = sanitizeAiMessages(session.messages)
  state.generate.aiRefs = []
}

function ensureAiSessionSelection() {
  if (!state.generate.aiSessions.length) {
    const session = createAiSessionRecord({ messages: state.generate.aiMessages })
    state.generate.aiSessions = [session]
    state.generate.aiSessionId = session.id
    return session
  }
  const session = state.generate.aiSessions.find((item) => item.id === state.generate.aiSessionId) || state.generate.aiSessions[0]
  state.generate.aiSessionId = session.id
  return session
}

function ensureCurrentAiSession() {
  const session = ensureAiSessionSelection()
  state.generate.aiMessages = sanitizeAiMessages(session.messages)
  return session
}

function startNewAiSession() {
  if (state.generate.aiRunning) return
  persistCurrentAiSession()
  const session = createAiSessionRecord({ title: DEFAULT_AI_SESSION_TITLE, messages: [] })
  state.generate.aiSessions.push(session)
  state.generate.aiSessions = state.generate.aiSessions.slice(-20)
  state.generate.aiSessionId = session.id
  state.generate.aiMessages = []
  state.generate.aiRefs = []
  saveRuntimeState()
  renderAiMessages()
  renderAiRefList()
  renderAiSessionControls()
}

function clearCurrentAiSession() {
  if (state.generate.aiRunning) return
  ensureCurrentAiSession()
  const session = state.generate.aiSessions.find((item) => item.id === state.generate.aiSessionId)
  state.generate.aiMessages = []
  state.generate.aiRefs = []
  if (session) {
    session.messages = []
    session.title = DEFAULT_AI_SESSION_TITLE
    session.updatedAt = new Date().toISOString()
  }
  saveRuntimeState()
  renderAiMessages()
  renderAiRefList()
  renderAiSessionControls()
}

function sanitizeRuntimeState(raw = {}) {
  const translateJobs = sanitizeStoredJobTasks(raw.translate?.jobs, raw.translate?.jobId, 'translate_batch')
  const outfitJobs = sanitizeStoredJobTasks(raw.outfit?.jobs, raw.outfit?.jobId, 'outfit_batch')
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
      .map((item) => ({
        ...item,
        role: item.role || 'full_outfit',
        instructions: normalizeGarmentInstructions(item.instructions),
      }))
    : []

  return {
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : '',
    translate: {
      jobId: typeof raw.translate?.jobId === 'string' ? raw.translate.jobId : '',
      jobTab: raw.translate?.jobTab === 'history' ? 'history' : 'current',
      jobPage: Math.max(1, Number(raw.translate?.jobPage) || 1),
      jobs: translateJobs,
      items: translateItems,
    },
    generate: {
      projectId: typeof raw.generate?.projectId === 'string' ? raw.generate.projectId : '',
      projectTitle: typeof raw.generate?.projectTitle === 'string' && raw.generate.projectTitle.trim()
        ? raw.generate.projectTitle.trim()
        : DEFAULT_CANVAS_PROJECT_TITLE,
      elements: generateElements,
      aiSessionId: typeof raw.generate?.aiSessionId === 'string' ? raw.generate.aiSessionId : '',
      aiSessions: sanitizeAiSessions(raw.generate?.aiSessions),
      aiMessages: sanitizeAiMessages(raw.generate?.aiMessages),
      scale: Number(raw.generate?.scale) || 1,
      panX: Number(raw.generate?.panX) || 0,
      panY: Number(raw.generate?.panY) || 0,
    },
    outfit: {
      jobId: typeof raw.outfit?.jobId === 'string' ? raw.outfit.jobId : '',
      jobTab: raw.outfit?.jobTab === 'history' ? 'history' : 'current',
      jobPage: Math.max(1, Number(raw.outfit?.jobPage) || 1),
      jobs: outfitJobs,
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
      history: sanitizeStyleHistoryEntries(raw.style?.history),
    },
  }
}

function sanitizeStoredJobTasks(rawJobs, legacyJobId = '', fallbackType = '') {
  const jobs = Array.isArray(rawJobs) ? rawJobs : []
  const mapped = jobs
    .map((entry) => {
      const task = serializeJobTask(entry)
      const status = KNOWN_JOB_STATUSES.has(task.status) ? task.status : ''
      const type = String(task.type || '').trim()
      if (!type || type !== fallbackType) return null
      return task.jobId ? {
        ...task,
        status,
        type,
        loaded: task.loaded && !ACTIVE_JOB_STATUSES.has(status) && status !== '',
      } : null
    })
    .filter(Boolean)

  if (mapped.length === 0 && typeof legacyJobId === 'string' && legacyJobId && !mapped.some((task) => task.jobId === legacyJobId)) {
    mapped.unshift({
      jobId: legacyJobId,
      type: fallbackType,
      status: '',
      progress: '',
      label: '',
      createdAt: '',
      updatedAt: '',
      loaded: false,
      error: '',
      itemCount: 0,
      progressTotal: 0,
      progressDone: 0,
      progressFailed: 0,
    })
  }

  return mapped.slice(0, 12)
}

function getLoadedStoredJobId(tasks = []) {
  return tasks.find((task) => task.loaded && !ACTIVE_JOB_STATUSES.has(task.status) && task.status !== '')?.jobId || ''
}

function getJobTasks(kind) {
  return kind === 'translate' ? state.translate.jobs : state.outfit.jobs
}

function getLoadedJobId(kind) {
  return kind === 'translate' ? state.translate.jobId : state.outfit.jobId
}

function getJobTab(kind) {
  return kind === 'translate' ? state.translate.jobTab : state.outfit.jobTab
}

function getJobPage(kind) {
  return kind === 'translate' ? state.translate.jobPage : state.outfit.jobPage
}

function setJobTab(kind, tab) {
  const next = tab === 'history' ? 'history' : 'current'
  if (kind === 'translate') {
    state.translate.jobTab = next
    state.translate.jobPage = 1
  } else {
    state.outfit.jobTab = next
    state.outfit.jobPage = 1
  }
}

function setJobPage(kind, page) {
  const tasks = getJobTasks(kind)
  const tab = getJobTab(kind)
  const next = clampJobTaskPage(tasks, tab, page)
  if (kind === 'translate') {
    state.translate.jobPage = next
  } else {
    state.outfit.jobPage = next
  }
  return next
}

function setLoadedJobId(kind, jobId) {
  if (kind === 'translate') {
    state.translate.jobId = jobId || ''
  } else {
    state.outfit.jobId = jobId || ''
  }
}

function makeJobTask(jobId, type, extra = {}) {
  return {
    jobId,
    type,
    status: '',
    progress: '',
    label: '',
    createdAt: '',
    updatedAt: '',
    loaded: false,
    error: '',
    itemCount: 0,
    progressTotal: 0,
    progressDone: 0,
    progressFailed: 0,
    thumbs: [],
    ...extra,
  }
}

function upsertJobTask(kind, jobId, patch = {}) {
  if (!jobId) return null
  const tasks = getJobTasks(kind)
  const type = kind === 'translate' ? 'translate_batch' : 'outfit_batch'
  let task = tasks.find((entry) => entry.jobId === jobId)
  if (task) {
    Object.assign(task, patch)
  } else {
    task = makeJobTask(jobId, type, patch)
    tasks.unshift(task)
  }
  if (patch.job) updateJobTaskFromJob(task, patch.job, patch.items)
  tasks.splice(12)
  setJobPage(kind, getJobPage(kind))
  return task
}

function removeJobTask(kind, jobId) {
  if (kind === 'translate') {
    state.translate.jobs = state.translate.jobs.filter((task) => task.jobId !== jobId)
    if (state.translate.jobId === jobId) state.translate.jobId = ''
    translateJobWatchers.delete(jobId)
    state.translate.jobPage = clampJobTaskPage(state.translate.jobs, state.translate.jobTab, state.translate.jobPage)
  } else {
    state.outfit.jobs = state.outfit.jobs.filter((task) => task.jobId !== jobId)
    if (state.outfit.jobId === jobId) state.outfit.jobId = ''
    outfitJobWatchers.delete(jobId)
    state.outfit.jobPage = clampJobTaskPage(state.outfit.jobs, state.outfit.jobTab, state.outfit.jobPage)
  }
}

function getJobTaskBucket(task = {}) {
  return CURRENT_TASK_JOB_STATUSES.has(task.status) || !task.status ? 'current' : 'history'
}

function filterJobTasksForTab(tasks = [], tab = 'current') {
  const bucket = tab === 'history' ? 'history' : 'current'
  return tasks.filter((task) => getJobTaskBucket(task) === bucket)
}

function getTaskSortTime(task = {}) {
  const created = Date.parse(String(task.createdAt || ''))
  if (Number.isFinite(created)) return created
  const updated = Date.parse(String(task.updatedAt || ''))
  if (Number.isFinite(updated)) return updated
  return 0
}

function getSortedJobTasksForTab(tasks = [], tab = 'current') {
  return filterJobTasksForTab(tasks, tab)
    .slice()
    .sort((a, b) => {
      const diff = getTaskSortTime(b) - getTaskSortTime(a)
      return diff || String(b.jobId || '').localeCompare(String(a.jobId || ''))
    })
}

function getJobTaskPageCount(tasks = [], tab = 'current') {
  if (tab !== 'history') return 1
  return Math.max(1, Math.ceil(getSortedJobTasksForTab(tasks, tab).length / JOB_TASKS_PER_PAGE))
}

function clampJobTaskPage(tasks = [], tab = 'current', page = 1) {
  const value = Math.floor(Number(page) || 1)
  return clamp(value, 1, getJobTaskPageCount(tasks, tab))
}

function getPagedJobTasksForTab(tasks = [], tab = 'current', page = 1) {
  const sorted = getSortedJobTasksForTab(tasks, tab)
  if (tab !== 'history') return sorted
  const currentPage = clampJobTaskPage(tasks, tab, page)
  const start = (currentPage - 1) * JOB_TASKS_PER_PAGE
  return sorted.slice(start, start + JOB_TASKS_PER_PAGE)
}

function shouldShowLoadedJobWorkspace(kind) {
  const jobId = getLoadedJobId(kind)
  if (!jobId) return getJobTab(kind) === 'current'
  const task = getJobTasks(kind).find((entry) => entry.jobId === jobId)
  if (!task) return false
  return getJobTaskBucket(task) === getJobTab(kind)
}

function isCurrentTaskTabEmpty(kind) {
  return getJobTab(kind) === 'current' && filterJobTasksForTab(getJobTasks(kind), 'current').length === 0
}

function resetLoadedWorkspaceForDraft(kind) {
  if (!getLoadedJobId(kind)) return
  clearJobTaskLoaded(kind)
  if (kind === 'translate') {
    translateWorkspaceLoadToken += 1
    state.translate.items = []
    state.translate.progress = ''
  } else {
    outfitWorkspaceLoadToken += 1
    state.outfit.models = []
    state.outfit.garments = []
    state.outfit.results = {}
    state.outfit.progress = ''
  }
}

function addJobTaskThumb(thumbs, seen, assetId, label) {
  const id = String(assetId || '').trim()
  if (!id || seen.has(id) || thumbs.length >= 3) return
  seen.add(id)
  thumbs.push({
    src: assetResultUrl(id),
    label,
  })
}

function getJobTaskThumbsFromItems(kind, items = []) {
  const thumbs = []
  const seen = new Set()
  if (kind === 'translate') {
    for (const item of Array.isArray(items) ? items : []) {
      addJobTaskThumb(thumbs, seen, item?.inputJson?.assetId, `源图 ${thumbs.length + 1}`)
    }
    return thumbs
  }

  let modelCount = 0
  let garmentCount = 0
  for (const item of Array.isArray(items) ? items : []) {
    const beforeModel = thumbs.length
    addJobTaskThumb(thumbs, seen, item?.inputJson?.modelAssetId, `模特 ${modelCount + 1}`)
    if (thumbs.length > beforeModel) modelCount += 1
    const lookAssetIds = Array.isArray(item?.inputJson?.lookAssetIds) ? item.inputJson.lookAssetIds : []
    for (const assetId of lookAssetIds) {
      const beforeGarment = thumbs.length
      addJobTaskThumb(thumbs, seen, assetId, `服装 ${garmentCount + 1}`)
      if (thumbs.length > beforeGarment) garmentCount += 1
    }
  }
  return thumbs
}

function addJobTaskThumbFromItem(thumbs, seen, item, label) {
  if (!item) return
  const src = String(item.dataUrl || '').trim() || assetResultUrl(item.assetId || item.id)
  const key = String(item.assetId || item.id || src).trim()
  if (!src || !key || seen.has(key) || thumbs.length >= 3) return
  seen.add(key)
  thumbs.push({ src, label })
}

function getJobTaskThumbsFromWorkspace(kind) {
  const thumbs = []
  const seen = new Set()
  if (kind === 'translate') {
    for (const item of state.translate.items) {
      addJobTaskThumbFromItem(thumbs, seen, item, `源图 ${thumbs.length + 1}`)
    }
    return thumbs
  }

  let modelCount = 0
  for (const item of state.outfit.models) {
    const before = thumbs.length
    addJobTaskThumbFromItem(thumbs, seen, item, `模特 ${modelCount + 1}`)
    if (thumbs.length > before) modelCount += 1
  }
  let garmentCount = 0
  for (const item of state.outfit.garments) {
    const before = thumbs.length
    addJobTaskThumbFromItem(thumbs, seen, item, `服装 ${garmentCount + 1}`)
    if (thumbs.length > before) garmentCount += 1
  }
  return thumbs
}

function updateJobTaskFromJob(task, job, items = null) {
  if (!task || !job) return task
  task.jobId = job.id || task.jobId
  task.type = job.type || task.type
  task.status = job.status || task.status
  task.progress = formatBatchProgress(job)
  task.createdAt = job.createdAt || task.createdAt
  task.updatedAt = job.updatedAt || task.updatedAt
  task.progressTotal = Number(job.progressTotal || 0)
  task.progressDone = Number(job.progressDone || 0)
  task.progressFailed = Number(job.progressFailed || 0)
  task.itemCount = Array.isArray(items) ? items.length : Number(task.itemCount || job.progressTotal || 0)
  if (Array.isArray(items)) {
    const kind = job.type === 'translate_batch' ? 'translate' : 'outfit'
    const thumbs = getJobTaskThumbsFromItems(kind, items)
    task.thumbs = thumbs.length ? thumbs : getJobTaskThumbsFromWorkspace(kind)
  }
  task.error = ''
  if (!task.label) task.label = createJobTaskLabel(job, items)
  return task
}

function createJobTaskLabel(job, items = null) {
  const total = Number(job?.progressTotal || 0)
  const created = job?.createdAt ? formatRelativeTime(job.createdAt) : '刚刚'
  if (job?.type === 'outfit_batch') {
    const lookCount = Number(job?.summaryJson?.lookCount || 0)
    return `${created} · ${lookCount || total || '多'} 套搭配`
  }
  if (job?.type === 'translate_batch') {
    const languages = Array.isArray(job?.configJson?.targetLanguages) ? job.configJson.targetLanguages.length : 0
    const assets = Array.isArray(job?.configJson?.assetIds) ? job.configJson.assetIds.length : 0
    return `${created} · ${assets || '多'} 张 × ${languages || '多'} 语种`
  }
  return `${created} · ${Array.isArray(items) ? items.length : total} 项`
}

function markJobTaskLoaded(kind, jobId) {
  for (const task of getJobTasks(kind)) {
    task.loaded = task.jobId === jobId
  }
  setLoadedJobId(kind, jobId)
}

function clearJobTaskLoaded(kind) {
  for (const task of getJobTasks(kind)) {
    task.loaded = false
  }
  setLoadedJobId(kind, '')
}

async function loadJobIntoWorkspace(kind, jobId) {
  const loadToken = kind === 'translate' ? ++translateWorkspaceLoadToken : ++outfitWorkspaceLoadToken
  const task = upsertJobTask(kind, jobId, { syncing: true, error: '' })
  markJobTaskLoaded(kind, jobId)
  if (kind === 'translate') {
    state.translate.progress = '正在切换任务结果…'
    renderTranslate()
  } else {
    state.outfit.progress = '正在切换任务结果…'
    renderOutfit()
  }
  renderJobList(kind)
  try {
    const { job, items } = await fetchJobSnapshot(jobId)
    if ((kind === 'translate' ? translateWorkspaceLoadToken : outfitWorkspaceLoadToken) !== loadToken) {
      return
    }
    updateJobTaskFromJob(task, job, items)
    if (kind === 'translate') {
      await hydrateTranslateWorkspaceFromJob(job, items)
      if (translateWorkspaceLoadToken !== loadToken) return
      applyTranslateJobSnapshot(job, items)
      renderTranslateDropdowns()
    } else {
      await hydrateOutfitWorkspaceFromJob(job, items)
      if (outfitWorkspaceLoadToken !== loadToken) return
      applyOutfitJobSnapshot(job, items)
    }
    saveRuntimeState()
    if (kind === 'translate') {
      void syncTranslateJob(jobId, { applyToWorkspace: true })
    } else {
      void syncOutfitJob(jobId, { applyToWorkspace: true })
    }
  } catch (error) {
    if ((kind === 'translate' ? translateWorkspaceLoadToken : outfitWorkspaceLoadToken) !== loadToken) {
      return
    }
    const status = Number(error?.status || 0)
    if (status === 404 || status === 403) {
      removeJobTask(kind, jobId)
      clearJobTaskLoaded(kind)
      if (kind === 'translate') {
        state.translate.progress = status === 403 ? '任务无权限访问，已从列表移除' : '任务记录已失效，已从列表移除'
      } else {
        state.outfit.progress = status === 403 ? '任务无权限访问，已从列表移除' : '任务记录已失效，已从列表移除'
      }
      saveRuntimeState()
      if (kind === 'translate') renderTranslate()
      else renderOutfit()
      return
    }
    task.error = trimError(error)
    clearJobTaskLoaded(kind)
    saveRuntimeState()
    if (kind === 'translate') renderTranslate()
    else renderOutfit()
  } finally {
    if (task) task.syncing = false
    renderJobList(kind)
  }
}

async function pauseJobTask(kind, jobId) {
  const task = upsertJobTask(kind, jobId, { actioning: true, error: '' })
  renderJobList(kind)
  try {
    await postJson(`/api/jobs/${encodeURIComponent(jobId)}/pause`, {})
    if (kind === 'translate') {
      await syncTranslateJob(jobId, { applyToWorkspace: getLoadedJobId(kind) === jobId })
    } else {
      await syncOutfitJob(jobId, { applyToWorkspace: getLoadedJobId(kind) === jobId })
    }
  } catch (error) {
    task.error = trimError(error)
    saveRuntimeState()
  } finally {
    task.actioning = false
    renderJobList(kind)
  }
}

async function resumeJobTask(kind, jobId) {
  const task = upsertJobTask(kind, jobId, { actioning: true, error: '' })
  renderJobList(kind)
  try {
    await postJson(`/api/jobs/${encodeURIComponent(jobId)}/resume`, {})
    if (kind === 'translate') {
      await syncTranslateJob(jobId, { applyToWorkspace: getLoadedJobId(kind) === jobId })
    } else {
      await syncOutfitJob(jobId, { applyToWorkspace: getLoadedJobId(kind) === jobId })
    }
  } catch (error) {
    task.error = trimError(error)
    saveRuntimeState()
  } finally {
    task.actioning = false
    renderJobList(kind)
  }
}

async function retryJobTask(kind, jobId) {
  const task = upsertJobTask(kind, jobId, { actioning: true, error: '' })
  renderJobList(kind)
  try {
    await postJson(`/api/jobs/${encodeURIComponent(jobId)}/retry`, {})
    setJobTab(kind, 'current')
    if (kind === 'translate') {
      await syncTranslateJob(jobId, { applyToWorkspace: getLoadedJobId(kind) === jobId })
    } else {
      await syncOutfitJob(jobId, { applyToWorkspace: getLoadedJobId(kind) === jobId })
    }
  } catch (error) {
    task.error = trimError(error)
    saveRuntimeState()
  } finally {
    task.actioning = false
    renderJobList(kind)
  }
}

async function cancelJobTask(kind, jobId) {
  const task = upsertJobTask(kind, jobId, { actioning: true, error: '' })
  renderJobList(kind)
  try {
    await postJson(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {})
    if (kind === 'translate') {
      await syncTranslateJob(jobId, { applyToWorkspace: getLoadedJobId(kind) === jobId })
    } else {
      await syncOutfitJob(jobId, { applyToWorkspace: getLoadedJobId(kind) === jobId })
    }
    setJobTab(kind, 'history')
    saveRuntimeState()
    renderJobList(kind)
  } catch (error) {
    task.error = trimError(error)
    saveRuntimeState()
  } finally {
    task.actioning = false
    renderJobList(kind)
  }
}

async function deleteJobTask(kind, jobId) {
  const task = upsertJobTask(kind, jobId, { actioning: true, error: '' })
  renderJobList(kind)
  try {
    await deleteJson(`/api/jobs/${encodeURIComponent(jobId)}`)
    removeJobTask(kind, jobId)
    saveRuntimeState()
    if (kind === 'translate') {
      state.translate.running = false
      renderTranslate()
    } else {
      state.outfit.running = false
      renderOutfit()
    }
    return true
  } catch (error) {
    task.error = trimError(error)
    task.actioning = false
    saveRuntimeState()
    renderJobList(kind)
    return false
  }
}

function getTaskDeleteTarget() {
  const kind = state.taskDelete.kind === 'outfit' ? 'outfit' : 'translate'
  const task = state.taskDelete.jobId
    ? getJobTasks(kind).find((entry) => entry.jobId === state.taskDelete.jobId)
    : null
  return { kind, task }
}

function openTaskDeleteDialog(kind, jobId) {
  const task = getJobTasks(kind).find((entry) => entry.jobId === jobId)
  if (!task || !dom.taskDeleteDialog) return
  state.taskDelete.kind = kind
  state.taskDelete.jobId = jobId
  state.taskDelete.status = ''
  renderTaskDeleteDialog()
  if (!dom.taskDeleteDialog.open) dom.taskDeleteDialog.showModal()
}

function renderTaskDeleteDialog() {
  if (!dom.taskDeleteDialog) return
  const { kind, task } = getTaskDeleteTarget()
  dom.taskDeleteTitle.textContent = task?.label || (kind === 'translate' ? '批量翻译任务' : '批量换装任务')
  dom.taskDeleteMeta.textContent = task
    ? `${getJobStatusLabel(task.status)} · ${task.createdAt ? formatTimestamp(task.createdAt) : task.jobId}`
    : ''
  dom.taskDeleteConfirm.disabled = state.taskDelete.deleting || !task
  dom.taskDeleteStatus.textContent = state.taskDelete.status || ''
  dom.taskDeleteStatus.classList.toggle('err', Boolean(state.taskDelete.status && !state.taskDelete.deleting))
  dom.taskDeleteStatus.classList.toggle('run', state.taskDelete.deleting)
}

async function deleteTaskFromDialog() {
  const { kind, task } = getTaskDeleteTarget()
  if (!task || state.taskDelete.deleting) return
  state.taskDelete.deleting = true
  state.taskDelete.status = '正在删除任务…'
  renderTaskDeleteDialog()
  try {
    const deleted = await deleteJobTask(kind, task.jobId)
    if (!deleted) {
      state.taskDelete.status = '删除失败，请稍后重试'
      renderTaskDeleteDialog()
      return
    }
    dom.taskDeleteDialog?.close()
    state.taskDelete.kind = ''
    state.taskDelete.jobId = ''
    state.taskDelete.status = ''
  } catch (error) {
    state.taskDelete.status = trimError(error)
    renderTaskDeleteDialog()
  } finally {
    state.taskDelete.deleting = false
    renderTaskDeleteDialog()
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

function serializeAiMessage(msg = {}) {
  const role = msg.role === 'user' || msg.role === 'assistant' ? msg.role : ''
  if (!role) return null
  return {
    id: msg.id || crypto.randomUUID(),
    role,
    content: typeof msg.content === 'string' && msg.content
      ? msg.content
      : (msg.loading ? `${msg.loadingText || 'AI 正在处理'}…` : ''),
    steps: Array.isArray(msg.steps) ? msg.steps.map(String).filter(Boolean).slice(0, 8) : [],
    refs: Array.isArray(msg.refs) ? msg.refs.map(serializeAiMessageRef).filter(Boolean).slice(0, 12) : [],
    imageAssetId: typeof msg.imageAssetId === 'string' ? msg.imageAssetId : '',
    imageName: typeof msg.imageName === 'string' ? msg.imageName : '',
    imageMime: typeof msg.imageMime === 'string' ? msg.imageMime : '',
    imageDataUrl: shouldInlineHistoryDataUrl(msg.imageDataUrl) ? msg.imageDataUrl : '',
    aspectRatio: normalizeAspectRatio(msg.aspectRatio || ''),
  }
}

function serializeAiMessageRef(ref = {}) {
  const assetId = typeof ref.assetId === 'string' ? ref.assetId : ''
  const dataUrl = shouldInlineHistoryDataUrl(ref.dataUrl) ? ref.dataUrl : ''
  if (!assetId && !dataUrl) return null
  return {
    assetId,
    dataUrl,
    name: typeof ref.name === 'string' ? ref.name : '',
    mime: typeof ref.mime === 'string' ? ref.mime : '',
  }
}

function sanitizeAiMessages(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((msg) => {
      const role = msg?.role === 'user' || msg?.role === 'assistant' ? msg.role : ''
      if (!role) return null
      return {
        id: typeof msg.id === 'string' ? msg.id : crypto.randomUUID(),
        role,
        content: typeof msg.content === 'string' ? msg.content : '',
        steps: Array.isArray(msg.steps) ? msg.steps.map(String).filter(Boolean).slice(0, 8) : [],
        refs: sanitizeAiMessageRefs(msg.refs),
        imageAssetId: typeof msg.imageAssetId === 'string' ? msg.imageAssetId : '',
        imageName: typeof msg.imageName === 'string' ? msg.imageName : '',
        imageMime: typeof msg.imageMime === 'string' ? msg.imageMime : '',
        imageDataUrl: shouldInlineHistoryDataUrl(msg.imageDataUrl) ? msg.imageDataUrl : '',
        aspectRatio: normalizeAspectRatio(msg.aspectRatio || ''),
        loading: false,
        loadingText: '',
        streaming: false,
      }
    })
    .filter(Boolean)
    .slice(-AI_HISTORY_LIMIT)
}

function sanitizeAiMessageRefs(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((ref) => {
      const assetId = typeof ref?.assetId === 'string' ? ref.assetId : ''
      const dataUrl = shouldInlineHistoryDataUrl(ref?.dataUrl) ? ref.dataUrl : ''
      if (!assetId && !dataUrl) return null
      return {
        assetId,
        dataUrl,
        name: typeof ref?.name === 'string' ? ref.name : '',
        mime: typeof ref?.mime === 'string' ? ref.mime : '',
      }
    })
    .filter(Boolean)
    .slice(0, 12)
}

function shouldInlineHistoryDataUrl(value) {
  return typeof value === 'string'
    && value.startsWith('data:image/')
    && value.length <= AI_HISTORY_INLINE_DATA_URL_LIMIT
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
    libraryId: item.libraryId || '',
    age: item.age || '',
    gender: item.gender || '',
    ...extra,
  }
}

function serializeJobTask(task = {}) {
  return {
    jobId: String(task.jobId || task.id || ''),
    type: String(task.type || ''),
    status: String(task.status || ''),
    progress: String(task.progress || ''),
    label: String(task.label || ''),
    createdAt: String(task.createdAt || ''),
    updatedAt: String(task.updatedAt || ''),
    loaded: Boolean(task.loaded),
    error: String(task.error || ''),
    itemCount: Number(task.itemCount || 0),
    progressTotal: Number(task.progressTotal || 0),
    progressDone: Number(task.progressDone || 0),
    progressFailed: Number(task.progressFailed || 0),
    thumbs: sanitizeJobTaskThumbs(task.thumbs),
  }
}

function sanitizeJobTaskThumbs(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value
    .map((thumb) => ({
      src: String(thumb?.src || '').trim(),
      label: String(thumb?.label || '').trim(),
    }))
    .filter((thumb) => {
      if (!thumb.src || seen.has(thumb.src)) return false
      seen.add(thumb.src)
      return true
    })
    .slice(0, 3)
}

function normalizeGarmentInstructions(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 800)
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
    instructions: typeof raw.instructions === 'string' ? normalizeGarmentInstructions(raw.instructions) : '',
    libraryId: typeof raw.libraryId === 'string' ? raw.libraryId : '',
    age: typeof raw.age === 'string' ? raw.age : '',
    gender: typeof raw.gender === 'string' ? raw.gender : '',
    dataUrl: '',
    base64: '',
  }
}

function sanitizeStyleHistoryEntries(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const assetId = typeof entry?.assetId === 'string' ? entry.assetId.trim() : ''
      const resultDataUrl = typeof entry?.resultDataUrl === 'string' ? entry.resultDataUrl : ''
      if (!assetId && !resultDataUrl) return null
      return {
        id: typeof entry?.id === 'string' && entry.id ? entry.id : crypto.randomUUID(),
        subject: typeof entry?.subject === 'string' ? entry.subject : '',
        assetId,
        mime: typeof entry?.mime === 'string' ? entry.mime : '',
        resultDataUrl,
        timestamp: Number(entry?.timestamp) || Date.now(),
      }
    })
    .filter(Boolean)
    .slice(-STYLE_HISTORY_LIMIT)
}

function serializeStyleHistoryEntries(entries) {
  return sanitizeStyleHistoryEntries(entries).map((entry) => ({
    id: entry.id,
    subject: entry.subject,
    assetId: entry.assetId || '',
    mime: entry.mime || '',
    resultDataUrl: entry.assetId
      ? ''
      : (shouldInlineHistoryDataUrl(entry.resultDataUrl) ? entry.resultDataUrl : ''),
    timestamp: entry.timestamp,
  }))
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
    void loadAccountApiKeys({ force: true })
  })

  dom.settingsForm.addEventListener('submit', (event) => {
    void saveSettingsForm(event)
  })

  dom.settingsClear.addEventListener('click', () => {
    localStorage.removeItem(KEY_STORAGE)
    state.keys = {}
    hydrateSettingsForm()
    setSettingsKeyStatus('已清空本机保存的 Key')
  })

  dom.settingsClearAccount?.addEventListener('click', () => {
    void clearAccountApiKeys()
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

async function saveSettingsForm(event) {
  event.preventDefault()
  const nextKeys = getKeyFormValues()
  state.keys = nextKeys
  state.theme = getSelectedSettingsTheme()
  applyTheme()
  localStorage.setItem(KEY_STORAGE, JSON.stringify(state.keys))
  savePrefs()

  if (dom.settingsSaveAccount?.checked && state.account.user && hasAnyClientKey(nextKeys)) {
    try {
      setSettingsKeyStatus('正在保存账号 Key…')
      const data = await putJson('/api/account/api-keys', { keys: nextKeys })
      state.account.apiKeys = data.apiKeys || { keys: {}, updatedAt: '' }
      state.account.apiKeysLoadedFor = state.account.user.id
    } catch (error) {
      setSettingsKeyStatus(`本机 Key 已保存；账号同步失败：${trimError(error)}`, 'err')
      return
    }
  }

  setSettingsKeyStatus('本机 Key 已保存')
  dom.settingsDialog.close()
}

function getKeyFormValues() {
  const keys = {
    visionApiKey: $('#k-vision').value.trim(),
    banana2ApiKey: $('#k-banana2').value.trim(),
    bananaProApiKey: $('#k-bananapro').value.trim(),
    gptImageApiKey: $('#k-gptimage').value.trim(),
  }
  for (const key of Object.keys(keys)) {
    if (!keys[key]) delete keys[key]
  }
  return keys
}

function hasAnyClientKey(keys) {
  return Object.values(keys || {}).some(Boolean)
}

function setSettingsKeyStatus(message, tone = '') {
  if (!dom.settingsAccountStatus) return
  dom.settingsAccountStatus.textContent = message || ''
  dom.settingsAccountStatus.classList.toggle('err', tone === 'err')
}

async function clearAccountApiKeys() {
  if (!state.account.user) {
    setSettingsKeyStatus('登录后才能清空账号 Key', 'err')
    return
  }
  try {
    setSettingsKeyStatus('正在清空账号 Key…')
    const data = await deleteJson('/api/account/api-keys')
    state.account.apiKeys = data.apiKeys || { keys: {}, updatedAt: '' }
    state.account.apiKeysLoadedFor = state.account.user.id
    hydrateSettingsForm()
    setSettingsKeyStatus('已清空账号 Key')
  } catch (error) {
    setSettingsKeyStatus(trimError(error), 'err')
  }
}

async function loadAccountApiKeys({ force = false } = {}) {
  if (!state.account.user) {
    state.account.apiKeys = { keys: {}, updatedAt: '' }
    state.account.apiKeysLoadedFor = ''
    hydrateSettingsForm({ preserveKeyInputs: dom.settingsDialog?.open })
    return
  }
  if (!force && state.account.apiKeysLoadedFor === state.account.user.id) {
    hydrateSettingsForm({ preserveKeyInputs: dom.settingsDialog?.open })
    return
  }
  let errorMessage = ''
  try {
    const data = await getJson('/api/account/api-keys')
    state.account.apiKeys = data.apiKeys || { keys: {}, updatedAt: '' }
    state.account.apiKeysLoadedFor = state.account.user.id
  } catch (error) {
    errorMessage = trimError(error)
  } finally {
    hydrateSettingsForm({ preserveKeyInputs: dom.settingsDialog?.open })
    if (errorMessage) setSettingsKeyStatus(errorMessage, 'err')
  }
}

function bindAccount() {
  const openAccountPage = () => {
    showAuthView()
    renderAccount()
    if (!state.account.user) {
      requestAnimationFrame(() => dom.accountEmailInput?.focus())
    }
  }
  dom.accountBtn?.addEventListener('click', openAccountPage)
  dom.hAccount?.addEventListener('click', openAccountPage)
  dom.authBack?.addEventListener('click', () => setActiveView('home'))
  dom.authSettings?.addEventListener('click', () => {
    hydrateSettingsForm()
    dom.settingsDialog.showModal()
    void loadAccountApiKeys({ force: true })
  })

  dom.accountLogin?.addEventListener('click', () => {
    void submitAccountAuth('login')
  })
  dom.accountRegister?.addEventListener('click', () => {
    void submitAccountAuth('register')
  })
  dom.accountLogout?.addEventListener('click', () => {
    void logoutAccount()
  })
}

async function loadAccount({ handleInvite = true } = {}) {
  try {
    const data = await getJson('/api/auth/me')
    state.account.user = data.user || null
    state.account.usage = data.usage || null
    state.account.error = ''
    if (state.account.user) {
      await loadAccountApiKeys()
    } else {
      state.account.apiKeys = { keys: {}, updatedAt: '' }
      state.account.apiKeysLoadedFor = ''
    }
  } catch (error) {
    state.account.error = trimError(error)
  } finally {
    renderAccount()
    if (handleInvite) void handlePendingInvite()
  }
}

async function handlePendingInvite() {
  const token = new URLSearchParams(window.location.search).get('invite') || ''
  if (!token) return false
  if (!state.account.user) {
    state.account.status = '请先登录或注册后接受项目邀请'
    renderAccount()
    showAuthView({
      returnTo: '/lovart/projects',
      invite: token,
      replace: true,
    })
    return true
  }
  try {
    const data = await postJson(`/api/canvas/invites/${encodeURIComponent(token)}/accept`, {})
    state.projects.filterShared = true
    state.projects.loadedSessionId = ''
    await loadCanvasProjects({ force: true })
    window.history.replaceState({}, '', '/lovart/projects')
    if (data.projectId) void openCanvasProject(data.projectId)
    clearAuthReturnTarget()
  } catch (error) {
    state.account.error = trimError(error)
    renderAccount()
    showAuthView({ invite: token, replace: true })
  }
  return true
}

async function submitAccountAuth(mode) {
  const email = dom.accountEmailInput?.value.trim() || ''
  const password = dom.accountPasswordInput?.value || ''
  const name = dom.accountNameInput?.value.trim() || ''
  state.account.loading = true
  state.account.status = mode === 'register' ? '正在注册…' : '正在登录…'
  state.account.error = ''
  renderAccount()
  try {
    const data = await postJson(`/api/auth/${mode}`, {
      email,
      password,
      name,
      sessionId: state.runtime.sessionId || undefined,
    })
    state.account.user = data.user || null
    state.account.status = state.account.user ? '已登录' : ''
    dom.accountPasswordInput.value = ''
    await loadAccountApiKeys({ force: true })
    await loadAccount({ handleInvite: false })
    state.projects.loadedSessionId = ''
    void loadCanvasProjects({ force: true })
    const handledInvite = await handlePendingInvite()
    if (!handledInvite) redirectAfterAuth()
  } catch (error) {
    state.account.error = trimError(error)
  } finally {
    state.account.loading = false
    renderAccount()
  }
}

async function logoutAccount() {
  state.account.loading = true
  state.account.status = '正在退出…'
  renderAccount()
  try {
    await postJson('/api/auth/logout', {})
    state.account.user = null
    state.account.usage = null
    state.account.apiKeys = { keys: {}, updatedAt: '' }
    state.account.apiKeysLoadedFor = ''
    state.account.status = '已退出登录'
    state.projects.loadedSessionId = ''
    void loadCanvasProjects({ force: true })
  } catch (error) {
    state.account.error = trimError(error)
  } finally {
    state.account.loading = false
    renderAccount()
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
      resetLoadedWorkspaceForDraft('translate')
      setJobTab('translate', 'current')
      state.translate.progress = '正在读取图片…'
      renderTranslate()
      const images = await prepareAssetItems(files, {
        onProgress: ({ current, total, filename }) => {
          state.translate.progress = `正在上传图片 ${current}/${total} · ${filename}`
          renderTranslate()
        },
      })
      state.translate.items.push(...images.map((item) => ({ ...item, results: {} })))
      state.translate.progress = ''
      saveRuntimeState()
      renderTranslate()
    },
    onClick: () => !isTranslateBusy(),
  })

  dom.tRunBtn.addEventListener('click', runTranslateBatch)
  for (const button of dom.tJobTabs || []) {
    button.addEventListener('click', () => {
      setJobTab('translate', button.dataset.jobTab)
      saveRuntimeState()
      renderTranslate()
    })
  }
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
    handleProjectCardCollectionClick(event)
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
  dom.pShared?.addEventListener('click', () => {
    state.projects.filterShared = !state.projects.filterShared
    state.projects.loadedSessionId = ''
    void loadCanvasProjects({ force: true })
    renderProjects()
  })
  dom.pList?.addEventListener('click', (event) => {
    handleProjectCardCollectionClick(event)
  })

  dom.projectDeleteConfirm?.addEventListener('click', () => {
    void deleteCanvasProjectFromDialog()
  })
  dom.projectDeleteDialog?.addEventListener('close', () => {
    if (state.projects.deleting) return
    state.projects.deleteTargetId = ''
    state.projects.deleteStatus = ''
  })
}

function bindTaskDeleteDialog() {
  dom.taskDeleteConfirm?.addEventListener('click', () => {
    void deleteTaskFromDialog()
  })
  dom.taskDeleteDialog?.addEventListener('close', () => {
    if (state.taskDelete.deleting) return
    state.taskDelete.kind = ''
    state.taskDelete.jobId = ''
    state.taskDelete.status = ''
  })
}

function handleProjectCardCollectionClick(event) {
  const target = event.target instanceof Element ? event.target : null
  if (!target) return false

  const del = target.closest('[data-project-delete]')
  if (del) {
    event.preventDefault()
    event.stopPropagation()
    openProjectDeleteDialog(del.dataset.projectDelete)
    return true
  }

  const share = target.closest('[data-project-share]')
  if (share) {
    event.preventDefault()
    event.stopPropagation()
    void openShareDialog(share.dataset.projectShare)
    return true
  }

  const card = target.closest('[data-project-id]')
  if (!card) return false
  void openCanvasProject(card.dataset.projectId)
  return true
}

function bindShare() {
  dom.shareInvite?.addEventListener('click', () => {
    void inviteProjectMember()
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

  dom.gShare?.addEventListener('click', () => {
    void openShareDialog(state.generate.projectId)
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

    const prompt = getCanvasElementPrompt(el)
    if (prompt) {
      const viewPrompt = document.createElement('button')
      viewPrompt.type = 'button'
      viewPrompt.className = 'context-menu-item'
      viewPrompt.textContent = '查看prompt'
      viewPrompt.addEventListener('click', () => {
        openPromptDialog(prompt)
        hideContextMenu()
      })
      menu.append(viewPrompt)
    }

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
    generatingPrompt: typeof meta.prompt === 'string' ? meta.prompt : '',
  }
  state.generate.elements.push(el)
  state.generate.selectedIds = [el.id]
  return el
}

function replaceCanvasElementWithImage(el, dataUrl, name, meta = {}) {
  if (!el) return null
  const size = getCanvasImageSize(meta.aspectRatio, meta.width, meta.height)
  el.type = 'image'
  el.content = dataUrl
  el.name = name || el.name || 'image'
  el.mime = meta.mime || splitDataUrl(dataUrl)?.mime || 'image/png'
  el.assetId = meta.assetId || ''
  el.aspectRatio = normalizeAspectRatio(meta.aspectRatio || '')
  el.resolution = normalizeCanvasResolution(meta.resolution || '')
  el.generatingPrompt = typeof meta.prompt === 'string' && meta.prompt.trim()
    ? meta.prompt
    : (el.generatingPrompt || '')
  el.generatingStatus = ''
  el.generatingError = ''
  el.width = size.width
  el.height = size.height
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

function addGeneratingPlaceholderToCanvas({ prompt = '', aspectRatio = state.generate.genRatio, resolution = state.generate.genResolution } = {}) {
  markCanvasGuideSeen()
  const size = getCanvasImageSize(aspectRatio)
  const cx = (dom.gCanvasContainer.clientWidth / 2 - state.generate.panX) / state.generate.scale - size.width / 2
  const cy = (dom.gCanvasContainer.clientHeight / 2 - state.generate.panY) / state.generate.scale - size.height / 2
  const el = {
    id: crypto.randomUUID(),
    type: 'image-generator',
    x: cx,
    y: cy,
    width: size.width,
    height: size.height,
    content: '',
    referenceImageId: null,
    generatingPrompt: prompt,
    generatingStatus: '正在调用图像模型生成图片…',
    generatingError: '',
    aspectRatio: normalizeAspectRatio(aspectRatio),
    resolution: normalizeCanvasResolution(resolution),
  }
  state.generate.elements.push(el)
  state.generate.selectedIds = [el.id]
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
    if (node && node.dataset.elType !== el.type) {
      node.remove()
      node = null
    }
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
    } else if (el.type === 'image-generator') {
      updateCanvasGeneratorNode(node, el)
    }
  }

  updateCanvasTransform()
  renderConnectors()
}

function renderCanvasElement(el) {
  const node = document.createElement('div')
  node.className = `canvas-el canvas-el-${el.type}`
  node.dataset.elId = el.id
  node.dataset.elType = el.type

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
    text.addEventListener('input', () => {
      updateCanvasTextElementContent(el, text.textContent || '')
    })
    text.addEventListener('blur', () => {
      updateCanvasTextElementContent(el, text.textContent || '')
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
    node.append(placeholder)
    updateCanvasGeneratorNode(node, el)
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

function updateCanvasGeneratorNode(node, el) {
  const placeholder = node.querySelector('.canvas-el-generator')
  if (!placeholder) return
  const status = String(el.generatingStatus || '').trim()
  const error = String(el.generatingError || '').trim()
  const isLoading = Boolean(status)
  const hasError = Boolean(error)
  placeholder.classList.toggle('loading', isLoading)
  placeholder.classList.toggle('error', hasError)
  placeholder.replaceChildren()

  if (isLoading) {
    const skeleton = document.createElement('div')
    skeleton.className = 'canvas-gen-skeleton'
    for (const className of ['hero', 'line', 'short']) {
      const bar = document.createElement('span')
      bar.className = className
      skeleton.append(bar)
    }
    placeholder.append(skeleton)
  } else {
    const icon = document.createElement('span')
    icon.className = 'canvas-gen-icon'
    icon.textContent = hasError ? '!' : '\u2726'
    placeholder.append(icon)
  }

  const label = document.createElement('span')
  label.className = 'canvas-gen-label'
  label.textContent = isLoading ? '正在生成' : (hasError ? '生成失败' : 'AI 生图')
  placeholder.append(label)

  const hint = document.createElement('span')
  hint.className = 'gen-hint'
  hint.textContent = isLoading ? status : (hasError ? error : '选中后设置参数并生成')
  placeholder.append(hint)
}

function updateCanvasTextElementContent(el, content) {
  if (!el) return
  const nextContent = String(content || '')
  if (el.content === nextContent) return
  el.content = nextContent
  saveRuntimeState()
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

  const prompt = getCanvasElementPrompt(el)
  if (prompt) {
    const viewPrompt = document.createElement('button')
    viewPrompt.type = 'button'
    viewPrompt.className = 'canvas-el-action'
    viewPrompt.textContent = '查看prompt'
    viewPrompt.addEventListener('mousedown', (event) => event.stopPropagation())
    viewPrompt.addEventListener('click', (event) => {
      event.stopPropagation()
      openPromptDialog(prompt)
    })
    actions.append(viewPrompt)
  }

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

function getCanvasElementPrompt(el) {
  return String(el?.generatingPrompt || el?.prompt || '').trim()
}

function openPromptDialog(prompt) {
  const value = String(prompt || '').trim()
  if (!value || !dom.promptDialog || !dom.promptContent) return
  dom.promptContent.value = value
  if (dom.promptCopyStatus) dom.promptCopyStatus.textContent = ''
  dom.promptDialog.showModal()
  requestAnimationFrame(() => dom.promptContent.focus())
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

  renderGenPanelRefs()
  dom.gGenPanel.classList.remove('hidden')
  updateGenPanelBusy(
    state.generate.genRunning && state.generate.genTargetId === elementId,
    el.generatingStatus || el.generatingError || '',
    { error: Boolean(el.generatingError) },
  )

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

function updateGenPanelBusy(isBusy, message = '', options = {}) {
  const text = String(message || '').trim()
  const isError = Boolean(options.error)
  dom.gGenPrompt.disabled = isBusy
  dom.gModel.disabled = isBusy
  dom.gGenRatio.disabled = isBusy
  dom.gGenResolution.disabled = isBusy
  dom.gAgent.disabled = isBusy
  dom.gGenRefUpload.disabled = isBusy
  dom.gGenRun.disabled = isBusy
  dom.gGenRun.classList.toggle('running', isBusy)
  dom.gGenRun.textContent = isBusy ? '生成中…' : '生成'
  for (const button of $$('.gen-panel-ref-rm', dom.gGenRefList)) button.disabled = isBusy

  dom.gGenProgress.classList.toggle('hidden', !text)
  dom.gGenProgress.classList.toggle('err', isError)
  dom.gGenProgress.replaceChildren()
  if (!text) return
  if (isBusy) {
    const spinner = document.createElement('span')
    spinner.className = 'spinner'
    dom.gGenProgress.append(spinner)
  }
  const label = document.createElement('span')
  label.textContent = text
  dom.gGenProgress.append(label)
}

function setCanvasGenerateStatus(el, message) {
  if (!el) return
  el.generatingStatus = String(message || '')
  el.generatingError = ''
  updateGenPanelBusy(true, el.generatingStatus)
  renderCanvas()
}

function shouldUseAsyncCanvasGenerate(modelId, resolution, refImages = []) {
  return modelId === 'gpt-image-2'
    && (normalizeCanvasResolution(resolution) === '4k' || refImages.length > 0)
}

async function requestCanvasGenerate(payload, { onStatus = null } = {}) {
  if (!shouldUseAsyncCanvasGenerate(payload.modelId, payload.resolution, payload.referenceImages || [])) {
    return postJson('/api/generate-direct', payload)
  }

  onStatus?.('正在提交 4K 生成任务…')
  const submitted = await postJson('/api/jobs/generate-direct', payload)
  state.runtime.sessionId = submitted.sessionId || state.runtime.sessionId
  onStatus?.('4K 任务已提交，正在等待生成完成…')
  return waitForCanvasGenerateJob(submitted.jobId, {
    projectId: state.generate.projectId,
    onStatus,
  })
}

async function waitForCanvasGenerateJob(jobId, { projectId = state.generate.projectId, onStatus = null } = {}) {
  if (!jobId) throw new Error('生成任务 id 缺失')
  const startedAt = Date.now()
  let lastStatus = ''

  while (Date.now() - startedAt < CANVAS_GENERATE_POLL_TIMEOUT_MS) {
    const [jobData, itemsData] = await Promise.all([
      getJson(`/api/jobs/${encodeURIComponent(jobId)}`),
      getJson(`/api/jobs/${encodeURIComponent(jobId)}/items`),
    ])
    const job = jobData.job || {}
    const item = Array.isArray(itemsData.items) ? itemsData.items[0] : null
    const status = item?.status || job.status || ''

    if (status && status !== lastStatus) {
      lastStatus = status
      onStatus?.(formatCanvasGenerateJobStatus(status))
    }

    if (status === 'completed') {
      const resultAssetId = String(item?.outputJson?.resultAssetId || job.summaryJson?.resultAssetId || '').trim()
      if (!resultAssetId) throw new Error('生成完成但缺少结果资源')
      const assetData = await getJson(`/api/assets/${encodeURIComponent(resultAssetId)}?includeData=1${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`)
      if (!assetData?.dataUrl) throw new Error('生成结果读取失败')
      return {
        sessionId: state.runtime.sessionId,
        jobId,
        resultAsset: assetData.asset,
        resultDataUrl: assetData.dataUrl,
      }
    }

    if (status === 'failed' || status === 'cancelled') {
      const message = item?.errorMessage || job.summaryJson?.error || (status === 'cancelled' ? '生成任务已取消' : '生成任务失败')
      throw new Error(message)
    }

    await wait(CANVAS_GENERATE_POLL_INTERVAL_MS)
  }

  throw new Error('生成任务等待超时，请稍后在项目中查看结果')
}

function formatCanvasGenerateJobStatus(status) {
  return ({
    queued: '任务排队中…',
    running: '图像模型正在生成 4K 图片…',
    completed: '正在读取生成结果…',
    failed: '生成任务失败',
    cancelled: '生成任务已取消',
  })[status] || '正在等待生成任务…'
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
  el.generatingPrompt = prompt
  setCanvasGenerateStatus(el, '正在准备生成任务…')
  let failedMessage = ''

  try {
    // Upload reference images if needed
    const refImages = []
    for (const [index, ref] of state.generate.genRefs.entries()) {
      if (ref.assetId) {
        refImages.push({ assetId: ref.assetId, role: ref.role || 'subject' })
      } else if (ref.dataUrl) {
        setCanvasGenerateStatus(el, `正在上传参考图 ${index + 1}/${state.generate.genRefs.length}…`)
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

    let finalPrompt = prompt
    if (state.generate.genUseAgent) {
      setCanvasGenerateStatus(el, '正在整理画面提示词…')
      const agentData = await postJson('/api/canvas/agent', {
        sessionId: state.runtime.sessionId || undefined,
        message: prompt,
        history: [],
        canvasContext: getCanvasAgentContext(),
        modelId: state.generate.genModel,
        aspectRatio: state.generate.genRatio,
        resolution: state.generate.genResolution,
        hasReferenceImages: refImages.length > 0,
        clientKeys: { ...state.keys },
      })
      state.runtime.sessionId = agentData.sessionId || state.runtime.sessionId
      finalPrompt = String(agentData.prompt || '').trim() || prompt
    }

    setCanvasGenerateStatus(el, '正在调用图像模型生成图片…')
    const data = await requestCanvasGenerate({
      sessionId: state.runtime.sessionId || undefined,
      modelId: state.generate.genModel,
      prompt: finalPrompt,
      referenceImages: refImages,
      aspectRatio: state.generate.genRatio,
      resolution: state.generate.genResolution,
      useDesignAgent: false,
      clientKeys: { ...state.keys },
    }, {
      onStatus: (message) => setCanvasGenerateStatus(el, message),
    })

    state.runtime.sessionId = data.sessionId || state.runtime.sessionId
    setCanvasGenerateStatus(el, '正在保存生成结果…')
    const storedResult = data.resultAsset
      ? { assetId: data.resultAsset.id, mime: data.resultAsset.mime || splitDataUrl(data.resultDataUrl)?.mime || 'image/png' }
      : await uploadCanvasImageAsset(data.resultDataUrl, `generated-${el.id}.png`, {
        kind: 'result',
        source: 'canvas_generation',
      })
    const imageSize = await getImageDimensions(data.resultDataUrl).catch(() => null)

    replaceCanvasElementWithImage(el, data.resultDataUrl, `generated-${el.id}`, {
      assetId: storedResult.assetId,
      mime: storedResult.mime,
      aspectRatio: state.generate.genRatio,
      resolution: state.generate.genResolution,
      prompt: finalPrompt,
      width: imageSize?.width,
      height: imageSize?.height,
    })

    state.generate.genRefs = []
    hideGenPanel()
  } catch (error) {
    failedMessage = `生成失败：${trimError(error)}`
    el.generatingStatus = ''
    el.generatingError = failedMessage
  } finally {
    state.generate.genRunning = false
    updateGenPanelBusy(false, failedMessage, { error: Boolean(failedMessage) })
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
  dom.gAiSession?.addEventListener('change', () => {
    activateAiSession(dom.gAiSession.value)
    saveRuntimeState()
    renderAiMessages()
    renderAiRefList()
    renderAiSessionControls()
  })
  dom.gAiNewSession?.addEventListener('click', startNewAiSession)
  dom.gAiClearSession?.addEventListener('click', clearCurrentAiSession)

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

function renderAiSessionControls() {
  if (!dom.gAiSession) return
  ensureAiSessionSelection()
  if (state.generate.aiMessages.length) persistCurrentAiSession()
  const options = state.generate.aiSessions.slice().reverse().map((session, index) => {
    const option = document.createElement('option')
    option.value = session.id
    option.textContent = session.title || `会话 ${state.generate.aiSessions.length - index}`
    return option
  })
  dom.gAiSession.replaceChildren(...options)
  dom.gAiSession.value = state.generate.aiSessionId || state.generate.aiSessions[0]?.id || ''
  const busy = state.generate.aiRunning
  dom.gAiSession.disabled = busy || state.generate.aiSessions.length <= 1
  if (dom.gAiNewSession) dom.gAiNewSession.disabled = busy
  if (dom.gAiClearSession) dom.gAiClearSession.disabled = busy || state.generate.aiMessages.length === 0
}

function renderAiMessages() {
  renderAiSessionControls()
  if (dom.gSend) {
    dom.gSend.disabled = state.generate.aiRunning
    dom.gSend.textContent = state.generate.aiRunning ? '处理中' : '发送'
  }
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
    if (msg.loading) bubble.classList.add('loading')
    if (msg.streaming) bubble.classList.add('streaming')
    const contentText = String(msg.content || '')
    if (contentText) {
      const content = document.createElement('div')
      content.className = 'msg-content'
      content.append(document.createTextNode(contentText))
      if (msg.streaming) {
        const caret = document.createElement('span')
        caret.className = 'msg-typing-caret'
        content.append(caret)
      }
      bubble.append(content)
    }
    if (msg.loading) {
      bubble.append(createAiLoadingNode(msg.loadingText || 'AI 正在思考'))
    } else if (!contentText) {
      bubble.textContent = ''
    }
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

function createAiLoadingNode(text) {
  const row = document.createElement('div')
  row.className = 'msg-loading'
  const spinner = document.createElement('span')
  spinner.className = 'spinner'
  const label = document.createElement('span')
  label.textContent = text
  const dots = document.createElement('span')
  dots.className = 'msg-loading-dots'
  for (let i = 0; i < 3; i += 1) {
    dots.append(document.createElement('span'))
  }
  row.append(spinner, label, dots)
  return row
}

function setAiMessageLoading(msg, loadingText) {
  msg.loading = true
  msg.loadingText = loadingText
  msg.streaming = false
  renderAiMessages()
}

async function streamAiMessageContent(msg, text, { fromCurrent = false } = {}) {
  const finalText = String(text || '')
  const currentText = String(msg.content || '')
  const startText = fromCurrent && finalText.startsWith(currentText) ? currentText : ''
  msg.loading = false
  msg.loadingText = ''
  msg.streaming = true
  msg.content = startText
  renderAiMessages()

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reducedMotion || finalText.length <= startText.length) {
    msg.content = finalText
    msg.streaming = false
    renderAiMessages()
    return
  }

  let index = startText.length
  while (index < finalText.length) {
    index = Math.min(index + AI_STREAM_CHUNK_SIZE, finalText.length)
    msg.content = finalText.slice(0, index)
    renderAiMessages()
    const lastChar = finalText[index - 1]
    const delay = /[，。！？；：\n,.!?;:]/.test(lastChar) ? AI_STREAM_PUNCTUATION_DELAY_MS : AI_STREAM_DELAY_MS
    await wait(delay)
  }

  msg.content = finalText
  msg.streaming = false
  renderAiMessages()
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
  await ensureCanvasProjectRecord()
  const requestText = text || '基于参考图生成一版。'
  const history = state.generate.aiMessages
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
    .map((msg) => ({ role: msg.role, content: msg.content || '' }))
    .slice(-8)
  const aiModelId = dom.gAiModel.value || state.generate.genModel
  const aiAspectRatio = normalizeAspectRatio(dom.gAiRatio.value || state.generate.genRatio)
  const aiResolution = normalizeCanvasResolution(dom.gAiResolution.value || state.generate.genResolution)
  let canvasPendingEl = null

  const userMsg = {
    id: crypto.randomUUID(),
    role: 'user',
    content: requestText,
    refs: state.generate.aiRefs.map((r) => ({ assetId: r.assetId || '', dataUrl: r.dataUrl, name: r.name, mime: r.mime || 'image/png' })),
  }
  const assistantMsg = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    loading: true,
    loadingText: '正在理解画布和需求',
    steps: [],
  }
  state.generate.aiMessages.push(userMsg)
  dom.gInput.value = ''
  state.generate.aiRunning = true
  state.generate.aiMessages.push(assistantMsg)
  renderAiMessages()
  saveRuntimeState()

  try {
    // 上传参考图
    const refImages = []
    if (state.generate.aiRefs.length) {
      setAiMessageLoading(assistantMsg, '正在读取参考图')
    }
    for (const [index, ref] of state.generate.aiRefs.entries()) {
      if (ref.assetId) {
        if (userMsg.refs[index]) userMsg.refs[index].assetId = ref.assetId
        refImages.push({ assetId: ref.assetId, role: 'subject' })
      } else if (ref.dataUrl) {
        setAiMessageLoading(assistantMsg, `正在上传参考图 ${refImages.length + 1}/${state.generate.aiRefs.length}`)
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
        if (userMsg.refs[index]) {
          userMsg.refs[index].assetId = uploaded.asset.id
          userMsg.refs[index].mime = uploaded.asset.mime || userMsg.refs[index].mime || 'image/png'
        }
        refImages.push({ assetId: uploaded.asset.id, role: 'subject' })
      }
    }

    setAiMessageLoading(assistantMsg, '正在整理设计思路')
    const agentData = await postJson('/api/canvas/agent', {
      sessionId: state.runtime.sessionId || undefined,
      message: requestText,
      history,
      canvasContext: getCanvasAgentContext(),
      modelId: aiModelId,
      aspectRatio: aiAspectRatio,
      resolution: aiResolution,
      hasReferenceImages: refImages.length > 0,
      clientKeys: { ...state.keys },
    })
    state.runtime.sessionId = agentData.sessionId || state.runtime.sessionId
    const replyText = agentData.reply || '我已经整理好设计方向。'
    await streamAiMessageContent(assistantMsg, replyText)
    assistantMsg.steps = Array.isArray(agentData.steps) ? agentData.steps : []
    renderAiMessages()

    if (!agentData.shouldGenerate) {
      saveRuntimeState()
      return
    }

    const generationPrompt = agentData.prompt || requestText
    setAiMessageLoading(assistantMsg, '正在生成图片并放到画布')
    canvasPendingEl = addGeneratingPlaceholderToCanvas({
      prompt: generationPrompt,
      aspectRatio: aiAspectRatio,
      resolution: aiResolution,
    })
    renderCanvas()

    const data = await requestCanvasGenerate({
      sessionId: state.runtime.sessionId || undefined,
      modelId: aiModelId,
      prompt: generationPrompt,
      referenceImages: refImages,
      aspectRatio: aiAspectRatio,
      resolution: aiResolution,
      useDesignAgent: false,
      clientKeys: { ...state.keys },
    }, {
      onStatus: (message) => setAiMessageLoading(assistantMsg, message),
    })

    state.runtime.sessionId = data.sessionId || state.runtime.sessionId
    const storedResult = data.resultAsset
      ? { assetId: data.resultAsset.id, mime: data.resultAsset.mime || splitDataUrl(data.resultDataUrl)?.mime || 'image/png' }
      : await uploadCanvasImageAsset(data.resultDataUrl, `ai-${Date.now()}.png`, {
        kind: 'result',
        source: 'canvas_ai_sidebar',
      })
    const imageSize = await getImageDimensions(data.resultDataUrl).catch(() => null)

    assistantMsg.imageDataUrl = data.resultDataUrl
    assistantMsg.imageAssetId = storedResult.assetId
    assistantMsg.imageMime = storedResult.mime
    assistantMsg.imageName = `ai-${Date.now()}`
    assistantMsg.aspectRatio = aiAspectRatio

    if (canvasPendingEl && state.generate.elements.includes(canvasPendingEl) && canvasPendingEl.type === 'image-generator') {
      replaceCanvasElementWithImage(canvasPendingEl, data.resultDataUrl, assistantMsg.imageName, {
        assetId: storedResult.assetId,
        mime: storedResult.mime,
        aspectRatio: aiAspectRatio,
        resolution: aiResolution,
        prompt: generationPrompt,
        width: imageSize?.width,
        height: imageSize?.height,
      })
    } else {
      addImageToCanvas(data.resultDataUrl, assistantMsg.imageName, undefined, undefined, {
        assetId: storedResult.assetId,
        mime: storedResult.mime,
        aspectRatio: aiAspectRatio,
        resolution: aiResolution,
        prompt: generationPrompt,
        width: imageSize?.width,
        height: imageSize?.height,
      })
    }
    state.generate.aiRefs = []
    renderAiRefList()
    renderCanvas()
    await streamAiMessageContent(assistantMsg, `${replyText}\n\n图片已添加到画布。`, { fromCurrent: true })
    saveRuntimeState()
  } catch (error) {
    const message = trimError(error)
    assistantMsg.loading = false
    assistantMsg.streaming = false
    assistantMsg.loadingText = ''
    assistantMsg.content = `处理失败：${message}`
    if (canvasPendingEl && state.generate.elements.includes(canvasPendingEl) && canvasPendingEl.type === 'image-generator') {
      canvasPendingEl.generatingStatus = ''
      canvasPendingEl.generatingError = `处理失败：${message}`
      renderCanvas()
      saveRuntimeState()
    }
    saveRuntimeState()
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

  dom.oModelAdd.addEventListener('click', () => {
    if (isOutfitBusy()) return
    dom.oModelInput.click()
  })

  dom.oModelLibraryOpen?.addEventListener('click', () => {
    if (isOutfitBusy()) return
    openModelLibraryDialog()
  })

  dom.oModelLibraryConfirm?.addEventListener('click', addSelectedModelLibraryItems)

  dom.oModelLibraryDialog?.addEventListener('close', () => {
    modelLibrarySelectedIds = new Set()
    if (dom.oModelLibraryStatus) dom.oModelLibraryStatus.textContent = ''
    renderModelLibraryDialog()
  })

  for (const input of [...dom.oModelLibraryAge, ...dom.oModelLibraryGender]) {
    input.addEventListener('change', () => {
      renderModelLibraryDialog()
    })
  }

  dom.oGarmentAdd.addEventListener('click', () => {
    if (isOutfitBusy()) return
    dom.oGarmentInput.click()
  })

  bindDropSurface({
    surface: dom.oModelList.closest('.lane'),
    input: dom.oModelInput,
    onFiles: async (files) => {
      if (isOutfitBusy()) return
      resetLoadedWorkspaceForDraft('outfit')
      setJobTab('outfit', 'current')
      state.outfit.progress = '正在读取模特图…'
      renderOutfit()
      const images = await prepareAssetItems(files, {
        onProgress: ({ current, total, filename }) => {
          state.outfit.progress = `正在上传模特图 ${current}/${total} · ${filename}`
          renderOutfit()
        },
      })
      state.outfit.models.push(...images)
      pruneOutfitResults()
      state.outfit.progress = ''
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
      resetLoadedWorkspaceForDraft('outfit')
      setJobTab('outfit', 'current')
      state.outfit.progress = '正在读取服装图…'
      renderOutfit()
      const images = await prepareAssetItems(files, {
        onProgress: ({ current, total, filename }) => {
          state.outfit.progress = `正在上传服装图 ${current}/${total} · ${filename}`
          renderOutfit()
        },
      })
      state.outfit.garments.push(...images.map((item) => ({
        ...item,
        role: state.outfit.garmentType,
        instructions: '',
      })))
      pruneOutfitResults()
      state.outfit.progress = ''
      saveRuntimeState()
      renderOutfit()
    },
    clickable: false,
  })

  dom.oRun.addEventListener('click', runOutfitBatch)
  for (const button of dom.oJobTabs || []) {
    button.addEventListener('click', () => {
      setJobTab('outfit', button.dataset.jobTab)
      saveRuntimeState()
      renderOutfit()
    })
  }
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
    state.style.styleSummary = '正在上传主体参考图…'
    renderStyle()
    const images = await prepareAssetItems(dom.sRefInput.files, {
      onProgress: ({ current, total, filename }) => {
        state.style.styleSummary = `正在上传主体参考图 ${current}/${total} · ${filename}`
        renderStyle()
      },
    })
    state.style.subjectRefs.push(...images)
    if (!state.style.visualStyle) state.style.styleSummary = ''
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
  const visibleHistory = s.history.filter((entry) => entry.resultDataUrl)

  dom.sModel.value = s.model
  dom.sModel.disabled = busy

  const hasSource = Boolean(s.sourceImage)
  const hasStyle = Boolean(s.visualStyle)
  const hasResult = Boolean(s.resultDataUrl)
  const hasHistory = visibleHistory.length > 0

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

  dom.sHistory.replaceChildren(...visibleHistory.slice().reverse().map((entry) => {
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
    const resultName = `style-transfer-${sanitizeFileName(state.style.subject || 'result')}.png`
    const storedResult = await uploadCanvasImageAsset(data.resultDataUrl, resultName, {
      kind: 'result',
      source: 'style_transfer',
    }).catch(() => null)

    state.style.history.push({
      id: crypto.randomUUID(),
      subject: state.style.subject.trim() || state.style.subjectRefs.map((r) => basename(r.name)).join(', '),
      assetId: storedResult?.assetId || '',
      mime: storedResult?.mime || splitDataUrl(data.resultDataUrl)?.mime || 'image/png',
      resultDataUrl: data.resultDataUrl,
      timestamp: Date.now(),
    })
    state.style.history = sanitizeStyleHistoryEntries(state.style.history)

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
  renderAppNotice()
  renderHome()
  renderTranslateDropdowns()
  renderTranslate()
  renderProjects()
  renderAccount()
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

function bindAppNotice() {
  dom.noticeClose?.addEventListener('click', () => {
    state.notice.message = ''
    renderAppNotice()
  })
}

function renderAppNotice() {
  if (!dom.notice || !dom.noticeText) return
  const message = String(state.notice.message || '')
  dom.notice.classList.toggle('hidden', !message)
  dom.notice.classList.toggle('ok', state.notice.tone === 'ok')
  dom.noticeText.textContent = message
  if (!message) {
    window.clearTimeout(renderAppNotice.timer)
    renderAppNotice.timer = null
    renderAppNotice.timerMessage = ''
    return
  }
  if (renderAppNotice.timer && renderAppNotice.timerMessage === message) return
  window.clearTimeout(renderAppNotice.timer)
  renderAppNotice.timerMessage = message
  renderAppNotice.timer = window.setTimeout(() => {
    state.notice.message = ''
    renderAppNotice()
  }, RUNTIME_MIGRATION_NOTICE_MS)
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

function bindPromptDialog() {
  dom.promptCopy?.addEventListener('click', async () => {
    const text = dom.promptContent?.value || ''
    if (!text) return
    await copyTextToClipboard(text)
    const original = dom.promptCopy.textContent
    dom.promptCopy.textContent = '已复制'
    if (dom.promptCopyStatus) dom.promptCopyStatus.textContent = 'Prompt 已复制'
    window.setTimeout(() => {
      dom.promptCopy.textContent = original
      if (dom.promptCopyStatus) dom.promptCopyStatus.textContent = ''
    }, 1400)
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
  const showLoadedWorkspace = shouldShowLoadedJobWorkspace('translate')
  dom.tModel.value = state.translate.model
  dom.tConcurrency.value = String(state.translate.concurrency)
  dom.tPreserve.checked = state.translate.preserveBrand
  dom.tProgress.textContent = state.translate.progress

  const hasItems = showLoadedWorkspace && state.translate.items.length > 0

  dom.tRunBtn.disabled = busy || !hasItems || state.translate.targets.length === 0
  dom.tModel.disabled = busy
  dom.tConcurrency.disabled = busy
  dom.tPreserve.disabled = busy
  dom.tDropzone.classList.toggle('disabled', busy)
  dom.tEmpty.classList.toggle('hidden', hasItems)
  renderJobList('translate')

  if (!showLoadedWorkspace || !hasItems) {
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

function renderAccount() {
  if (!dom.accountSummary) return
  const user = state.account.user
  const signedIn = Boolean(user)
  dom.accountSummary.classList.toggle('hidden', !signedIn)
  dom.accountForm.classList.toggle('hidden', signedIn)
  dom.accountFormHead?.classList.toggle('hidden', signedIn)
  dom.accountName.textContent = user?.name || '未登录'
  dom.accountEmail.textContent = user?.email || ''
  const accountLabel = signedIn ? user.name || '账号' : '登录 / 注册'
  if (dom.hAccount) dom.hAccount.textContent = accountLabel
  if (dom.accountBtn) {
    const mark = document.createElement('span')
    mark.className = 'settings-mark'
    mark.textContent = '账号'
    dom.accountBtn.replaceChildren(mark, document.createTextNode(` ${accountLabel}`))
  }
  dom.accountLogin.disabled = state.account.loading
  dom.accountRegister.disabled = state.account.loading
  dom.accountLogout.disabled = state.account.loading
  const usage = state.account.usage?.byType || {}
  const usageParts = Object.entries(usage)
    .map(([key, value]) => `${usageLabel(key)} ${value}`)
  dom.accountUsage.textContent = signedIn && usageParts.length
    ? `用量：${usageParts.join(' · ')}`
    : signedIn
      ? '用量：暂无记录'
      : ''
  dom.accountStatus.textContent = state.account.error || state.account.status || ''
  dom.accountStatus.classList.toggle('err', Boolean(state.account.error))
  dom.accountStatus.classList.toggle('ok', Boolean(!state.account.error && state.account.status))
}

function usageLabel(key) {
  return ({
    generate_direct_result: '画布生图',
    generate_result: 'AI 生图',
    translate_result: '翻译结果',
    outfit_result: '换装结果',
    asset_upload: '上传素材',
  })[key] || key
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
  if (dom.pShared) {
    dom.pShared.classList.toggle('active', state.projects.filterShared)
    dom.pShared.disabled = loading || !state.account.user
    dom.pShared.textContent = state.projects.filterShared ? '全部项目' : '共享项目'
  }

  if (loading && !items.length) {
    dom.pList.replaceChildren(createProjectSkeleton(), createProjectSkeleton(), createProjectSkeleton())
    dom.pEmpty.classList.add('hidden')
    return
  }

  dom.pList.replaceChildren(...items.map(createProjectCard))
  dom.pEmpty.classList.toggle('hidden', items.length > 0 || loading)
}

function renderJobList(kind) {
  const list = kind === 'translate' ? dom.tJobList : dom.oJobList
  const empty = kind === 'translate' ? dom.tJobEmpty : dom.oJobEmpty
  if (!list) return
  const tab = getJobTab(kind)
  const allTasks = getJobTasks(kind)
  const page = setJobPage(kind, getJobPage(kind))
  const allTabTasks = getSortedJobTasksForTab(allTasks, tab)
  const tasks = getPagedJobTasksForTab(allTasks, tab, page)
  const pageCount = getJobTaskPageCount(allTasks, tab)
  const tabButtons = kind === 'translate' ? dom.tJobTabs : dom.oJobTabs
  for (const button of tabButtons || []) {
    const active = button.dataset.jobTab === tab
    const count = filterJobTasksForTab(allTasks, button.dataset.jobTab).length
    button.classList.toggle('active', active)
    button.setAttribute('aria-selected', active ? 'true' : 'false')
    button.textContent = `${button.dataset.jobTab === 'history' ? '历史任务' : '当前任务'} ${count}`
  }
  if (empty) {
    empty.classList.toggle('hidden', allTabTasks.length > 0)
    empty.textContent = tab === 'history' ? '暂无历史任务' : '暂无当前任务'
  }
  const nodes = tasks.map((task) => createJobTaskCard(kind, task, tab))
  const pagination = createJobPagination(kind, tab, page, pageCount, allTabTasks.length)
  if (pagination) nodes.push(pagination)
  list.replaceChildren(...nodes)
}

function createJobPagination(kind, tab, page, pageCount, total) {
  if (tab !== 'history' || total <= JOB_TASKS_PER_PAGE) return null
  const wrap = document.createElement('div')
  wrap.className = 'job-pagination'

  const meta = document.createElement('span')
  meta.textContent = `第 ${page} / ${pageCount} 页 · 共 ${total} 个任务`

  const actions = document.createElement('div')
  actions.className = 'job-pagination-actions'

  const previous = document.createElement('button')
  previous.type = 'button'
  previous.className = 'job-mini-btn'
  previous.textContent = '上一页'
  previous.disabled = page <= 1
  previous.addEventListener('click', () => {
    setJobPage(kind, page - 1)
    saveRuntimeState()
    renderJobList(kind)
  })

  const next = document.createElement('button')
  next.type = 'button'
  next.className = 'job-mini-btn'
  next.textContent = '下一页'
  next.disabled = page >= pageCount
  next.addEventListener('click', () => {
    setJobPage(kind, page + 1)
    saveRuntimeState()
    renderJobList(kind)
  })

  actions.append(previous, next)
  wrap.append(meta, actions)
  return wrap
}

function createJobTaskCard(kind, task, tab = 'current') {
  const live = ACTIVE_JOB_STATUSES.has(task.status)
  const paused = task.status === 'paused'
  const retryable = task.status === 'failed' || task.status === 'partial_failed'
  const currentTab = tab !== 'history'
  const loaded = getLoadedJobId(kind) === task.jobId || task.loaded
  const card = document.createElement('div')
  card.className = `job-card${live ? ' live' : ''}${loaded ? ' current' : ''}`
  card.dataset.jobId = task.jobId || ''

  const thumbs = createJobTaskThumbs(kind, task)
  const meta = document.createElement('div')
  meta.className = 'job-card-meta'
  const topline = document.createElement('div')
  topline.className = 'job-card-topline'
  const title = document.createElement('strong')
  title.textContent = task.label || getJobTypeLabel(task.type)
  const badge = document.createElement('span')
  badge.className = `job-status ${getJobStatusTone(task.status)}`
  badge.textContent = loaded ? `${getJobStatusLabel(task.status)} · 正在查看` : getJobStatusLabel(task.status)
  const actions = document.createElement('div')
  actions.className = 'job-card-actions'
  topline.append(title, badge)
  const detail = document.createElement('span')
  detail.textContent = task.progress || getJobStatusLabel(task.status) || '正在同步任务状态…'
  const time = document.createElement('span')
  time.className = 'job-card-time'
  time.textContent = task.createdAt ? `发起时间 ${formatTimestamp(task.createdAt)}` : '发起时间同步中'
  meta.append(topline, time, detail)

  const load = document.createElement('button')
  load.type = 'button'
  load.className = 'job-mini-btn'
  load.textContent = '查看'
  load.disabled = Boolean(task.syncing)
  load.addEventListener('click', () => {
    void loadJobIntoWorkspace(kind, task.jobId)
  })
  actions.append(load)

  if (live && currentTab) {
    const pause = document.createElement('button')
    pause.type = 'button'
    pause.className = 'job-mini-btn'
    pause.textContent = '暂停'
    pause.disabled = Boolean(task.actioning)
    pause.addEventListener('click', () => {
      void pauseJobTask(kind, task.jobId)
    })
    actions.append(pause)
  }

  if (paused && currentTab) {
    const resume = document.createElement('button')
    resume.type = 'button'
    resume.className = 'job-mini-btn'
    resume.textContent = '继续'
    resume.disabled = Boolean(task.actioning)
    resume.addEventListener('click', () => {
      void resumeJobTask(kind, task.jobId)
    })
    actions.append(resume)
  }

  if (retryable && currentTab) {
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.className = 'job-mini-btn'
    retry.textContent = '重试'
    retry.disabled = Boolean(task.actioning)
    retry.addEventListener('click', () => {
      void retryJobTask(kind, task.jobId)
    })
    actions.append(retry)
  }

  if ((live || paused || retryable) && currentTab) {
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'job-mini-btn danger'
    cancel.textContent = '结束'
    cancel.disabled = Boolean(task.actioning)
    cancel.addEventListener('click', () => {
      void cancelJobTask(kind, task.jobId)
    })
    actions.append(cancel)
  }

  if (shouldShowJobTaskDownload(task, currentTab)) {
    const download = document.createElement('button')
    download.type = 'button'
    download.className = 'job-mini-btn'
    download.textContent = '下载全部'
    download.disabled = Boolean(task.actioning)
    download.addEventListener('click', () => {
      void downloadJobTaskResults(kind, task.jobId)
    })
    actions.append(download)
  }

  if (!currentTab) {
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'job-mini-btn danger'
    remove.textContent = '删除'
    remove.disabled = Boolean(task.actioning)
    remove.addEventListener('click', () => {
      openTaskDeleteDialog(kind, task.jobId)
    })
    actions.append(remove)
  }

  card.append(thumbs, meta, actions)
  if (task.error) {
    const error = document.createElement('div')
    error.className = 'job-card-error'
    error.textContent = task.error
    card.append(error)
  }
  return card
}

function shouldShowJobTaskDownload(task = {}, currentTab = false) {
  if (Number(task.progressDone || 0) > 0) return true
  return !currentTab && (task.status === 'completed' || task.status === 'partial_failed')
}

function getJobTaskDownloadEntries(kind, items = []) {
  const entries = []
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.status !== 'completed') continue
    const resultAssetId = String(item.outputJson?.resultAssetId || '').trim()
    if (!resultAssetId) continue
    if (kind === 'translate') {
      const assetId = sanitizeFileName(String(item.inputJson?.assetId || 'image'))
      const language = sanitizeFileName(String(item.inputJson?.targetLanguage || 'translated'))
      entries.push({
        href: assetResultUrl(resultAssetId),
        name: `${assetId}.${language}.png`,
      })
      continue
    }

    const modelId = sanitizeFileName(String(item.inputJson?.modelAssetId || 'model'))
    const lookId = sanitizeFileName(String(item.inputJson?.lookId || item.id || 'look'))
    entries.push({
      href: assetResultUrl(resultAssetId),
      name: `${modelId}__${lookId}.png`,
    })
  }
  return entries
}

async function downloadJobTaskResults(kind, jobId) {
  const task = upsertJobTask(kind, jobId, { actioning: true, error: '' })
  renderJobList(kind)
  try {
    const { items } = await getJson(`/api/jobs/${encodeURIComponent(jobId)}/items`)
    const entries = getJobTaskDownloadEntries(kind, items)
    if (!entries.length) {
      task.error = '这个任务还没有可下载的完成结果'
      return
    }
    await downloadAll(entries)
  } catch (error) {
    task.error = trimError(error)
  } finally {
    task.actioning = false
    saveRuntimeState()
    renderJobList(kind)
  }
}

function createJobTaskThumbs(kind, task) {
  const thumbs = sanitizeJobTaskThumbs(task.thumbs)
  const wrap = document.createElement('div')
  wrap.className = `job-card-thumbs${thumbs.length ? '' : ' empty'}`
  if (!thumbs.length) {
    const placeholder = document.createElement('span')
    placeholder.textContent = kind === 'translate' ? '译' : '装'
    wrap.append(placeholder)
    return wrap
  }

  for (const thumb of thumbs) {
    const img = document.createElement('img')
    img.src = thumb.src
    img.alt = thumb.label || '任务缩略图'
    img.loading = 'lazy'
    wrap.append(img)
  }
  return wrap
}

function getJobTypeLabel(type) {
  if (type === 'translate_batch') return '批量翻译'
  if (type === 'outfit_batch') return '批量换装'
  return '任务'
}

function getJobStatusLabel(status) {
  return ({
    queued: '排队中',
    running: '进行中',
    paused: '已暂停',
    completed: '已完成',
    partial_failed: '部分失败',
    failed: '失败',
    cancelled: '已取消',
  })[status] || '同步中'
}

function getJobStatusTone(status) {
  if (status === 'completed') return 'ok'
  if (status === 'running' || status === 'queued') return 'run'
  if (status === 'paused') return 'paused'
  if (status === 'failed' || status === 'partial_failed' || status === 'cancelled') return 'err'
  return ''
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
  const card = document.createElement('div')
  card.tabIndex = 0
  card.role = 'button'
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
  const role = project.accessRole && project.accessRole !== 'owner' ? ` · ${project.accessRole}` : ''
  detail.textContent = `${formatRelativeTime(project.updatedAt)} · ${count} 个元素${role}`
  meta.append(title, detail)

  const actions = document.createElement('div')
  actions.className = 'project-card-actions'
  if (project.accessRole === 'owner') {
    const share = document.createElement('button')
    share.type = 'button'
    share.className = 'project-share-btn'
    share.dataset.projectShare = project.id
    share.textContent = '共享'
    actions.append(share)
  }
  if (canDeleteProject(project)) {
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'project-delete-btn'
    del.dataset.projectDelete = project.id
    del.title = `删除 ${project.title || DEFAULT_CANVAS_PROJECT_TITLE}`
    del.textContent = '删除'
    actions.append(del)
  }
  if (actions.childElementCount) {
    meta.append(actions)
  }
  card.append(meta)

  return card
}

function canDeleteProject(project) {
  return !project.accessRole || project.accessRole === 'owner' || project.accessRole === 'legacy'
}

function renderOutfit() {
  const busy = isOutfitBusy()
  const showLoadedWorkspace = shouldShowLoadedJobWorkspace('outfit')
  const looks = buildOutfitLooks()
  const runEstimate = formatOutfitRunEstimate(state.outfit.models.length, looks.length)
  dom.oModel.value = state.outfit.model
  dom.oGarmentType.value = state.outfit.garmentType
  dom.oConcurrency.value = String(state.outfit.concurrency)
  dom.oProgress.textContent = state.outfit.progress || runEstimate
  dom.oModelCount.textContent = String(state.outfit.models.length)
  dom.oGarmentCount.textContent = String(state.outfit.garments.length)
  dom.oLookCount.textContent = String(looks.length)
  dom.oRun.disabled = busy || state.outfit.models.length === 0 || looks.length === 0
  dom.oModel.disabled = busy
  dom.oGarmentType.disabled = busy
  dom.oConcurrency.disabled = busy
  dom.oModelAdd.disabled = busy
  if (dom.oModelLibraryOpen) dom.oModelLibraryOpen.disabled = busy
  dom.oGarmentAdd.disabled = busy
  renderJobList('outfit')

  renderLaneList(dom.oModelList, state.outfit.models, 'model')
  renderLaneList(dom.oGarmentList, state.outfit.garments, 'garment')

  const hasMatrix = showLoadedWorkspace && state.outfit.models.length > 0 && looks.length > 0
  dom.oEmpty.classList.toggle('hidden', hasMatrix)

  if (!showLoadedWorkspace || !hasMatrix) {
    dom.oGrid.replaceChildren()
    return
  }

  const signature = getOutfitSignature({
    modelId: state.outfit.model,
    garmentFingerprint: getOutfitGarmentFingerprint(),
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

function formatOutfitRunEstimate(modelCount, lookCount) {
  const models = Math.max(0, Math.floor(Number(modelCount) || 0))
  const looks = Math.max(0, Math.floor(Number(lookCount) || 0))
  if (!models || !looks) return ''
  return `将生成 ${looks} 套搭配，共 ${models * looks} 张图`
}

function getModelLibraryFilters() {
  return {
    age: dom.oModelLibraryAge.find((input) => input.checked)?.value || 'all',
    gender: dom.oModelLibraryGender.find((input) => input.checked)?.value || 'all',
  }
}

function filterModelLibraryItems(items, filters = {}) {
  const age = filters.age || 'all'
  const gender = filters.gender || 'all'
  return items.filter((item) =>
    (age === 'all' || item.age === age) &&
    (gender === 'all' || item.gender === gender),
  )
}

function createModelLibraryFileName(entry) {
  const extension = entry.src.split('.').pop() || 'png'
  return `model-library-${entry.id}.${extension}`
}

function createModelLibraryUploadDescriptor(entry, dataUrl) {
  return {
    name: createModelLibraryFileName(entry),
    mime: splitDataUrl(dataUrl)?.mime || (entry.src.endsWith('.png') ? 'image/png' : 'image/jpeg'),
    dataUrl,
    libraryId: entry.id,
    label: entry.label,
    age: entry.age,
    gender: entry.gender,
  }
}

function renderModelLibraryDialog() {
  if (!dom.oModelLibraryGrid) return
  const visibleItems = filterModelLibraryItems(MODEL_LIBRARY_ITEMS, getModelLibraryFilters())
  if (dom.oModelLibraryCount) dom.oModelLibraryCount.textContent = String(visibleItems.length)
  if (dom.oModelLibraryConfirm) {
    dom.oModelLibraryConfirm.disabled = isOutfitBusy() || modelLibrarySelectedIds.size === 0
    dom.oModelLibraryConfirm.textContent = modelLibrarySelectedIds.size
      ? `加入 ${modelLibrarySelectedIds.size} 个模特`
      : '加入模特列表'
  }

  dom.oModelLibraryGrid.replaceChildren(...visibleItems.map((item) => {
    const card = document.createElement('label')
    card.className = 'model-library-card'

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.value = item.id
    input.checked = modelLibrarySelectedIds.has(item.id)
    input.addEventListener('change', () => {
      if (input.checked) modelLibrarySelectedIds.add(item.id)
      else modelLibrarySelectedIds.delete(item.id)
      renderModelLibraryDialog()
    })
    card.append(input)

    const image = document.createElement('img')
    image.src = item.src
    image.alt = item.label
    image.loading = 'lazy'
    card.append(image)

    const meta = document.createElement('span')
    meta.className = 'model-library-meta'
    const title = document.createElement('strong')
    title.textContent = item.label
    const tags = document.createElement('span')
    tags.textContent = `${item.ageLabel} · ${item.genderLabel}`
    meta.append(title, tags)
    card.append(meta)

    return card
  }))
}

function openModelLibraryDialog() {
  modelLibrarySelectedIds = new Set()
  if (dom.oModelLibraryStatus) dom.oModelLibraryStatus.textContent = ''
  renderModelLibraryDialog()
  dom.oModelLibraryDialog?.showModal()
}

async function fetchModelLibraryDescriptor(entry) {
  const response = await fetch(entry.src)
  if (!response.ok) throw new Error(`无法读取模特库图片：${entry.label}`)
  const blob = await response.blob()
  const dataUrl = await readAsDataUrl(blobToNamedFile(blob, createModelLibraryFileName(entry)))
  return createModelLibraryUploadDescriptor(entry, dataUrl.dataUrl)
}

function blobToNamedFile(blob, name) {
  if (typeof File === 'function') return new File([blob], name, { type: blob.type || 'image/png' })
  blob.name = name
  return blob
}

async function uploadModelLibraryEntry(entry, { current, total }) {
  const descriptor = await fetchModelLibraryDescriptor(entry)
  if (dom.oModelLibraryStatus) dom.oModelLibraryStatus.textContent = `正在加入 ${current}/${total} · ${entry.label}`
  const data = await postJson('/api/assets/upload', {
    sessionId: state.runtime.sessionId || undefined,
    kind: 'upload',
    source: 'model_library',
    filename: descriptor.name,
    mime: descriptor.mime,
    dataUrl: descriptor.dataUrl,
  })
  state.runtime.sessionId = data.sessionId || state.runtime.sessionId
  const size = await getImageDimensions(descriptor.dataUrl).catch(() => null)
  return {
    id: data.asset.id,
    assetId: data.asset.id,
    name: descriptor.name,
    mime: data.asset.mime || descriptor.mime,
    base64: splitDataUrl(descriptor.dataUrl)?.base64 || '',
    dataUrl: descriptor.dataUrl,
    width: size?.width || 0,
    height: size?.height || 0,
    label: descriptor.label,
    role: '',
    instructions: '',
    libraryId: descriptor.libraryId,
    age: descriptor.age,
    gender: descriptor.gender,
  }
}

async function addSelectedModelLibraryItems() {
  if (isOutfitBusy() || modelLibrarySelectedIds.size === 0) return
  const selectedItems = MODEL_LIBRARY_ITEMS.filter((item) => modelLibrarySelectedIds.has(item.id))
  if (selectedItems.length === 0) return

  resetLoadedWorkspaceForDraft('outfit')
  setJobTab('outfit', 'current')
  if (dom.oModelLibraryConfirm) dom.oModelLibraryConfirm.disabled = true
  state.outfit.progress = '正在加入模特库图片…'
  renderOutfit()

  try {
    const uploaded = []
    for (const [index, item] of selectedItems.entries()) {
      uploaded.push(await uploadModelLibraryEntry(item, {
        current: index + 1,
        total: selectedItems.length,
      }))
    }
    state.outfit.models.push(...uploaded)
    pruneOutfitResults()
    state.outfit.progress = ''
    modelLibrarySelectedIds = new Set()
    saveRuntimeState()
    renderOutfit()
    dom.oModelLibraryDialog?.close()
  } catch (error) {
    const message = trimError(error)
    if (dom.oModelLibraryStatus) dom.oModelLibraryStatus.textContent = message
    state.outfit.progress = message
    renderOutfit()
  } finally {
    renderModelLibraryDialog()
  }
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

      const instructionInput = document.createElement('input')
      instructionInput.type = 'text'
      instructionInput.className = 'lane-instruction-input'
      instructionInput.placeholder = '这个款的特殊要求…'
      instructionInput.value = item.instructions || ''
      instructionInput.disabled = busy
      instructionInput.setAttribute('aria-label', `${basename(item.name)} 的额外要求`)
      instructionInput.addEventListener('input', () => {
        item.instructions = instructionInput.value.slice(0, 800)
        saveRuntimeState()
      })
      instructionInput.addEventListener('change', () => {
        item.instructions = normalizeGarmentInstructions(instructionInput.value)
        saveRuntimeState()
        renderOutfit()
      })
      node.append(instructionInput)
    }

    const caption = document.createElement('div')
    caption.className = 'lane-name'
    caption.textContent = item.label || basename(item.name)
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
    upsertJobTask('translate', data.jobId, {
      type: 'translate_batch',
      status: 'queued',
      progress: data.itemCount ? `0 / ${data.itemCount}` : '排队中…',
      label: `刚刚 · ${state.translate.items.length} 张 × ${state.translate.targets.length} 语种`,
      loaded: true,
      thumbs: getJobTaskThumbsFromWorkspace('translate'),
      itemCount: Number(data.itemCount || 0),
      progressTotal: Number(data.itemCount || 0),
    })
    markJobTaskLoaded('translate', data.jobId)
    setJobTab('translate', 'current')
    state.translate.running = false
    state.translate.progress = '任务已提交，可继续上传新图片'
    saveRuntimeState()
    renderTranslate()
    void syncTranslateJob(data.jobId, { applyToWorkspace: true })
  } catch (error) {
    state.translate.running = false
    state.translate.progress = trimError(error)
    renderTranslate()
  }
}

async function runOutfitBatch() {
  normalizeOutfitGarmentInstructions()
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
        instructions: normalizeGarmentInstructions(item.instructions),
      })),
      modelId: runConfig.modelId,
      concurrency: state.outfit.concurrency,
      clientKeys: runConfig.clientKeys,
    })

    state.runtime.sessionId = data.sessionId || state.runtime.sessionId
    upsertJobTask('outfit', data.jobId, {
      type: 'outfit_batch',
      status: 'queued',
      progress: data.itemCount ? `0 / ${data.itemCount}` : '排队中…',
      label: `刚刚 · ${data.lookCount || looks.length} 套搭配`,
      loaded: true,
      thumbs: getJobTaskThumbsFromWorkspace('outfit'),
      itemCount: Number(data.itemCount || 0),
      progressTotal: Number(data.itemCount || 0),
    })
    markJobTaskLoaded('outfit', data.jobId)
    setJobTab('outfit', 'current')
    state.outfit.running = false
    state.outfit.progress = '任务已提交，可继续上传新图片'
    saveRuntimeState()
    renderOutfit()
    void syncOutfitJob(data.jobId, { applyToWorkspace: true })
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
    garmentFingerprint: getOutfitGarmentFingerprint(),
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
          instructions: normalizeGarmentInstructions(garment.instructions),
        })),
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
  if (!canRetryTranslateItem()) return
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
    await syncTranslateJob(state.translate.jobId, { applyToWorkspace: true })
    state.translate.running = false
  } catch (error) {
    state.translate.running = false
    state.translate.progress = trimError(error)
    renderTranslate()
  }
}

async function retryOutfitJob(modelId, lookId) {
  if (!canRetryOutfitItem()) return
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
    await syncOutfitJob(state.outfit.jobId, { applyToWorkspace: true })
    state.outfit.running = false
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

function hasTranslateActiveItems() {
  return state.translate.items.some((item) =>
    Object.values(item.results).some((result) => result?.status === 'queue' || result?.status === 'running'),
  )
}

function hasOutfitActiveItems() {
  return Object.values(state.outfit.results).some((result) =>
    result?.status === 'queue' || result?.status === 'running',
  )
}

function isTranslateBusy() {
  return state.translate.running
}

function isOutfitBusy() {
  return state.outfit.running
}

function canRetryTranslateItem() {
  return Boolean(state.translate.jobId) && !hasTranslateActiveItems()
}

function canRetryOutfitItem() {
  return Boolean(state.outfit.jobId) && !hasOutfitActiveItems()
}

function getRunningLabel(base, attempt = 1) {
  return attempt > 1 ? `${base} · 自动补偿第 ${attempt - 1} 次` : base
}

function getFailureLabel(base, attempts = 1) {
  return attempts > 1 ? `${base} · 已自动补偿 ${attempts - 1} 次` : base
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

  if (result.status === 'cancelled') {
    cell.append(createStatusLine('已结束'))
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
    retry.disabled = !canRetryTranslateItem()
    if (retry.disabled) retry.title = '当前批量任务结束后可重试'
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

  if (result.status === 'cancelled') {
    cell.append(createStatusLine('已结束'))
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
    retry.disabled = !canRetryOutfitItem()
    if (retry.disabled) retry.title = '当前批量任务结束后可重试'
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
  } else if (state.activeView === 'auth') {
    renderAccount()
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

async function prepareAssetItems(fileList, { kind = 'upload', source = 'browser_upload', onProgress = null } = {}) {
  const images = await readImageFiles(fileList)
  const uploaded = []

  for (const [index, image] of images.entries()) {
    onProgress?.({
      current: index + 1,
      total: images.length,
      filename: image.name,
    })
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
      instructions: '',
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

async function hydrateAssetItems(items, projectId = '') {
  const hydrated = await Promise.all(items.map(async (item) => {
    try {
      const projectParam = projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''
      const data = await getJson(`/api/assets/${encodeURIComponent(item.assetId || item.id)}?includeData=1${projectParam}`)
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

async function hydrateAiMessages(messages) {
  const assetRefs = []
  for (const msg of messages) {
    if (msg.imageAssetId && !msg.imageDataUrl) {
      assetRefs.push({
        id: msg.imageAssetId,
        assetId: msg.imageAssetId,
        name: msg.imageName || msg.imageAssetId,
        mime: msg.imageMime || 'image/png',
      })
    }
    for (const ref of msg.refs || []) {
      if (ref.assetId && !ref.dataUrl) {
        assetRefs.push({
          id: ref.assetId,
          assetId: ref.assetId,
          name: ref.name || ref.assetId,
          mime: ref.mime || 'image/png',
        })
      }
    }
  }

  if (!assetRefs.length) return messages
  const hydrated = await hydrateAssetItems(assetRefs, state.generate.projectId)
  const byAssetId = new Map(hydrated.map((item) => [item.assetId || item.id, item]))

  return messages.map((msg) => {
    const next = { ...msg }
    if (next.imageAssetId && !next.imageDataUrl) {
      const image = byAssetId.get(next.imageAssetId)
      if (image?.dataUrl) {
        next.imageDataUrl = image.dataUrl
        next.imageMime = image.mime || next.imageMime
        next.imageName = next.imageName || image.name
      }
    }
    next.refs = (next.refs || []).map((ref) => {
      if (!ref.assetId || ref.dataUrl) return ref
      const image = byAssetId.get(ref.assetId)
      return image?.dataUrl
        ? { ...ref, dataUrl: image.dataUrl, mime: image.mime || ref.mime, name: ref.name || image.name }
        : ref
    })
    return next
  })
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
  state.generate.projectMetadata = {}
  state.generate.projectSaveStatus = ''
  canvasLastSavedSignature = ''
  state.generate.elements = []
  const aiSession = createAiSessionRecord()
  state.generate.aiSessionId = aiSession.id
  state.generate.aiSessions = [aiSession]
  state.generate.aiMessages = []
  state.generate.aiRefs = []
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
    state.generate.projectMetadata = getProjectMetadata(snapshot.project)
    state.generate.elements = await hydrateCanvasElements(snapshot.elements || [])
    state.generate.aiSessions = resolveCanvasAiSessions(snapshot.project, projectId)
    ensureCurrentAiSession()
    state.generate.aiMessages = await hydrateAiMessages(resolveCanvasAiHistory(snapshot.project, projectId))
    persistCurrentAiSession()
    canvasLastSavedSignature = getCanvasProjectSaveSignature(createCanvasProjectSaveSnapshot())
    state.generate.aiRefs = []
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

function openProjectDeleteDialog(projectId) {
  const project = state.projects.items.find((item) => item.id === projectId)
  if (!project || !dom.projectDeleteDialog) return
  if (!canDeleteProject(project)) {
    state.projects.error = '只有项目 owner 可以删除画布'
    renderProjects()
    return
  }
  state.projects.deleteTargetId = project.id
  state.projects.deleteStatus = ''
  renderProjectDeleteDialog()
  if (!dom.projectDeleteDialog.open) dom.projectDeleteDialog.showModal()
}

function renderProjectDeleteDialog() {
  if (!dom.projectDeleteDialog) return
  const project = state.projects.items.find((item) => item.id === state.projects.deleteTargetId)
  const title = project?.title || DEFAULT_CANVAS_PROJECT_TITLE
  const count = Number(project?.elementCount || 0)
  dom.projectDeleteTitle.textContent = title
  dom.projectDeleteMeta.textContent = project
    ? `${formatRelativeTime(project.updatedAt)} · ${count} 个元素`
    : ''
  dom.projectDeleteConfirm.disabled = state.projects.deleting || !project
  dom.projectDeleteStatus.textContent = state.projects.deleteStatus || ''
  dom.projectDeleteStatus.classList.toggle('err', Boolean(state.projects.deleteStatus && !state.projects.deleting))
  dom.projectDeleteStatus.classList.toggle('run', state.projects.deleting)
}

async function deleteCanvasProjectFromDialog() {
  const projectId = state.projects.deleteTargetId
  if (!projectId || state.projects.deleting) return
  const project = state.projects.items.find((item) => item.id === projectId)
  if (!project || !canDeleteProject(project)) return

  state.projects.deleting = true
  state.projects.deleteStatus = '正在删除画布…'
  renderProjectDeleteDialog()

  try {
    const sessionParam = state.runtime.sessionId
      ? `?sessionId=${encodeURIComponent(state.runtime.sessionId)}`
      : ''
    await deleteJson(`/api/canvas/projects/${encodeURIComponent(projectId)}${sessionParam}`)
    state.projects.items = state.projects.items.filter((item) => item.id !== projectId)
    state.projects.loadedSessionId = ''
    state.projects.error = ''
    if (state.generate.projectId === projectId) {
      state.generate.projectId = ''
      state.generate.projectTitle = DEFAULT_CANVAS_PROJECT_TITLE
      state.generate.projectMetadata = {}
      canvasLastSavedSignature = ''
      state.generate.elements = []
      state.generate.aiSessionId = ''
      state.generate.aiSessions = []
      state.generate.aiMessages = []
      state.generate.aiRefs = []
      state.generate.selectedIds = []
      state.generate.projectSaveStatus = ''
      saveRuntimeState({ persistCanvas: false })
    }
    dom.projectDeleteDialog?.close()
    state.projects.deleteTargetId = ''
    state.projects.deleteStatus = ''
    renderProjects()
    renderHome()
  } catch (error) {
    state.projects.deleteStatus = trimError(error)
    renderProjectDeleteDialog()
  } finally {
    state.projects.deleting = false
    renderProjectDeleteDialog()
  }
}

async function openShareDialog(projectId) {
  if (!projectId) {
    await ensureCanvasProjectRecord()
    projectId = state.generate.projectId
  }
  if (!projectId) return
  if (!state.account.user) {
    state.account.status = '请先登录后再共享项目'
    renderAccount()
    showAuthView()
    return
  }
  state.share.status = ''
  state.share.loading = true
  renderShareDialog(projectId)
  if (!dom.shareDialog.open) dom.shareDialog.showModal()
  try {
    await loadProjectMembers(projectId)
  } catch (error) {
    state.share.status = trimError(error)
  } finally {
    state.share.loading = false
    renderShareDialog(projectId)
  }
}

async function loadProjectMembers(projectId = state.generate.projectId) {
  const data = await getJson(`/api/canvas/projects/${encodeURIComponent(projectId)}/members`)
  state.share.members = Array.isArray(data.members) ? data.members : []
  state.share.invites = Array.isArray(data.invites) ? data.invites : []
  state.share.owner = data.owner || null
  state.share.role = data.role || ''
}

async function inviteProjectMember() {
  const projectId = state.generate.projectId || dom.shareDialog?.dataset.projectId || ''
  if (!projectId) return
  const email = dom.shareEmail.value.trim()
  const role = dom.shareRole.value
  state.share.loading = true
  state.share.status = '正在邀请…'
  renderShareDialog(projectId)
  try {
    const data = await postJson(`/api/canvas/projects/${encodeURIComponent(projectId)}/members`, { email, role })
    state.share.status = data.inviteUrl
      ? `邀请已创建：${data.inviteUrl}`
      : '成员已加入项目'
    dom.shareEmail.value = ''
    await loadProjectMembers(projectId)
    state.projects.loadedSessionId = ''
  } catch (error) {
    state.share.status = trimError(error)
  } finally {
    state.share.loading = false
    renderShareDialog(projectId)
  }
}

async function updateProjectMemberRole(userId, role) {
  const projectId = dom.shareDialog?.dataset.projectId || state.generate.projectId || ''
  if (!projectId || !userId) return
  state.share.loading = true
  state.share.status = '正在更新权限…'
  renderShareDialog(projectId)
  try {
    await putJson(`/api/canvas/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, { role })
    state.share.status = '成员权限已更新'
    await loadProjectMembers(projectId)
    state.projects.loadedSessionId = ''
  } catch (error) {
    state.share.status = trimError(error)
  } finally {
    state.share.loading = false
    renderShareDialog(projectId)
  }
}

async function removeProjectMemberFromProject(userId) {
  const projectId = dom.shareDialog?.dataset.projectId || state.generate.projectId || ''
  if (!projectId || !userId) return
  state.share.loading = true
  state.share.status = '正在移除成员…'
  renderShareDialog(projectId)
  try {
    await deleteJson(`/api/canvas/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`)
    state.share.status = '成员已移除'
    await loadProjectMembers(projectId)
    state.projects.loadedSessionId = ''
  } catch (error) {
    state.share.status = trimError(error)
  } finally {
    state.share.loading = false
    renderShareDialog(projectId)
  }
}

function renderShareDialog(projectId = state.generate.projectId) {
  if (!dom.shareDialog) return
  dom.shareDialog.dataset.projectId = projectId || ''
  const canManage = state.share.role === 'owner'
  dom.shareHint.textContent = state.account.user
    ? canManage
      ? '邀请成员查看或编辑当前画布项目。'
      : '你可以查看当前项目成员，只有 owner 可以邀请或修改成员。'
    : '请先登录后再共享项目。'
  dom.shareEmail.disabled = !canManage || state.share.loading
  dom.shareRole.disabled = !canManage || state.share.loading
  dom.shareInvite.disabled = !canManage || state.share.loading
  dom.shareStatus.textContent = state.share.status || ''
  dom.shareStatus.classList.toggle('err', Boolean(state.share.status && /失败|错误|required|permission|access|登录|有效/.test(state.share.status)))
  const rows = []
  if (state.share.owner) {
    rows.push(createShareMemberRow({
      label: state.share.owner.name || state.share.owner.email,
      sub: state.share.owner.email,
      role: 'owner',
      fixed: true,
    }))
  }
  for (const member of state.share.members) {
    rows.push(createShareMemberRow({
      label: member.user?.name || member.user?.email || member.userId,
      sub: member.user?.email || member.userId,
      role: member.role,
      fixed: !canManage,
      userId: member.userId,
    }))
  }
  for (const invite of state.share.invites) {
    rows.push(createShareMemberRow({
      label: invite.email,
      sub: '待接受邀请',
      role: invite.role,
      fixed: true,
    }))
  }
  if (!rows.length) {
    const empty = document.createElement('div')
    empty.className = 'share-empty'
    empty.textContent = state.share.loading ? '正在读取成员…' : '还没有成员'
    rows.push(empty)
  }
  dom.shareMembers.replaceChildren(...rows)
}

function createShareMemberRow({ label, sub, role, fixed, userId }) {
  const row = document.createElement('div')
  row.className = 'share-member-row'
  const meta = document.createElement('div')
  const strong = document.createElement('strong')
  strong.textContent = label
  const span = document.createElement('span')
  span.textContent = sub
  meta.append(strong, span)
  const badge = document.createElement('span')
  badge.className = `role-badge role-${role}`
  badge.textContent = role
  row.append(meta, badge)
  if (fixed || !userId) {
    row.classList.add('fixed')
    return row
  }

  const actions = document.createElement('div')
  actions.className = 'share-member-actions'
  const roleSelect = document.createElement('select')
  roleSelect.disabled = state.share.loading
  for (const option of ['viewer', 'editor']) {
    const item = document.createElement('option')
    item.value = option
    item.textContent = option
    roleSelect.append(item)
  }
  roleSelect.value = role === 'editor' ? 'editor' : 'viewer'
  roleSelect.addEventListener('change', () => {
    void updateProjectMemberRole(userId, roleSelect.value)
  })

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'ghost compact'
  remove.disabled = state.share.loading
  remove.textContent = '移除'
  remove.addEventListener('click', () => {
    void removeProjectMemberFromProject(userId)
  })
  actions.append(roleSelect, remove)
  row.append(actions)
  return row
}

async function loadCanvasProjects({ force = false } = {}) {
  if (!dom.pList) return
  const sessionId = state.runtime.sessionId || ''
  if (!sessionId && !state.account.user) {
    state.projects.items = []
    state.projects.loading = false
    state.projects.loadedSessionId = ''
    state.projects.error = ''
    renderProjects()
    renderHome()
    return
  }
  const loadKey = `${state.account.user?.id || sessionId || 'anon'}:${state.projects.filterShared ? 'shared' : 'all'}`
  if (!force && state.projects.loadedSessionId === loadKey && state.projects.items.length) {
    renderProjects()
    renderHome()
    return
  }

  state.projects.loading = true
  state.projects.error = ''
  renderProjects()
  renderHome()

  try {
    const data = state.projects.filterShared && state.account.user
      ? await getJson('/api/canvas/projects/shared')
      : await getJson(`/api/canvas/projects?sessionId=${encodeURIComponent(sessionId)}`)
    const projects = Array.isArray(data.projects) ? data.projects : []
    const enriched = await Promise.all(projects.map(enrichCanvasProjectCard))
    state.projects.items = enriched.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    state.projects.loadedSessionId = loadKey
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
      previewUrl: firstImage?.content || (firstImage?.assetId ? assetResultUrl(firstImage.assetId, project.id) : ''),
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
  }, CANVAS_SAVE_DEBOUNCE_MS)
}

function createCanvasProjectSaveSnapshot() {
  return {
    title: state.generate.projectTitle || DEFAULT_CANVAS_PROJECT_TITLE,
    metadataJson: {
      ...state.generate.projectMetadata,
      aiSessionId: state.generate.aiSessionId || '',
      aiSessions: serializeAiSessions(state.generate.aiSessions),
      aiMessages: getSerializedAiHistory(),
    },
    elements: state.generate.elements.map((el) => serializeCanvasElement(el)),
  }
}

function getCanvasProjectSaveSignature(snapshot) {
  try {
    return JSON.stringify(snapshot)
  } catch {
    return ''
  }
}

async function ensureCanvasProjectRecord() {
  if (state.generate.projectId) return state.generate.projectId
  if (canvasProjectCreateInFlight) return canvasProjectCreateInFlight

  canvasProjectCreateInFlight = (async () => {
    const data = await postJson('/api/canvas/projects', {
      sessionId: state.runtime.sessionId || undefined,
      title: state.generate.projectTitle || DEFAULT_CANVAS_PROJECT_TITLE,
      metadataJson: {
        ...state.generate.projectMetadata,
        aiSessionId: state.generate.aiSessionId || '',
        aiSessions: serializeAiSessions(state.generate.aiSessions),
        aiMessages: getSerializedAiHistory(),
      },
    })
    state.runtime.sessionId = data.sessionId || state.runtime.sessionId
    state.generate.projectId = data.project?.id || ''
    state.generate.projectTitle = data.project?.title || state.generate.projectTitle || DEFAULT_CANVAS_PROJECT_TITLE
    state.generate.projectMetadata = getProjectMetadata(data.project)
    canvasLastSavedSignature = ''
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
  const snapshot = createCanvasProjectSaveSnapshot()
  const signature = getCanvasProjectSaveSignature(snapshot)
  if (signature && signature === canvasLastSavedSignature && state.generate.projectSaveStatus === 'saved') return null

  canvasSaveInFlight = (async () => {
    state.generate.projectSaveStatus = 'saving'
    renderCanvasProjectMeta()
    try {
      await ensureCanvasProjectRecord()
      if (!state.generate.projectId) throw new Error('Canvas project id missing')
      const projectUrl = `/api/canvas/projects/${encodeURIComponent(state.generate.projectId)}`
      const projectBody = {
        sessionId: state.runtime.sessionId || undefined,
        title: snapshot.title,
        metadataJson: snapshot.metadataJson,
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
        elements: snapshot.elements,
      })
      canvasLastSavedSignature = signature || getCanvasProjectSaveSignature(snapshot)
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
  })), state.generate.projectId)
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
  const savedResults = loadResultsStore()
  const routeProjectId = state.activeView === 'generate' ? canvasProjectIdFromLocation() : ''
  state.runtime.sessionId = runtime.sessionId
  state.translate.jobs = runtime.translate.jobs
  state.translate.jobId = getLoadedStoredJobId(runtime.translate.jobs)
  state.translate.jobTab = runtime.translate.jobTab
  state.translate.jobPage = runtime.translate.jobPage
  state.generate.projectId = routeProjectId || runtime.generate.projectId || ''
  state.generate.projectTitle = runtime.generate.projectTitle || DEFAULT_CANVAS_PROJECT_TITLE
  state.generate.aiSessionId = runtime.generate.aiSessionId || ''
  state.generate.aiSessions = runtime.generate.aiSessions || []
  let canvasElements = runtime.generate.elements || []
  if (state.generate.projectId) {
    try {
      const snapshot = await loadCanvasProjectSnapshot(state.generate.projectId)
      if (snapshot) {
        state.generate.projectTitle = snapshot.project?.title || state.generate.projectTitle
        state.generate.projectMetadata = getProjectMetadata(snapshot.project)
        canvasElements = snapshot.elements
        state.generate.projectSaveStatus = 'saved'
      }
    } catch {
      state.generate.projectSaveStatus = 'local'
    }
  }
  state.generate.elements = await hydrateCanvasElements(canvasElements)
  const aiHistory = resolveCanvasAiHistory(
    { metadataJson: state.generate.projectMetadata },
    state.generate.projectId,
    runtime.generate.aiMessages,
  )
  state.generate.aiSessions = resolveCanvasAiSessions(
    { metadataJson: state.generate.projectMetadata },
    state.generate.projectId,
    state.generate.aiSessions,
    runtime.generate.aiMessages,
  )
  ensureCurrentAiSession()
  if (aiHistory.length) state.generate.aiMessages = await hydrateAiMessages(aiHistory)
  persistCurrentAiSession()
  canvasLastSavedSignature = state.generate.projectSaveStatus === 'saved'
    ? getCanvasProjectSaveSignature(createCanvasProjectSaveSnapshot())
    : ''
  state.generate.scale = runtime.generate.scale || 1
  state.generate.panX = runtime.generate.panX || 0
  state.generate.panY = runtime.generate.panY || 0
  state.outfit.jobs = runtime.outfit.jobs
  state.outfit.jobId = getLoadedStoredJobId(runtime.outfit.jobs)
  state.outfit.jobTab = runtime.outfit.jobTab
  state.outfit.jobPage = runtime.outfit.jobPage

  const [translateItems, outfitModels, outfitGarments] = await Promise.all([
    hydrateAssetItems(runtime.translate.items),
    hydrateAssetItems(runtime.outfit.models),
    hydrateAssetItems(runtime.outfit.garments),
  ])

  state.translate.items = translateItems.map((item) => ({ ...item, results: {} }))
  state.outfit.models = outfitModels
  state.outfit.garments = outfitGarments.map((item) => ({
    ...item,
    role: item.role || 'full_outfit',
    instructions: normalizeGarmentInstructions(item.instructions),
  }))

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
  state.style.history = await hydrateStyleHistory(getStoredStyleHistory(savedResults, runtime.style?.history))

  restoringRuntimeState = false
  runtimeStateReady = true
  saveRuntimeState({ persistCanvas: false })
  renderAll()
  if (state.activeView === 'home' || state.activeView === 'projects') {
    void loadCanvasProjects()
  }

  watchStoredJobTasks('translate')
  watchStoredJobTasks('outfit')
}

function assetResultUrl(assetId, projectId = '') {
  const projectParam = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return `/api/results/${encodeURIComponent(assetId)}${projectParam}`
}

function formatBatchProgress(job) {
  const total = Number(job?.progressTotal || 0)
  const done = Number(job?.progressDone || 0)
  const failed = Number(job?.progressFailed || 0)
  const finished = done + failed

  if (job?.status === 'queued') return total ? `0 / ${total}` : '排队中…'
  if (job?.status === 'running') return `${finished} / ${total}${failed ? ` · 失败 ${failed}` : ''}`
  if (job?.status === 'paused') return `${finished} / ${total}${failed ? ` · 失败 ${failed}` : ''} · 已暂停`
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
  const garmentFingerprint = String(job?.configJson?.garmentFingerprint || '').trim()
  if (garmentFingerprint) {
    return getOutfitSignature({
      modelId: String(job?.configJson?.modelId || state.outfit.model),
      garmentFingerprint,
    })
  }

  const garmentParts = [
    ...(Array.isArray(job?.configJson?.garmentRoles) ? job.configJson.garmentRoles : []),
    ...(Array.isArray(job?.configJson?.garmentInstructions) ? job.configJson.garmentInstructions : []),
    String(job?.configJson?.instructions || ''),
  ].filter(Boolean)
  return getOutfitSignature({
    modelId: String(job?.configJson?.modelId || state.outfit.model),
    garmentFingerprint: garmentParts.length ? garmentParts.sort().join('|') : getOutfitGarmentFingerprint(),
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

  if (item.status === 'cancelled') {
    return {
      status: 'cancelled',
      signature,
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

async function hydrateTranslateWorkspaceFromJob(job, items) {
  const existing = new Map(state.translate.items.map((item) => [item.assetId || item.id, item]))
  const assetIds = unique(items.map((item) => String(item.inputJson?.assetId || '')).filter(Boolean))
  const missing = assetIds
    .filter((assetId) => !existing.has(assetId))
    .map((assetId) => ({ id: assetId, assetId, name: assetId, mime: 'image/png' }))
  const hydrated = await hydrateAssetItems(missing)
  state.translate.items = [
    ...state.translate.items.filter((item) => assetIds.includes(item.assetId || item.id)),
    ...hydrated.map((item) => ({ ...item, results: {} })),
  ].map((item) => ({ ...item, results: item.results || {} }))

  const targets = Array.isArray(job?.configJson?.targetLanguages)
    ? job.configJson.targetLanguages.map(String).filter((code) => TARGET_LANGUAGES.some((lang) => lang.code === code))
    : []
  if (targets.length) state.translate.targets = unique(targets)
  state.translate.source = getLanguage(job?.configJson?.sourceLanguage)?.code || 'auto'
  state.translate.model = getModel(job?.configJson?.modelId)?.id || state.translate.model
  state.translate.preserveBrand = job?.configJson?.preserveBrand !== false
  state.translate.concurrency = clamp(Number(job?.configJson?.concurrency) || state.translate.concurrency, 1, 6)
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

  state.translate.progress = formatBatchProgress(job)
  renderTranslate()
}

async function fetchJobSnapshot(jobId) {
  const [{ job }, { items }] = await Promise.all([
    getJson(`/api/jobs/${encodeURIComponent(jobId)}`),
    getJson(`/api/jobs/${encodeURIComponent(jobId)}/items`),
  ])
  return { job, items }
}

function watchStoredJobTasks(kind) {
  for (const task of getJobTasks(kind)) {
    if (!task.jobId) continue
    if (task.status && !ACTIVE_JOB_STATUSES.has(task.status)) {
      continue
    }
    if (kind === 'translate') {
      void syncTranslateJob(task.jobId, { passive404: true })
    } else {
      void syncOutfitJob(task.jobId, { passive404: true })
    }
  }
}

async function syncTranslateJob(jobId, { passive404 = false, applyToWorkspace = false } = {}) {
  const token = ++translateWatcherToken
  translateJobWatchers.set(jobId, token)

  while (translateJobWatchers.get(jobId) === token) {
    try {
      const { job, items } = await fetchJobSnapshot(jobId)
      if (job?.type && job.type !== 'translate_batch') {
        removeJobTask('translate', jobId)
        saveRuntimeState()
        renderTranslate()
        return
      }

      const shouldApply = applyToWorkspace || getLoadedJobId('translate') === jobId
      upsertJobTask('translate', jobId, { job, items, loaded: shouldApply })
      if (shouldApply) {
        if (getLoadedJobId('translate') !== jobId) {
          renderJobList('translate')
          saveRuntimeState()
          if (TERMINAL_JOB_STATUSES.has(job.status) || job.status === 'paused') {
            translateJobWatchers.delete(jobId)
            break
          }
          await wait(900)
          continue
        }
        applyTranslateJobSnapshot(job, items)
      } else {
        renderTranslate()
      }
      saveRuntimeState()

      if (TERMINAL_JOB_STATUSES.has(job.status) || job.status === 'paused') {
        translateJobWatchers.delete(jobId)
        break
      }

      await wait(900)
    } catch (error) {
      const status = Number(error?.status || 0)
      if (status === 404 || status === 403) {
        const wasLoaded = getLoadedJobId('translate') === jobId
        removeJobTask('translate', jobId)
        if (!passive404 && wasLoaded) {
          state.translate.progress = status === 403 ? '任务无权限访问，已从列表移除' : '任务记录已失效，请重新提交'
        }
        saveRuntimeState()
        renderTranslate()
        return
      }

      const task = upsertJobTask('translate', jobId, { error: trimError(error) })
      if (getLoadedJobId('translate') === jobId) state.translate.progress = task.error
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

  if (item.status === 'cancelled') {
    return {
      status: 'cancelled',
      signature,
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

async function hydrateOutfitWorkspaceFromJob(job, items) {
  const modelIds = unique(items.map((item) => String(item.inputJson?.modelAssetId || '')).filter(Boolean))
  const garmentIds = unique(items.flatMap((item) =>
    Array.isArray(item.inputJson?.lookAssetIds) ? item.inputJson.lookAssetIds.map(String) : [],
  ).filter(Boolean))
  const garmentMeta = new Map()
  for (const item of items) {
    const assetIds = Array.isArray(item.inputJson?.lookAssetIds) ? item.inputJson.lookAssetIds.map(String) : []
    const roles = Array.isArray(item.inputJson?.lookRoles) ? item.inputJson.lookRoles.map(String) : []
    const labels = Array.isArray(item.inputJson?.lookLabels) ? item.inputJson.lookLabels.map(String) : []
    const instructions = Array.isArray(item.inputJson?.lookInstructions) ? item.inputJson.lookInstructions.map(String) : []
    assetIds.forEach((assetId, index) => {
      if (!garmentMeta.has(assetId)) {
        garmentMeta.set(assetId, {
          role: roles[index] || 'full_outfit',
          label: labels[index] || assetId,
          instructions: instructions[index] || '',
        })
      }
    })
  }

  const existingModels = new Map(state.outfit.models.map((item) => [item.assetId || item.id, item]))
  const existingGarments = new Map(state.outfit.garments.map((item) => [item.assetId || item.id, item]))
  const missingModels = modelIds
    .filter((assetId) => !existingModels.has(assetId))
    .map((assetId) => ({ id: assetId, assetId, name: assetId, mime: 'image/png' }))
  const missingGarments = garmentIds
    .filter((assetId) => !existingGarments.has(assetId))
    .map((assetId) => {
      const meta = garmentMeta.get(assetId) || {}
      return { id: assetId, assetId, name: meta.label || assetId, mime: 'image/png', ...meta }
    })

  const [hydratedModels, hydratedGarments] = await Promise.all([
    hydrateAssetItems(missingModels),
    hydrateAssetItems(missingGarments),
  ])
  state.outfit.models = [
    ...state.outfit.models.filter((item) => modelIds.includes(item.assetId || item.id)),
    ...hydratedModels,
  ]
  state.outfit.garments = [
    ...state.outfit.garments.filter((item) => garmentIds.includes(item.assetId || item.id)).map((item) => ({
      ...item,
      ...(garmentMeta.get(item.assetId || item.id) || {}),
    })),
    ...hydratedGarments.map((item) => ({
      ...item,
      role: item.role || garmentMeta.get(item.assetId || item.id)?.role || 'full_outfit',
      instructions: normalizeGarmentInstructions(item.instructions || garmentMeta.get(item.assetId || item.id)?.instructions),
    })),
  ]
  state.outfit.model = getModel(job?.configJson?.modelId)?.id || state.outfit.model
  state.outfit.concurrency = clamp(Number(job?.configJson?.concurrency) || state.outfit.concurrency, 1, 4)
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
  state.outfit.progress = formatBatchProgress(job)
  renderOutfit()
}

async function syncOutfitJob(jobId, { passive404 = false, applyToWorkspace = false } = {}) {
  const token = ++outfitWatcherToken
  outfitJobWatchers.set(jobId, token)

  while (outfitJobWatchers.get(jobId) === token) {
    try {
      const { job, items } = await fetchJobSnapshot(jobId)
      if (job?.type && job.type !== 'outfit_batch') {
        removeJobTask('outfit', jobId)
        saveRuntimeState()
        renderOutfit()
        return
      }

      const shouldApply = applyToWorkspace || getLoadedJobId('outfit') === jobId
      upsertJobTask('outfit', jobId, { job, items, loaded: shouldApply })
      if (shouldApply) {
        if (getLoadedJobId('outfit') !== jobId) {
          renderJobList('outfit')
          saveRuntimeState()
          if (TERMINAL_JOB_STATUSES.has(job.status) || job.status === 'paused') {
            outfitJobWatchers.delete(jobId)
            break
          }
          await wait(900)
          continue
        }
        applyOutfitJobSnapshot(job, items)
      } else {
        renderOutfit()
      }
      saveRuntimeState()

      if (TERMINAL_JOB_STATUSES.has(job.status) || job.status === 'paused') {
        outfitJobWatchers.delete(jobId)
        break
      }

      await wait(900)
    } catch (error) {
      const status = Number(error?.status || 0)
      if (status === 404 || status === 403) {
        const wasLoaded = getLoadedJobId('outfit') === jobId
        removeJobTask('outfit', jobId)
        if (!passive404 && wasLoaded) {
          state.outfit.progress = status === 403 ? '任务无权限访问，已从列表移除' : '任务记录已失效，请重新提交'
        }
        saveRuntimeState()
        renderOutfit()
        return
      }

      const task = upsertJobTask('outfit', jobId, { error: trimError(error) })
      if (getLoadedJobId('outfit') === jobId) state.outfit.progress = task.error
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
    throw createHttpError(response, data)
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
    throw createHttpError(response, data)
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
    throw createHttpError(response, data)
  }
  return data
}

async function deleteJson(url) {
  const response = await fetch(url, { method: 'DELETE' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw createHttpError(response, data)
  }
  return data
}

function createHttpError(response, payload = {}) {
  const error = new Error(payload?.error || `HTTP ${response.status}`)
  error.status = response.status
  error.payload = payload
  redirectToLoginForApi(error)
  return error
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
    throw createHttpError(response, payload.error ? payload : { error: text.trim() || undefined })
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
    throw createHttpError(response, data)
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

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
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

function hydrateSettingsForm({ preserveKeyInputs = false } = {}) {
  hydrateKeyForm({ preserveKeyInputs })
  hydrateThemeForm()
  renderSettingsAccountKeys()
}

function hydrateKeyForm({ preserveKeyInputs = false } = {}) {
  hydrateKeyInput('k-vision', 'visionApiKey', preserveKeyInputs)
  hydrateKeyInput('k-banana2', 'banana2ApiKey', preserveKeyInputs)
  hydrateKeyInput('k-bananapro', 'bananaProApiKey', preserveKeyInputs)
  hydrateKeyInput('k-gptimage', 'gptImageApiKey', preserveKeyInputs)
}

function hydrateKeyInput(id, keyName, preserveValue = false) {
  const input = $(`#${id}`)
  if (!input) return
  if (!preserveValue) input.value = state.keys[keyName] || ''
  const saved = state.account.apiKeys?.keys?.[keyName]
  input.placeholder = saved?.saved
    ? `已保存到账号${saved.last4 ? `（尾号 ${saved.last4}）` : ''}`
    : 'sk-...'
}

function renderSettingsAccountKeys() {
  if (!dom.settingsSaveAccount || !dom.settingsClearAccount || !dom.settingsAccountStatus) return
  const loggedIn = Boolean(state.account.user)
  dom.settingsSaveAccount.disabled = !loggedIn
  dom.settingsSaveAccount.checked = loggedIn
  dom.settingsClearAccount.disabled = !loggedIn || !hasSavedAccountKeys()

  if (!loggedIn) {
    setSettingsKeyStatus('登录后可将 API Keys 加密保存到账号')
    return
  }

  const saved = Object.values(state.account.apiKeys?.keys || {}).filter((item) => item?.saved)
  if (!saved.length) {
    setSettingsKeyStatus('账号尚未保存 API Keys')
    return
  }

  const details = saved
    .map((item) => `${item.label || 'Key'}${item.last4 ? ` · ${item.last4}` : ''}`)
    .join('；')
  const updated = state.account.apiKeys?.updatedAt
    ? `，更新于 ${formatTimestamp(state.account.apiKeys.updatedAt)}`
    : ''
  setSettingsKeyStatus(`账号已保存：${details}${updated}`)
}

function hasSavedAccountKeys() {
  return Object.values(state.account.apiKeys?.keys || {}).some((item) => item?.saved)
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
  return value === 'dark' ? 'dark' : 'light'
}

function applyTheme() {
  state.theme = normalizeTheme(state.theme)
  document.documentElement.dataset.theme = state.theme
}

function loadKeys() {
  return readJson(KEY_STORAGE, {})
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

function getCanvasImageSize(aspectRatio = '1:1', width, height) {
  const explicitWidth = Number(width)
  const explicitHeight = Number(height)
  if (Number.isFinite(explicitWidth) && explicitWidth > 0 && Number.isFinite(explicitHeight) && explicitHeight > 0) {
    return {
      width: Math.max(80, Math.round(explicitWidth / 2)),
      height: Math.max(80, Math.round(explicitHeight / 2)),
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
    garmentFingerprint: config.garmentFingerprint || '',
  })
}

function getOutfitGarmentFingerprint() {
  return state.outfit.garments
    .map((item) => `${item.id}:${item.role || 'full_outfit'}:${normalizeGarmentInstructions(item.instructions)}`)
    .sort()
    .join('|')
}

function normalizeOutfitGarmentInstructions() {
  for (const item of state.outfit.garments) {
    item.instructions = normalizeGarmentInstructions(item.instructions)
  }
}

function buildOutfitLooks() {
  const groups = {
    full_outfit: state.outfit.garments.filter((item) => (item.role || 'full_outfit') === 'full_outfit'),
    dress: state.outfit.garments.filter((item) => item.role === 'dress'),
    top: state.outfit.garments.filter((item) => item.role === 'top'),
    bottom: state.outfit.garments.filter((item) => item.role === 'bottom'),
    outerwear: state.outfit.garments.filter((item) => item.role === 'outerwear'),
    shoes: state.outfit.garments.filter((item) => item.role === 'shoes'),
    accessory: state.outfit.garments.filter((item) => item.role === 'accessory'),
  }

  let baseLooks = []
  let optionalOuterwear = groups.outerwear
  let optionalShoes = groups.shoes
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

  if (baseLooks.length === 0 && groups.shoes.length > 0) {
    baseLooks.push(...groups.shoes.map((item) => [item]))
    optionalShoes = []
  }

  if (baseLooks.length === 0 && groups.accessory.length > 0) {
    baseLooks.push(...groups.accessory.map((item) => [item]))
    optionalAccessory = []
  }

  let looks = [...baseLooks]

  if (optionalOuterwear.length > 0 && looks.length > 0) {
    looks = expandOutfitLooks(looks, optionalOuterwear)
  }

  if (optionalShoes.length > 0 && looks.length > 0) {
    looks = expandOutfitLooks(looks, optionalShoes)
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
  const index = ['full_outfit', 'dress', 'top', 'bottom', 'outerwear', 'shoes', 'accessory'].indexOf(role || 'full_outfit')
  return index === -1 ? 99 : index
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

function getStoredStyleHistory(store, fallbackHistory = []) {
  const saved = sanitizeStyleHistoryEntries(store?.style?.history)
  if (saved.length) return saved
  return sanitizeStyleHistoryEntries(fallbackHistory)
}

function saveStyleHistory() {
  const store = loadResultsStore()
  if (!store.style) store.style = { history: [] }
  store.style.history = serializeStyleHistoryEntries(state.style.history)
  saveResultsStore(store)
}

async function hydrateStyleHistory(entries) {
  const history = sanitizeStyleHistoryEntries(entries)
  const toHydrate = history
    .filter((entry) => entry.assetId && !entry.resultDataUrl)
    .map((entry) => ({
      id: entry.assetId,
      assetId: entry.assetId,
      name: entry.subject || entry.assetId,
      mime: entry.mime || 'image/png',
    }))

  if (!toHydrate.length) return history
  const hydrated = await hydrateAssetItems(toHydrate)
  const byAssetId = new Map(hydrated.map((item) => [item.assetId || item.id, item]))
  return history.filter((entry) => {
    if (entry.resultDataUrl) return true
    const asset = byAssetId.get(entry.assetId)
    if (!asset?.dataUrl) return false
    entry.resultDataUrl = asset.dataUrl
    entry.mime = asset.mime || entry.mime
    return true
  })
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
