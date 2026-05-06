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
    normalizeAspectRatio: (value) => (
      ['1:1', '4:3', '3:4', '16:9', '9:16', '1:4', '1:8'].includes(String(value || '').trim())
        ? String(value).trim()
        : '1:1'
    ),
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
