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

async function createCanvasGenerateHarness() {
  const source = await readFile(APP_PATH, 'utf8')
  const calls = []
  const context = {
    state: {
      generate: { projectId: 'canvas_project_1' },
      runtime: { sessionId: '' },
    },
    postJson: async (url, body) => {
      calls.push({ url, body })
      return { jobId: 'job_canvas_generate', sessionId: 'session_after_submit' }
    },
    waitForCanvasGenerateJob: async (jobId, options) => ({ jobId, options }),
    normalizeCanvasResolution: (value) => String(value || '').trim().toLowerCase(),
    console,
  }
  const functionNames = [
    'shouldUseAsyncCanvasGenerate',
    'requestCanvasGenerate',
  ]
  const harnessSource = functionNames.map((name) => extractFunction(source, name)).filter(Boolean).join('\n')
  vm.createContext(context)
  vm.runInContext(harnessSource, context)
  return Object.assign(context, { calls })
}

test('canvas generation submits all image models through the job endpoint', async () => {
  const harness = await createCanvasGenerateHarness()

  const models = ['nano-banana-2', 'nano-banana-pro', 'gpt-image-2']
  for (const modelId of models) {
    await harness.requestCanvasGenerate({
      modelId,
      prompt: 'make a product poster',
      aspectRatio: '1:1',
      resolution: '1k',
      referenceImages: [],
    })
  }

  assert.deepEqual(
    harness.calls.map((call) => call.url),
    [
      '/api/jobs/generate-direct',
      '/api/jobs/generate-direct',
      '/api/jobs/generate-direct',
    ],
  )
})
