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
    TRANSLATE_TEXT_COLOR_MODES: new Set(['match_original', 'custom']),
    DEFAULT_TRANSLATE_HEADLINE_COLOR: '#111827',
    DEFAULT_TRANSLATE_BODY_COLOR: '#374151',
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
        textColorMode: 'custom',
        headlineColor: '#f97316',
        bodyColor: '#111827',
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
    extractFunction(source, 'normalizeTranslateTextColorMode'),
    extractFunction(source, 'normalizeTranslateTextColor'),
    extractFunction(source, 'getEffectiveTranslateFontMode'),
    extractFunction(source, 'getTranslateRunConfig'),
    extractFunction(source, 'prepareTranslateRunConfig'),
  ].join('\n')

  vm.createContext(context)
  vm.runInContext(harnessSource, context)
  return { ...context, uploads }
}

async function createOutfitAppendHarness() {
  const source = await readFile(APP_PATH, 'utf8')
  const context = {
    state: {
      outfit: {
        models: [{ id: 'model-1', name: 'model-1.png' }],
        garments: [{ id: 'garment-1', name: 'garment-1.png', role: 'top', instructions: 'keep sleeves' }],
        results: {
          'model-1::look-1': { status: 'done', signature: 'sig-1' },
          'old::look-2': { status: 'done', signature: 'sig-old' },
        },
        garmentType: 'dress',
        progress: '',
      },
    },
    pruneOutfitResults: () => {
      const validModelIds = new Set(context.state.outfit.models.map((item) => item.id))
      const validLookIds = new Set(['look-1'])
      const next = {}
      for (const [key, value] of Object.entries(context.state.outfit.results)) {
        const [modelId, lookId] = key.split('::')
        if (validModelIds.has(modelId) && validLookIds.has(lookId)) {
          next[key] = value
        }
      }
      context.state.outfit.results = next
    },
  }

  const harnessSource = [
    extractFunction(source, 'appendOutfitModels'),
    extractFunction(source, 'appendOutfitGarments'),
  ].join('\n')

  vm.createContext(context)
  vm.runInContext(harnessSource, context)
  return context
}

async function createUploadSkeletonHarness() {
  const source = await readFile(APP_PATH, 'utf8')
  const context = {
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    document: {
      createElement: (tag) => ({
        tag,
        className: '',
        style: {},
        dataset: {},
        children: [],
        append(...nodes) { this.children.push(...nodes) },
        replaceChildren(...nodes) { this.children = nodes },
        set innerHTML(value) { this.html = value },
        get innerHTML() { return this.html || '' },
      }),
    },
  }

  const harnessSource = [
    extractFunction(source, 'clampUploadPercent'),
    extractFunction(source, 'createUploadProgressState'),
    extractFunction(source, 'setUploadProgress'),
    extractFunction(source, 'createUploadSkeletonCard'),
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
  assert.equal(config.textColorMode, 'custom')
  assert.equal(config.headlineColor, '#F97316')
  assert.equal(config.bodyColor, '#111827')
})

test('outfit append helpers keep existing model and garment items intact', async () => {
  const harness = await createOutfitAppendHarness()

  harness.appendOutfitModels([
    { id: 'model-2', name: 'model-2.png' },
  ])
  harness.appendOutfitGarments([
    { id: 'garment-2', name: 'garment-2.png' },
  ], 'outerwear')

  assert.deepEqual(
    harness.state.outfit.models.map((item) => item.id),
    ['model-1', 'model-2'],
  )
  assert.deepEqual(
    harness.state.outfit.garments.map((item) => ({ id: item.id, role: item.role, instructions: item.instructions })),
    [
      { id: 'garment-1', role: 'top', instructions: 'keep sleeves' },
      { id: 'garment-2', role: 'outerwear', instructions: '' },
    ],
  )
  assert.deepEqual(Object.keys(harness.state.outfit.results), ['model-1::look-1'])
})

test('upload skeleton cards expose title, detail, and percent metadata', async () => {
  const harness = await createUploadSkeletonHarness()
  const upload = harness.createUploadProgressState({
    title: '模特图',
    detail: 'demo.png',
    percent: 42,
  })
  const card = harness.createUploadSkeletonCard(upload)

  assert.equal(card.className, 'upload-item')
  assert.equal(card.children[0].children[0].textContent, '模特图')
  assert.equal(card.children[0].children[1].textContent, 'demo.png')
  assert.equal(card.children[1].children[1].textContent, '42%')
})
