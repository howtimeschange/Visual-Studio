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
    'inferPosterHeadline',
    'normalizeCanvasPosterLayout',
    'normalizeCanvasPosterBrief',
    'buildCanvasPosterBrief',
    'getDefaultPosterCopySafeArea',
    'getPosterAccentColor',
    'getPosterCompositionTheme',
    'getPosterCanvasOutputSize',
    'getPosterTextBox',
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

test('poster banner mode builds a local composition brief', async () => {
  const harness = await createCanvasGenerateHarness()

  const brief = harness.buildCanvasPosterBrief('夏促新品上市，限时 8 折', '16:9', '2k')

  assert.equal(brief.format, 'banner')
  assert.equal(brief.headline, '夏促新品上市')
  assert.equal(brief.layout, 'left')
  assert.equal(brief.copySafeArea, 'left 42%')
  assert.equal(brief.aspectRatio, '16:9')
  assert.equal(brief.resolution, '2k')
})

test('poster composition theme chooses domain-aware accent colors', async () => {
  const harness = await createCanvasGenerateHarness()

  assert.equal(harness.getPosterAccentColor({ sourceRequest: '黄仁勋 AI 芯片传记电影' }), '#5ee6a8')
  assert.equal(harness.getPosterAccentColor({ sourceRequest: '香港电影动作海报' }), '#ffad39')
  assert.equal(harness.getPosterAccentColor({ sourceRequest: '夏促新品 banner' }), '#ff7a45')

  const theme = harness.getPosterCompositionTheme({ format: 'poster', sourceRequest: '香港电影动作海报' }, 900, 1200)
  assert.equal(theme.accent, '#ffad39')
  assert.equal(theme.poster, true)
  assert.equal(theme.vertical, true)
  assert.equal(theme.meta, 'POSTER VISUAL')
})

test('poster banner action metadata survives normalization', async () => {
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

  assert.equal(actions[0].creativeMode, 'poster_banner')
  assert.equal(actions[0].promptStyle, 'visual_base')
  assert.equal(actions[0].posterBrief.headline, '夏促新品')
  assert.equal(actions[0].posterBrief.layout, 'right')
  assert.deepEqual(actions[0].posterBrief.badges, ['限时', '新品'])
})

test('poster output size scales by requested resolution', async () => {
  const harness = await createCanvasGenerateHarness()

  const wide = harness.getPosterCanvasOutputSize('16:9', '1k')
  assert.equal(wide.width, 1344)
  assert.equal(wide.height, 768)

  const vertical = harness.getPosterCanvasOutputSize('9:16', '2k')
  assert.equal(vertical.width, 1536)
  assert.equal(vertical.height, 2688)
})

test('bottom poster copy box starts below the main subject region', async () => {
  const harness = await createCanvasGenerateHarness()

  const box = harness.getPosterTextBox({ layout: 'bottom', aspectRatio: '3:4' }, 900, 1200)

  assert.equal(box.scrim, 'bottom')
  assert.equal(box.y, 768)
  assert.equal(box.height, 369)
  assert.equal(box.x, 63)
  assert.equal(box.width, 774)
})
