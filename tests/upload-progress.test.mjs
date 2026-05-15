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
  const uploads = []
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
    postJson: async (url, body) => {
      uploads.push({ url, body })
      return {
        sessionId: 'sess_uploaded',
        asset: {
          id: `asset_${body.filename}`,
        },
      }
    },
  }

  const harnessSource = [
    extractFunction(source, 'prepareAssetItems'),
  ].join('\n')

  vm.createContext(context)
  vm.runInContext(harnessSource, context)
  return { ...context, uploads }
}

async function createTranslateRunConfigHarness() {
  const source = await readFile(APP_PATH, 'utf8')
  const uploads = []
  const context = {
    TRANSLATE_FONT_MODES: new Set(['match_original', 'reference']),
    state: {
      runtime: {
        sessionId: 'sess_existing',
      },
      keys: {},
      translate: {
        source: 'auto',
        targets: ['th'],
        model: 'nano-banana-2',
        preserveBrand: true,
        fontMode: 'preset',
        fontFamily: '',
        fontPrompt: 'Rounded campaign headline.',
        fontReference: null,
      },
    },
    splitDataUrl: (dataUrl) => {
      const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
      return match ? { mime: match[1], base64: match[2] } : null
    },
    saveRuntimeState: () => {},
    postJson: async (url, body) => {
      uploads.push({ url, body })
      return {
        sessionId: 'sess_uploaded',
        asset: {
          id: 'asset_kanit_reference',
          mime: 'image/png',
        },
      }
    },
  }

  const harnessSource = [
    extractFunction(source, 'normalizeTranslateFontMode'),
    extractFunction(source, 'normalizeTranslateFontFamily'),
    extractFunction(source, 'normalizeTranslateFontPrompt'),
    extractFunction(source, 'getEffectiveTranslateFontMode'),
    extractFunction(source, 'getTranslateRunConfig'),
    extractFunction(source, 'prepareTranslateRunConfig'),
  ].join('\n')

  vm.createContext(context)
  vm.runInContext(harnessSource, context)
  return { ...context, uploads }
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
  assert.equal(harness.uploads[0].body.width, 10)
  assert.equal(harness.uploads[0].body.height, 10)
  assert.equal(harness.uploads[1].body.width, 20)
  assert.equal(harness.uploads[1].body.height, 20)
  assert.equal(harness.state.runtime.sessionId, 'sess_uploaded')
})

test('removed font preset mode does not generate or upload a font reference image', async () => {
  const harness = await createTranslateRunConfigHarness()

  const config = await harness.prepareTranslateRunConfig()

  assert.equal(harness.uploads.length, 0)
  assert.equal(config.fontMode, 'match_original')
  assert.equal(config.fontFamily, '')
  assert.equal(config.fontReferenceAssetId, '')
  assert.equal(config.fontReferenceImage, null)
  assert.equal(config.fontPrompt, '')
})
