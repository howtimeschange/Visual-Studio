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

async function loadHarness(functionNames, overrides = {}) {
  const source = await readFile(APP_PATH, 'utf8')
  const context = {
    clamp: (value, min, max) => Math.min(Math.max(value, min), max),
    splitDataUrl: (dataUrl) => {
      const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/)
      return match ? { mime: match[1], base64: match[2] } : null
    },
    normalizeAspectRatio: (value) => (
      ['1:1', '4:3', '3:4', '16:9', '9:16', '1:4', '1:8'].includes(String(value || '').trim())
        ? String(value).trim()
        : '1:1'
    ),
    basename: (name = '') => String(name).replace(/\.[^.]+$/, ''),
    normalizeGarmentInstructions: (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 800),
    saveRuntimeState: () => {},
    ...overrides,
  }
  const harnessSource = functionNames.map((name) => extractFunction(source, name)).filter(Boolean).join('\n')
  vm.createContext(context)
  vm.runInContext(harnessSource, context)
  return context
}

test('canvas displays explicit image dimensions at half of the original size', async () => {
  const harness = await loadHarness(['getCanvasImageSize'])

  assert.deepEqual(JSON.parse(JSON.stringify(harness.getCanvasImageSize('16:9', 3840, 2160))), {
    width: 1920,
    height: 1080,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(harness.getCanvasImageSize('', 800, 600))), {
    width: 400,
    height: 300,
  })
})

test('editing canvas text writes the new copy back to element state immediately', async () => {
  let saveCount = 0
  const harness = await loadHarness(['updateCanvasTextElementContent'], {
    saveRuntimeState: () => {
      saveCount += 1
    },
  })
  const element = { content: '旧文案' }

  harness.updateCanvasTextElementContent(element, '新输入的文案')

  assert.equal(element.content, '新输入的文案')
  assert.equal(saveCount, 1)
})

test('unchanged canvas text does not schedule redundant saves', async () => {
  let saveCount = 0
  const harness = await loadHarness(['updateCanvasTextElementContent'], {
    saveRuntimeState: () => {
      saveCount += 1
    },
  })
  const element = { content: '同一段文案' }

  harness.updateCanvasTextElementContent(element, '同一段文案')

  assert.equal(element.content, '同一段文案')
  assert.equal(saveCount, 0)
})

test('outfit run summary shows real look and item counts before submit', async () => {
  const harness = await loadHarness(['formatOutfitRunEstimate'])

  assert.equal(
    harness.formatOutfitRunEstimate(3, 5),
    '将生成 5 套搭配，共 15 张图',
  )
  assert.equal(
    harness.formatOutfitRunEstimate(1, 1),
    '将生成 1 套搭配，共 1 张图',
  )
  assert.equal(
    harness.formatOutfitRunEstimate(0, 4),
    '',
  )
})

test('outfit signature changes when per-model instructions change', async () => {
  const state = {
    outfit: {
      models: [
        { id: 'model-1', instructions: 'keep left hand visible' },
      ],
    },
  }
  const harness = await loadHarness(['getOutfitSignature', 'getOutfitModelFingerprint'], { state })

  const first = harness.getOutfitSignature({
    modelId: 'nano-banana-2',
    modelFingerprint: harness.getOutfitModelFingerprint(),
    garmentFingerprint: 'dress-1:dress:',
  })
  state.outfit.models[0].instructions = 'use a calmer smile'
  const second = harness.getOutfitSignature({
    modelId: 'nano-banana-2',
    modelFingerprint: harness.getOutfitModelFingerprint(),
    garmentFingerprint: 'dress-1:dress:',
  })

  assert.notEqual(first, second)
})

test('outfit look previews include every garment in a combined look', async () => {
  const harness = await loadHarness(['getOutfitLookPreviewItems'])
  const look = {
    label: '上衣 + 下装',
    items: [
      { id: 'top-1', name: 'top.png', dataUrl: 'data:image/png;base64,top' },
      { id: 'bottom-1', name: 'bottom.png', dataUrl: 'data:image/png;base64,bottom' },
    ],
  }

  assert.deepEqual(JSON.parse(JSON.stringify(harness.getOutfitLookPreviewItems(look))), [
    { src: 'data:image/png;base64,top', alt: 'top.png', label: 'top' },
    { src: 'data:image/png;base64,bottom', alt: 'bottom.png', label: 'bottom' },
  ])
})

test('model library filters templates by age and gender', async () => {
  const source = await readFile(APP_PATH, 'utf8')
  const libraryMatch = source.match(/const MODEL_LIBRARY_ITEMS = (\[[\s\S]*?\])\n\n/)
  assert.ok(libraryMatch, 'MODEL_LIBRARY_ITEMS should be defined')
  const library = vm.runInNewContext(libraryMatch[1])
  const harness = await loadHarness(['filterModelLibraryItems'])

  const girls = harness.filterModelLibraryItems(library, { age: 'child', gender: 'female' })
  const adultMen = harness.filterModelLibraryItems(library, { age: 'adult', gender: 'male' })
  const allAdults = harness.filterModelLibraryItems(library, { age: 'adult', gender: 'all' })

  assert.equal(girls.length, 3)
  assert.equal(adultMen.length, 1)
  assert.equal(allAdults.length, 5)
  assert.ok(girls.every((item) => item.age === 'child' && item.gender === 'female'))
})

test('selected model library entries become upload-ready model files', async () => {
  const harness = await loadHarness(['createModelLibraryFileName', 'createModelLibraryUploadDescriptor'])
  const entry = {
    id: 'child-girl-kids',
    label: '儿童女孩',
    age: 'child',
    gender: 'female',
    src: '/model-library/children/kids-girl.jpg',
  }

  assert.equal(harness.createModelLibraryFileName(entry), 'model-library-child-girl-kids.jpg')
  assert.deepEqual(JSON.parse(JSON.stringify(harness.createModelLibraryUploadDescriptor(entry, 'data:image/jpeg;base64,abc'))), {
    name: 'model-library-child-girl-kids.jpg',
    mime: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,abc',
    libraryId: 'child-girl-kids',
    label: '儿童女孩',
    age: 'child',
    gender: 'female',
  })
})
