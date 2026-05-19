import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const APP_PATH = new URL('../public/app.js', import.meta.url)

function extractFunction(source, name) {
  const functionStart = source.indexOf(`function ${name}(`)
  if (functionStart === -1) return ''
  const asyncPrefixStart = source.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
    ? functionStart - 6
    : functionStart

  let paramsDepth = 0
  let bodyStart = -1
  for (let index = source.indexOf('(', functionStart); index < source.length; index += 1) {
    const char = source[index]
    if (char === '(') paramsDepth += 1
    if (char === ')') paramsDepth -= 1
    if (paramsDepth === 0) {
      bodyStart = source.indexOf('{', index)
      break
    }
  }
  if (bodyStart === -1) throw new Error(`Could not find body for ${name}`)
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(asyncPrefixStart, index + 1)
  }

  throw new Error(`Could not extract function ${name}`)
}

async function createAuthRedirectHarness() {
  const source = await readFile(APP_PATH, 'utf8')
  const storage = new Map()
  const pushedRoutes = []
  const context = {
    AUTH_RETURN_STORAGE: 'img-translator:auth-return:v1',
    state: {
      activeView: 'translate',
      account: {
        user: { id: 'stale_user', name: '旧账号' },
        error: '',
        status: '',
      },
      generate: { projectId: '' },
    },
    dom: {},
    window: {
      location: {
        origin: 'https://example.com',
        pathname: '/',
        search: '?view=translate',
        hash: '#batch',
      },
      history: {
        pushState(_state, _title, path) {
          pushedRoutes.push(['push', path])
          const next = new URL(path, 'https://example.com')
          context.window.location.pathname = next.pathname
          context.window.location.search = next.search
          context.window.location.hash = next.hash
        },
        replaceState(_state, _title, path) {
          pushedRoutes.push(['replace', path])
          const next = new URL(path, 'https://example.com')
          context.window.location.pathname = next.pathname
          context.window.location.search = next.search
          context.window.location.hash = next.hash
        },
      },
      scrollTo() {},
    },
    document: {
      documentElement: { scrollTop: 0 },
      body: { scrollTop: 0 },
    },
    URL,
    URLSearchParams,
    sessionStorage: {
      getItem(key) {
        return storage.get(key) || null
      },
      setItem(key, value) {
        storage.set(key, String(value))
      },
      removeItem(key) {
        storage.delete(key)
      },
    },
    requestAnimationFrame(callback) {
      callback()
    },
    fetch: async () => new Response(JSON.stringify({ error: 'Login required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
    normalizeView: (view) => view,
    ensureCanvasFirstOpenAiPanel: () => {},
    savePrefs: () => {},
    renderShell: () => {},
    renderGenerate: () => {},
    renderAccount: () => {
      context.renderedStatus = context.state.account.status
    },
    renderHome: () => {},
    renderProjects: () => {},
    releaseCompletedLoadedTasksForView: () => {},
    loadCanvasProjects: async () => {},
    $: () => ({ scrollTo() {} }),
    trimError: (error) => String(error?.message || error || ''),
    console,
  }
  const functionNames = [
    'currentRoutePath',
    'sanitizeAuthReturnPath',
    'getAuthReturnTarget',
    'setAuthReturnTarget',
    'showAuthView',
    'setActiveView',
    'routeForView',
    'redirectToLoginForApi',
    'createHttpError',
    'postJson',
  ]
  const harnessSource = functionNames.map((name) => extractFunction(source, name)).filter(Boolean).join('\n')
  vm.createContext(context)
  vm.runInContext(harnessSource, context)
  return Object.assign(context, { storage, pushedRoutes })
}

test('postJson redirects Login required responses to the auth view with return target', async () => {
  const harness = await createAuthRedirectHarness()

  await assert.rejects(
    () => harness.postJson('/api/translate', { imageBase64: 'abc', targetLanguage: 'ja' }),
    (error) => error.status === 401 && error.message === 'Login required',
  )

  assert.equal(harness.state.account.user, null)
  assert.equal(harness.state.account.status, '请先登录后继续使用')
  assert.equal(harness.renderedStatus, '请先登录后继续使用')
  assert.deepEqual(harness.pushedRoutes, [
    ['push', '/lovart/auth?returnTo=%2F%3Fview%3Dtranslate%23batch'],
  ])
  assert.equal(
    harness.storage.get('img-translator:auth-return:v1'),
    '/?view=translate#batch',
  )
})
