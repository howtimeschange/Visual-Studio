import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const APP_PATH = new URL('../public/app.js', import.meta.url)
const LEGACY_HISTORY_KEY = 'img-translator:canvas-ai-history:v1'

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

async function createHistoryHarness() {
  const source = await readFile(APP_PATH, 'utf8')
  const storage = new Map()
  let idCounter = 0
  const context = {
    AI_HISTORY_LIMIT: 40,
    AI_HISTORY_INLINE_DATA_URL_LIMIT: 220_000,
    AI_STORED_SESSION_LIMIT: 8,
    AI_STORED_MESSAGE_LIMIT: 16,
    CANVAS_AI_HISTORY_STORAGE: LEGACY_HISTORY_KEY,
    CANVAS_AI_HISTORY_PROJECT_PREFIX: `${LEGACY_HISTORY_KEY}:project:`,
    state: {
      generate: {
        projectId: '',
        aiSessionId: '',
        aiSessions: [],
        aiMessages: [],
        aiRefs: [],
        aiRunning: false,
      },
    },
    DEFAULT_AI_SESSION_TITLE: '当前会话',
    saveRuntimeState: () => {},
    renderAiMessages: () => {},
    renderAiRefList: () => {},
    renderAiSessionControls: () => {},
    dom: {
      gAiSession: {
        replaceChildren(...children) { this.children = children },
        value: '',
        disabled: false,
      },
      gAiNewSession: { disabled: false },
      gAiClearSession: { disabled: false },
    },
    document: {
      createElement: () => ({ value: '', textContent: '' }),
    },
    crypto: {
      randomUUID: () => `test-id-${++idCounter}`,
    },
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    normalizeAspectRatio: (value, fallback = '1:1') => (
      ['1:1', '4:3', '3:4', '16:9', '9:16', '1:4', '1:8'].includes(String(value || '').trim())
        ? String(value).trim()
        : fallback
    ),
    readJson: (key, fallback) => {
      try {
        const raw = storage.get(key)
        return raw ? JSON.parse(raw) : fallback
      } catch {
        return fallback
      }
    },
  }

  const functionNames = [
    'canvasAiHistoryStorageKey',
    'loadAiHistory',
    'saveAiHistory',
    'resolveStoredAiHistoryPayload',
    'serializeStoredAiSessions',
    'getSerializedAiHistory',
    'serializeAiMessages',
    'getProjectAiHistory',
    'getProjectAiSessions',
    'getProjectMetadata',
    'hasProjectAiHistory',
    'resolveCanvasAiHistory',
    'resolveCanvasAiSessions',
    'loadAiSessions',
    'saveAiSessions',
    'createAiSessionRecord',
    'sanitizeAiSessions',
    'serializeAiSessions',
    'inferAiSessionTitle',
    'persistCurrentAiSession',
    'activateAiSession',
    'ensureAiSessionSelection',
    'ensureCurrentAiSession',
    'startNewAiSession',
    'clearCurrentAiSession',
    'renderAiSessionControls',
    'serializeAiMessage',
    'serializeAiMessageRef',
    'sanitizeAiMessages',
    'sanitizeAiMessageRefs',
    'shouldInlineHistoryDataUrl',
  ]
  const harnessSource = functionNames.map((name) => extractFunction(source, name)).filter(Boolean).join('\n')
  vm.createContext(context)
  vm.runInContext(harnessSource, context)
  return context
}

test('canvas AI history is stored separately for each canvas project', async () => {
  const harness = await createHistoryHarness()

  harness.state.generate.projectId = 'canvas-a'
  harness.state.generate.aiMessages = [{ id: 'a1', role: 'user', content: 'A 的聊天' }]
  harness.saveAiHistory()

  harness.state.generate.projectId = 'canvas-b'
  harness.state.generate.aiMessages = [{ id: 'b1', role: 'user', content: 'B 的聊天' }]
  harness.saveAiHistory()

  assert.deepEqual(harness.loadAiHistory('canvas-a').map((msg) => msg.content), ['A 的聊天'])
  assert.deepEqual(harness.loadAiHistory('canvas-b').map((msg) => msg.content), ['B 的聊天'])
})

test('switching to a project without history does not reuse legacy global history', async () => {
  const harness = await createHistoryHarness()
  harness.localStorage.setItem(LEGACY_HISTORY_KEY, JSON.stringify([
    { id: 'legacy-1', role: 'user', content: '旧的全局聊天' },
  ]))

  assert.deepEqual(Array.from(harness.loadAiHistory('canvas-empty', { allowLegacy: false })), [])
})

test('project metadata history wins over locally cached project history', async () => {
  const harness = await createHistoryHarness()

  harness.state.generate.projectId = 'canvas-a'
  harness.state.generate.aiMessages = [{ id: 'cached-1', role: 'user', content: '本地缓存聊天' }]
  harness.saveAiHistory()

  const history = harness.resolveCanvasAiHistory({
    metadataJson: {
      aiMessages: [{ id: 'server-1', role: 'user', content: '项目里的聊天' }],
    },
  }, 'canvas-a')

  assert.deepEqual(Array.from(history).map((msg) => msg.content), ['项目里的聊天'])
})

test('new AI session keeps the previous canvas session available', async () => {
  const harness = await createHistoryHarness()
  harness.state.generate.projectId = 'canvas-a'
  harness.state.generate.aiMessages = [{ id: 'm1', role: 'user', content: '第一段需求' }]
  harness.ensureCurrentAiSession()
  const firstId = harness.state.generate.aiSessionId

  harness.startNewAiSession()

  assert.notEqual(harness.state.generate.aiSessionId, firstId)
  assert.deepEqual(Array.from(harness.state.generate.aiMessages), [])
  assert.equal(harness.state.generate.aiSessions.length, 2)
  assert.deepEqual(
    harness.state.generate.aiSessions.find((session) => session.id === firstId).messages.map((msg) => msg.content),
    ['第一段需求'],
  )
})

test('clear AI session empties only the active session', async () => {
  const harness = await createHistoryHarness()
  const sessionA = harness.createAiSessionRecord({
    id: 'session-a',
    messages: [{ id: 'a1', role: 'user', content: 'A 会话' }],
  })
  const sessionB = harness.createAiSessionRecord({
    id: 'session-b',
    messages: [{ id: 'b1', role: 'user', content: 'B 会话' }],
  })
  harness.state.generate.aiSessions = [sessionA, sessionB]
  harness.activateAiSession('session-b')

  harness.clearCurrentAiSession()

  assert.deepEqual(Array.from(harness.state.generate.aiMessages), [])
  assert.deepEqual(Array.from(harness.state.generate.aiSessions.find((session) => session.id === 'session-b').messages), [])
  assert.deepEqual(
    harness.state.generate.aiSessions.find((session) => session.id === 'session-a').messages.map((msg) => msg.content),
    ['A 会话'],
  )
})

test('rendering AI session controls does not discard newly queued messages', async () => {
  const harness = await createHistoryHarness()
  harness.state.generate.aiSessions = [
    harness.createAiSessionRecord({ id: 'session-a', messages: [] }),
  ]
  harness.state.generate.aiSessionId = 'session-a'
  harness.state.generate.aiMessages = [
    { id: 'live-1', role: 'user', content: '刚发送的需求' },
    { id: 'live-2', role: 'assistant', content: '', loading: true },
  ]

  harness.renderAiSessionControls()

  assert.deepEqual(
    harness.state.generate.aiMessages.map((msg) => msg.content),
    ['刚发送的需求', ''],
  )
})
