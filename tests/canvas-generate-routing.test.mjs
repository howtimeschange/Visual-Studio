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
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    console,
  }
  const functionNames = [
    'shouldUseAsyncCanvasGenerate',
    'requestCanvasGenerate',
    'normalizeCanvasCreativeMode',
    'normalizeCanvasAgentActions',
    'normalizeCanvasAgentAction',
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

test('canvas agent action normalizer keeps multiple image prompts separate', async () => {
  const harness = await createCanvasGenerateHarness()

  const actions = harness.normalizeCanvasAgentActions({
    actions: [
      { type: 'generate_image', title: '家具城', prompt: '成龙在家具城打架' },
      { type: 'generate_image', title: '印度街舞', prompt: '成龙在印度跳街舞' },
    ],
  }, 'fallback', '1:1', '1k')

  assert.deepEqual(actions.map((action) => action.prompt), ['成龙在家具城打架', '成龙在印度跳街舞'])
  assert.deepEqual(actions.map((action) => action.title), ['家具城', '印度街舞'])
})

test('canvas agent action normalizer falls back to the raw user prompt only', async () => {
  const harness = await createCanvasGenerateHarness()

  const actions = harness.normalizeCanvasAgentActions({}, '黄仁勋在北京街头吃炸酱面', '1:1', '1k')

  assert.equal(actions.length, 1)
  assert.equal(actions[0].prompt, '黄仁勋在北京街头吃炸酱面')
})

test('legacy poster banner action metadata is stripped to a generic agent action', async () => {
  const harness = await createCanvasGenerateHarness()

  const actions = harness.normalizeCanvasAgentActions({
    actions: [{
      type: 'generate_image',
      title: '夏促 KV',
      prompt: 'text-free summer campaign visual base',
      aspectRatio: '16:9',
      resolution: '2k',
      creativeMode: 'poster_banner',
      promptStyle: 'visual_base',
      posterBrief: {
        headline: '夏促新品',
        subheadline: '轻盈上新',
        cta: '立即查看',
        badges: ['限时', '新品'],
        layout: 'right',
      },
    }],
  }, 'fallback', '1:1', '1k')

  assert.equal(actions[0].creativeMode, 'image')
  assert.ok(!('promptStyle' in actions[0]))
  assert.ok(!('posterBrief' in actions[0]))
})

test('canvas agent requests include uploaded reference image entries', async () => {
  const source = await readFile(APP_PATH, 'utf8')
  const blocks = [...source.matchAll(/postJson\('\/api\/canvas\/agent', \{[\s\S]*?\n\s*\}\)/g)]
    .map((match) => match[0])

  assert.equal(blocks.length, 2)
  for (const block of blocks) {
    assert.match(block, /referenceImages:\s*refImages/)
    assert.match(block, /hasReferenceImages:\s*refImages\.length > 0/)
  }
})
