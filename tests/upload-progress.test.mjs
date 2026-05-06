import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const APP_PATH = new URL('../public/app.js', import.meta.url)

function extractFunction(source, name) {
  let start = source.indexOf(`async function ${name}(`)
  if (start === -1) start = source.indexOf(`function ${name}(`)
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

async function createUploadHarness() {
  const source = await readFile(APP_PATH, 'utf8')
  const context = {
    state: {
      runtime: {
        sessionId: '',
      },
    },
    basename: (name = '') => String(name).replace(/\.[^.]+$/, ''),
    saveRuntimeState: () => {},
    readImageFiles: async () => ([
      { name: 'a.png', mime: 'image/png', base64: 'aaa', dataUrl: 'data:image/png;base64,aaa', width: 10, height: 10 },
      { name: 'b.png', mime: 'image/png', base64: 'bbb', dataUrl: 'data:image/png;base64,bbb', width: 20, height: 20 },
    ]),
    postJson: async (_url, body) => ({
      sessionId: 'sess_uploaded',
      asset: {
        id: `asset_${body.filename}`,
      },
    }),
  }

  const harnessSource = [
    extractFunction(source, 'prepareAssetItems'),
  ].join('\n')

  vm.createContext(context)
  vm.runInContext(harnessSource, context)
  return context
}

test('prepareAssetItems reports upload progress for each file', async () => {
  const harness = await createUploadHarness()
  const progress = []

  const items = await harness.prepareAssetItems(['fake-file-list'], {
    onProgress: (payload) => progress.push(payload),
  })

  assert.equal(items.length, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(progress)), [
    { current: 1, total: 2, filename: 'a.png' },
    { current: 2, total: 2, filename: 'b.png' },
  ])
  assert.equal(harness.state.runtime.sessionId, 'sess_uploaded')
})
