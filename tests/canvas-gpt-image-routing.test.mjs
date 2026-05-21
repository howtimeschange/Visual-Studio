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

async function loadRoutingHarness() {
  const source = await readFile(APP_PATH, 'utf8')
  const context = {
    normalizeCanvasResolution: (value) => (['1k', '2k', '4k'].includes(String(value || '').trim()) ? String(value).trim() : '1k'),
  }
  vm.createContext(context)
  vm.runInContext(extractFunction(source, 'shouldUseAsyncCanvasGenerate'), context)
  return context
}

test('canvas routes every GPT Image 2 generation through async jobs', async () => {
  const harness = await loadRoutingHarness()

  assert.equal(harness.shouldUseAsyncCanvasGenerate('gpt-image-2'), true)
})

test('canvas keeps non-GPT models on the existing direct path unless they need async behavior', async () => {
  const harness = await loadRoutingHarness()

  assert.equal(harness.shouldUseAsyncCanvasGenerate('nano-banana-2'), false)
  assert.equal(harness.shouldUseAsyncCanvasGenerate('nano-banana-pro'), false)
})
