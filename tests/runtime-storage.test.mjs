import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const APP_PATH = new URL('../public/app.js', import.meta.url)
const INDEX_PATH = new URL('../public/index.html', import.meta.url)

function extractStateInitializer(source) {
  const start = source.indexOf('const state = {')
  if (start === -1) throw new Error('Could not find state initializer')
  const bodyStart = source.indexOf('{', start)
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(bodyStart, index + 1)
  }
  throw new Error('Could not extract state initializer')
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) return ''
  const functionStart = source.slice(Math.max(0, start - 6), start) === 'async '
    ? start - 6
    : start
  const paramsEnd = source.indexOf(')', start)
  const bodyStart = source.indexOf('{', paramsEnd)
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(functionStart, index + 1)
  }
  throw new Error(`Could not extract function ${name}`)
}

async function createRuntimeHarness({ failLargeWrites = false } = {}) {
  const source = await readFile(APP_PATH, 'utf8')
  const writes = []
  const storage = new Map()
  let shouldFailLargeWrite = failLargeWrites
  let idCounter = 0
  const context = {
    RUNTIME_STORAGE: 'img-translator:runtime:v2',
    RESULTS_STORAGE: 'img-translator:results:v1',
    CANVAS_AI_HISTORY_STORAGE: 'img-translator:canvas-ai-history:v1',
    CANVAS_AI_HISTORY_PROJECT_PREFIX: 'img-translator:canvas-ai-history:v1:project:',
    DEFAULT_CANVAS_PROJECT_TITLE: '未命名画布',
    AI_HISTORY_LIMIT: 40,
    AI_HISTORY_INLINE_DATA_URL_LIMIT: 220_000,
    AI_STORED_SESSION_LIMIT: 8,
    AI_STORED_MESSAGE_LIMIT: 16,
    STYLE_HISTORY_LIMIT: 12,
    RUNTIME_FALLBACK_TASK_LIMIT: 8,
    RUNTIME_FALLBACK_ITEM_LIMIT: 24,
    RUNTIME_FALLBACK_ELEMENT_LIMIT: 80,
    RUNTIME_FALLBACK_SUBJECT_REF_LIMIT: 12,
    CANVAS_SAVE_DEBOUNCE_MS: 2200,
    CANVAS_SHAPES: new Set(['square', 'circle', 'triangle', 'message', 'arrow-left', 'arrow-right']),
    TRANSLATE_FONT_MODES: new Set(['match_original', 'reference']),
    DEFAULT_TRANSLATE_MODEL: 'gpt-image-2',
    DEFAULT_ASYNC_IMAGE_JOB_CONCURRENCY: 10,
    MAX_ASYNC_IMAGE_JOB_CONCURRENCY: 10,
    TRANSLATE_TEXT_COLOR_MODES: new Set(['match_original', 'custom']),
    KNOWN_JOB_STATUSES: new Set(['', 'queued', 'running', 'paused', 'completed', 'partial_failed', 'failed', 'cancelled']),
    ACTIVE_JOB_STATUSES: new Set(['queued', 'running']),
    DEFAULT_TRANSLATE_HEADLINE_COLOR: '#111827',
    DEFAULT_TRANSLATE_BODY_COLOR: '#374151',
    GARMENT_ROLE_OPTIONS: [
      { value: 'full_outfit' },
      { value: 'top' },
      { value: 'bottom' },
      { value: 'dress' },
      { value: 'outerwear' },
      { value: 'shoes' },
      { value: 'accessory' },
    ],
    state: {
      runtime: { sessionId: 'session-1' },
      translate: {
        jobId: 'translate-job',
        jobTab: 'current',
        jobPage: 1,
        jobs: [],
        items: [],
        concurrency: 10,
      },
      generate: {
        projectId: 'project-1',
        projectTitle: '测试项目',
        projectMetadata: {},
        projectSaveStatus: 'saved',
        elements: [],
        aiSessionId: 'session-a',
        aiSessions: [],
        aiMessages: [],
        scale: 1,
        panX: 0,
        panY: 0,
      },
      outfit: {
        jobId: 'outfit-job',
        jobTab: 'current',
        jobPage: 1,
        jobs: [],
        models: [],
        garments: [],
        concurrency: 10,
      },
      style: {
        jobId: '',
        jobTab: 'current',
        jobPage: 1,
        jobs: [],
        sourceImage: null,
        visualStyle: null,
        styleSummary: '',
        colorPalette: [],
        tags: [],
        subject: '',
        subjectRefs: [],
      },
    },
    persistCurrentAiSession: () => {},
    saveAiHistory: () => true,
    saveStyleHistory: () => true,
    scheduleCanvasProjectSave: () => {},
    serializeJobTask: (task) => task,
    serializeAssetBackedItem: (item) => item,
    serializeCanvasElement: (item) => item,
    normalizeGarmentInstructions: (value) => String(value || '').trim(),
    hydrateAssetItems: async (items) => items.map((item) => ({
      ...item,
      dataUrl: item.dataUrl || '',
      results: item.results || {},
    })),
    normalizeAspectRatio: (value, fallback = '1:1') => (
      ['1:1', '4:3', '3:4', '16:9', '9:16', '1:4', '1:8'].includes(String(value || '').trim())
        ? String(value).trim()
        : fallback
    ),
    normalizeCanvasResolution: (value, fallback = '1k') => (
      ['1k', '2k', '4k'].includes(String(value || '').trim().toLowerCase())
        ? String(value).trim().toLowerCase()
        : fallback
    ),
    TARGET_LANGUAGES: [{ code: 'en' }, { code: 'ja' }, { code: 'th' }],
    getLanguage: (code) => (
      ['auto', 'en', 'ja', 'th'].includes(String(code || ''))
        ? { code: String(code) }
        : null
    ),
    getModel: (id) => (
      ['nano-banana-2', 'nano-banana-pro', 'gpt-image-2'].includes(String(id || ''))
        ? { id: String(id) }
        : null
    ),
    unique: (items) => [...new Set(items)],
    serializeAiSessions: (value) => value || [],
    getSerializedAiHistory: () => [],
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    crypto: {
      randomUUID: () => `test-id-${++idCounter}`,
    },
    readJson: (key, fallback) => {
      try {
        const raw = storage.get(key)
        return raw ? JSON.parse(raw) : fallback
      } catch {
        return fallback
      }
    },
    localStorage: {
      setItem: (key, value) => {
        writes.push(String(value))
        if (shouldFailLargeWrite && String(value).length > 3000) {
          shouldFailLargeWrite = false
          const error = new Error('quota exceeded')
          error.name = 'QuotaExceededError'
          throw error
        }
        storage.set(key, String(value))
      },
      getItem: (key) => storage.get(key) || null,
    },
  }

  const functionNames = [
    'saveRuntimeState',
    'createRuntimeStorageSnapshot',
    'createCompactRuntimeStorageSnapshot',
    'writeRuntimeStorageSnapshot',
    'createCanvasProjectSaveSnapshot',
    'getCanvasProjectSaveSignature',
    'loadRuntimeState',
    'canvasAiHistoryStorageKey',
    'migrateLegacyRuntimeStorage',
    'createRuntimeMigrationInfo',
    'isLegacyRuntimeStorageHeavy',
    'sanitizeRuntimeState',
    'sanitizeStoredJobTasks',
    'sanitizeStoredAssetItem',
    'sanitizeCanvasElement',
    'sanitizeCanvasPath',
    'normalizeCanvasShape',
    'persistLegacyAiHistory',
    'persistLegacyStyleHistory',
    'createAiSessionRecord',
    'sanitizeAiSessions',
    'sanitizeAiMessages',
    'sanitizeAiMessageRefs',
    'sanitizeAiMessageImages',
    'sanitizeAiWorkflowItems',
    'shouldInlineHistoryDataUrl',
    'serializeStoredAiSessions',
    'serializeAiMessage',
    'serializeAiMessageImage',
    'serializeAiWorkflowItem',
    'serializeAiMessageRef',
    'sanitizeStyleHistoryEntries',
    'serializeStyleHistoryEntries',
    'loadResultsStore',
    'saveResultsStore',
    'pruneResultsStore',
    'normalizeTranslateFontMode',
    'normalizeTranslateFontFamily',
    'normalizeTranslateFontPrompt',
    'normalizeTranslateTextColorMode',
    'normalizeTranslateTextColor',
    'getEffectiveTranslateFontMode',
    'sanitizeTranslatePrefs',
    'sanitizeOutfitPrefs',
    'hydrateTranslateWorkspaceFromJob',
    'hydrateOutfitWorkspaceFromJob',
    'getTranslateSignature',
  ]
  const harnessSource = functionNames.map((name) => extractFunction(source, name)).filter(Boolean).join('\n')
  vm.createContext(context)
  vm.runInContext(harnessSource, context)
  return { ...context, writes, storage }
}

test('app defaults batch translation to gpt image 2 and outfit to nano banana 2', async () => {
  const source = await readFile(APP_PATH, 'utf8')
  const state = vm.runInNewContext(`(${extractStateInitializer(source)})`, {
    DEFAULT_CANVAS_PROJECT_TITLE: '未命名画布',
    DEFAULT_TRANSLATE_MODEL: 'gpt-image-2',
    DEFAULT_ASYNC_IMAGE_JOB_CONCURRENCY: 10,
    MAX_ASYNC_IMAGE_JOB_CONCURRENCY: 10,
    DEFAULT_TRANSLATE_HEADLINE_COLOR: '#111827',
    DEFAULT_TRANSLATE_BODY_COLOR: '#374151',
  })

  assert.equal(state.translate.model, 'gpt-image-2')
  assert.equal(state.translate.concurrency, 10)
  assert.equal(state.translate.fontMode, 'match_original')
  assert.equal(state.translate.fontFamily, '')
  assert.equal(state.translate.fontPrompt, '')
  assert.equal(state.translate.fontReference, null)
  assert.equal(state.translate.textColorMode, 'match_original')
  assert.equal(state.translate.headlineColor, '#111827')
  assert.equal(state.translate.bodyColor, '#374151')
  assert.equal(state.outfit.model, 'nano-banana-2')
  assert.equal(state.outfit.concurrency, 10)
})

test('frontend async image concurrency preferences ignore old values and stay fixed at 10', async () => {
  const harness = await createRuntimeHarness()

  const translatePrefs = harness.sanitizeTranslatePrefs({
    targets: ['ja'],
    concurrency: 999,
  })
  const outfitPrefs = harness.sanitizeOutfitPrefs({
    concurrency: 999,
  })

  assert.equal(translatePrefs.concurrency, 10)
  assert.equal(outfitPrefs.concurrency, 10)
})

test('batch translation and outfit pages do not expose concurrency inputs', async () => {
  const [appSource, htmlSource] = await Promise.all([
    readFile(APP_PATH, 'utf8'),
    readFile(INDEX_PATH, 'utf8'),
  ])

  assert.doesNotMatch(htmlSource, /id="t-concurrency"|id="o-concurrency"|concurrency-field/)
  assert.doesNotMatch(appSource, /tConcurrency|oConcurrency|#t-concurrency|#o-concurrency/)
})

test('frontend async image concurrency job hydration clamps restored jobs at 10', async () => {
  const harness = await createRuntimeHarness()

  await harness.hydrateTranslateWorkspaceFromJob({
    configJson: {
      modelId: 'gpt-image-2',
      sourceLanguage: 'auto',
      targetLanguages: ['ja'],
      preserveBrand: true,
      concurrency: 999,
    },
  }, [{
    id: 'translate-item-1',
    inputJson: { assetId: 'asset_1', targetLanguage: 'ja' },
  }])
  await harness.hydrateOutfitWorkspaceFromJob({
    configJson: {
      modelId: 'nano-banana-pro',
      concurrency: 999,
    },
  }, [{
    id: 'outfit-item-1',
    inputJson: {
      modelAssetId: 'model_1',
      modelLabel: 'Model 1',
      modelInstructions: '',
      lookAssetIds: ['garment_1'],
      lookRoles: ['top'],
      lookLabels: ['Top'],
      lookInstructions: [''],
    },
  }])

  assert.equal(harness.state.translate.concurrency, 10)
  assert.equal(harness.state.outfit.concurrency, 10)
})

test('sanitizeTranslatePrefs keeps uploaded font reference preferences and drops removed preset mode', async () => {
  const harness = await createRuntimeHarness()

  const referencePrefs = harness.sanitizeTranslatePrefs({
    source: 'auto',
    targets: ['th'],
    model: 'nano-banana-2',
    preserveBrand: true,
    concurrency: 3,
    fontMode: 'reference',
    fontPrompt: 'Use a condensed headline style.',
  })
  const removedPresetPrefs = harness.sanitizeTranslatePrefs({
    targets: ['th'],
    fontMode: 'preset',
    fontFamily: 'Kanit',
  })

  assert.equal(referencePrefs.fontMode, 'reference')
  assert.equal(referencePrefs.fontFamily, '')
  assert.equal(referencePrefs.fontPrompt, 'Use a condensed headline style.')
  assert.equal(referencePrefs.textColorMode, 'match_original')
  assert.equal(referencePrefs.headlineColor, '#111827')
  assert.equal(referencePrefs.bodyColor, '#374151')
  assert.equal(removedPresetPrefs.fontMode, 'match_original')
  assert.equal(removedPresetPrefs.fontFamily, '')
})

test('getTranslateSignature changes when font strategy changes', async () => {
  const harness = await createRuntimeHarness()

  const base = harness.getTranslateSignature({
    sourceLanguage: 'auto',
    modelId: 'nano-banana-2',
    preserveBrand: true,
    fontMode: 'match_original',
    fontFamily: '',
    fontReferenceAssetId: '',
    fontPrompt: '',
    textColorMode: 'match_original',
  })
  const legacyPreset = harness.getTranslateSignature({
    sourceLanguage: 'auto',
    modelId: 'nano-banana-2',
    preserveBrand: true,
    fontMode: 'preset',
    fontFamily: '',
    fontReferenceAssetId: '',
    fontPrompt: '',
    textColorMode: 'match_original',
  })
  const withReference = harness.getTranslateSignature({
    sourceLanguage: 'auto',
    modelId: 'nano-banana-2',
    preserveBrand: true,
    fontMode: 'reference',
    fontFamily: '',
    fontReferenceAssetId: 'asset_font_1',
    fontPrompt: 'Match the sample.',
    textColorMode: 'match_original',
  })
  const withCustomColors = harness.getTranslateSignature({
    sourceLanguage: 'auto',
    modelId: 'nano-banana-2',
    preserveBrand: true,
    fontMode: 'match_original',
    fontFamily: '',
    fontReferenceAssetId: '',
    fontPrompt: '',
    textColorMode: 'custom',
    headlineColor: '#f97316',
    bodyColor: '#111827',
  })

  assert.equal(base, legacyPreset)
  assert.notEqual(base, withReference)
  assert.notEqual(base, withCustomColors)
  assert.match(withReference, /asset_font_1/)
  assert.match(withCustomColors, /#F97316/)
})

test('writeRuntimeStorageSnapshot falls back to a compact snapshot when quota is exceeded', async () => {
  const harness = await createRuntimeHarness({ failLargeWrites: true })
  harness.state.generate.elements = Array.from({ length: 120 }, (_, index) => ({
    id: `el-${index}`,
    type: 'image',
    assetId: '',
    content: `data:image/png;base64,${'a'.repeat(120)}`,
  }))

  assert.doesNotThrow(() => harness.saveRuntimeState())
  assert.equal(harness.writes.length, 2)

  const stored = JSON.parse(harness.storage.get('img-translator:runtime:v2'))
  assert.equal(stored.generate.elements.length, 80)
  assert.equal(stored.generate.elements[0].content, '')
  assert.equal(stored.generate.projectId, 'project-1')
})

test('writeRuntimeStorageSnapshot keeps the full snapshot when storage accepts it', async () => {
  const harness = await createRuntimeHarness()
  harness.state.generate.elements = [{
    id: 'el-1',
    type: 'image',
    assetId: 'asset-1',
    content: 'data:image/png;base64,abc',
  }]

  harness.saveRuntimeState()

  const stored = JSON.parse(harness.storage.get('img-translator:runtime:v2'))
  assert.equal(harness.writes.length, 1)
  assert.equal(stored.generate.elements.length, 1)
  assert.equal(stored.generate.elements[0].content, 'data:image/png;base64,abc')
})

test('migrateLegacyRuntimeStorage moves heavy legacy runtime fields out of runtime storage', async () => {
  const harness = await createRuntimeHarness()
  const legacyDataUrl = `data:image/png;base64,${'a'.repeat(5000)}`
  harness.storage.set('img-translator:runtime:v2', JSON.stringify({
    sessionId: 'session-legacy',
    translate: { jobs: [], items: [] },
    generate: {
      projectId: 'canvas-legacy',
      projectTitle: '旧画布',
      aiSessionId: 'session-a',
      aiMessages: [
        { id: 'msg-1', role: 'user', content: '旧消息' },
      ],
      aiSessions: [
        {
          id: 'session-a',
          title: '旧会话',
          messages: [{ id: 'msg-2', role: 'assistant', content: '旧回复' }],
        },
      ],
      elements: [
        { id: 'el-1', type: 'image', assetId: '', content: legacyDataUrl },
      ],
    },
    outfit: { jobs: [], models: [], garments: [] },
    style: {
      history: [
        { id: 'style-1', subject: '旧风格', resultDataUrl: legacyDataUrl, timestamp: 1 },
      ],
    },
  }))

  const info = harness.migrateLegacyRuntimeStorage()

  assert.deepEqual(JSON.parse(JSON.stringify(info)), { migrated: true, compacted: true, aiHistory: true, styleHistory: true })

  const runtime = JSON.parse(harness.storage.get('img-translator:runtime:v2'))
  assert.equal(runtime.generate.aiMessages, undefined)
  assert.equal(runtime.generate.aiSessions, undefined)
  assert.equal(runtime.style.history, undefined)
  assert.equal(runtime.generate.elements[0].content, '')

  const history = JSON.parse(harness.storage.get('img-translator:canvas-ai-history:v1:project:canvas-legacy'))
  assert.equal(history.activeSessionId, 'session-a')
  assert.equal(history.sessions[0].messages[0].content, '旧回复')

  const results = JSON.parse(harness.storage.get('img-translator:results:v1'))
  assert.equal(results.style.history[0].subject, '旧风格')
  assert.equal(results.style.history[0].resultDataUrl, legacyDataUrl)
})

test('runtime storage preserves style transfer draft and analyzed style', async () => {
  const harness = await createRuntimeHarness()
  harness.state.style = {
    jobId: 'style-job',
    jobTab: 'history',
    jobPage: 2,
    jobs: [{
      jobId: 'style-job',
      type: 'style_transfer_batch',
      status: 'completed',
      loaded: true,
      progressDone: 2,
      progressTotal: 2,
    }],
    sourceImage: {
      id: 'source-asset',
      assetId: 'source-asset',
      name: 'source.png',
      mime: 'image/png',
      dataUrl: 'data:image/png;base64,source',
    },
    visualStyle: {
      overall_concept: { theme: 'Soft catalog' },
      reproduction_prompt: { style_essence_en: 'Soft catalog style' },
    },
    styleSummary: '柔和商品目录风',
    colorPalette: [{ hex: '#F7F3EC', role: 'warm white' }],
    tags: ['catalog'],
    subject: '新的商品主体',
    subjectRefs: [{
      id: 'subject-asset',
      assetId: 'subject-asset',
      name: 'subject.png',
      mime: 'image/png',
      dataUrl: 'data:image/png;base64,subject',
    }],
    history: [],
  }

  const snapshot = harness.createRuntimeStorageSnapshot()
  const sanitized = harness.sanitizeRuntimeState(snapshot)

  assert.equal(snapshot.style.subject, '新的商品主体')
  assert.equal(snapshot.style.jobId, 'style-job')
  assert.equal(snapshot.style.jobTab, 'history')
  assert.equal(snapshot.style.jobPage, 2)
  assert.equal(sanitized.style.subject, '新的商品主体')
  assert.equal(sanitized.style.jobId, 'style-job')
  assert.equal(sanitized.style.jobs[0].type, 'style_transfer_batch')
  assert.equal(sanitized.style.sourceImage.assetId, 'source-asset')
  assert.equal(sanitized.style.visualStyle.overall_concept.theme, 'Soft catalog')
  assert.deepEqual(sanitized.style.colorPalette, [{ hex: '#F7F3EC', role: 'warm white' }])
  assert.deepEqual(sanitized.style.tags, ['catalog'])
  assert.equal(sanitized.style.subjectRefs[0].assetId, 'subject-asset')
})

test('migrateLegacyRuntimeStorage skips already compact runtime storage', async () => {
  const harness = await createRuntimeHarness()
  harness.storage.set('img-translator:runtime:v2', JSON.stringify({
    sessionId: 'session-current',
    translate: { jobs: [], items: [] },
    generate: { projectId: 'canvas-current', elements: [] },
    outfit: { jobs: [], models: [], garments: [] },
    style: { subjectRefs: [] },
  }))

  const info = harness.migrateLegacyRuntimeStorage()

  assert.deepEqual(JSON.parse(JSON.stringify(info)), { migrated: false, compacted: false, aiHistory: false, styleHistory: false })
  assert.equal(harness.writes.length, 0)
})

test('canvas save signatures are stable for unchanged project snapshots', async () => {
  const harness = await createRuntimeHarness()
  harness.state.generate.elements = [{
    id: 'el-1',
    type: 'image',
    assetId: 'asset-1',
    content: '',
    x: 10,
    y: 20,
  }]

  const first = harness.getCanvasProjectSaveSignature(harness.createCanvasProjectSaveSnapshot())
  const second = harness.getCanvasProjectSaveSignature(harness.createCanvasProjectSaveSnapshot())

  assert.equal(first, second)

  harness.state.generate.elements[0].x = 11
  const changed = harness.getCanvasProjectSaveSignature(harness.createCanvasProjectSaveSnapshot())
  assert.notEqual(changed, first)
})
