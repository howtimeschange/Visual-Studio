import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const APP_PATH = new URL('../public/app.js', import.meta.url)

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) return ''
  const paramsEnd = source.indexOf(')', start)
  const bodyStart = source.indexOf('{', paramsEnd)
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
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
    state: {
      runtime: { sessionId: 'session-1' },
      translate: {
        jobId: 'translate-job',
        jobTab: 'current',
        jobPage: 1,
        jobs: [],
        items: [],
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
      },
      style: {
        sourceImage: null,
        visualStyle: null,
        styleSummary: '',
        colorPalette: [],
        tags: [],
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
    'shouldInlineHistoryDataUrl',
    'serializeStoredAiSessions',
    'serializeAiMessage',
    'serializeAiMessageRef',
    'sanitizeStyleHistoryEntries',
    'serializeStyleHistoryEntries',
    'loadResultsStore',
    'saveResultsStore',
    'pruneResultsStore',
  ]
  const harnessSource = functionNames.map((name) => extractFunction(source, name)).filter(Boolean).join('\n')
  vm.createContext(context)
  vm.runInContext(harnessSource, context)
  return { ...context, writes, storage }
}

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
