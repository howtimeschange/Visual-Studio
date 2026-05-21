import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importCanvasAgent() {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-canvas-agent-'))
  await build({
    stdin: {
      contents: [
        "export { buildFallbackAgentResult, normalizeAgentResult } from './functions/api/canvas/agent.ts'",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'test-entry.mjs',
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'entry.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'entry.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

test('normalizes style intent and clarification without generating', async () => {
  const { mod, cleanup } = await importCanvasAgent()
  try {
    const fallback = mod.buildFallbackAgentResult({ aspectRatio: '1:1', resolution: '1k' }, '生成一张活动图')
    const result = mod.normalizeAgentResult({
      reply: '你想走哪种视觉风格？',
      shouldGenerate: true,
      needsClarification: true,
      prompt: 'this should be ignored',
      mode: 'generate',
      steps: ['判断需求', '追问风格'],
      suggestions: ['做成杂志摄影风格的活动图', '做成扁平插画风格的活动图'],
      styleIntent: {
        category: 'campaign_poster',
        medium: 'undecided',
        visualLanguage: 'needs user choice',
        reason: '用户没有指定视觉风格',
      },
    }, fallback)

    assert.equal(result.needsClarification, true)
    assert.equal(result.shouldGenerate, false)
    assert.equal(result.prompt, '')
    assert.deepEqual(result.suggestions, ['做成杂志摄影风格的活动图', '做成扁平插画风格的活动图'])
    assert.deepEqual(result.styleIntent, {
      category: 'campaign_poster',
      medium: 'undecided',
      visualLanguage: 'needs user choice',
      reason: '用户没有指定视觉风格',
    })
  } finally {
    await cleanup()
  }
})

test('normalization keeps fallback prompt when generated agent omits prompt', async () => {
  const { mod, cleanup } = await importCanvasAgent()
  try {
    const fallback = mod.buildFallbackAgentResult({ aspectRatio: '16:9', resolution: '2k' }, '做一张咖啡新品海报')
    const result = mod.normalizeAgentResult({
      reply: '我会按活动海报版式方向来做。',
      shouldGenerate: true,
      prompt: '',
      mode: 'generate',
    }, fallback)

    assert.equal(result.shouldGenerate, true)
    assert.equal(result.prompt, fallback.prompt)
  } finally {
    await cleanup()
  }
})

test('fallback routes campaign posters without ecommerce default styling', async () => {
  const { mod, cleanup } = await importCanvasAgent()
  try {
    const result = mod.buildFallbackAgentResult({ aspectRatio: '16:9', resolution: '2k' }, '做一张咖啡新品海报')

    assert.equal(result.shouldGenerate, true)
    assert.equal(result.needsClarification, false)
    assert.match(result.prompt, /campaign poster|graphic layout/i)
    assert.doesNotMatch(result.prompt, /ecommerce-ready styling/i)
    assert.doesNotMatch(result.prompt, /polished ecommerce/i)
    assert.equal(result.styleIntent.category, 'campaign_poster')
  } finally {
    await cleanup()
  }
})

test('fallback routes playful children requests to illustration', async () => {
  const { mod, cleanup } = await importCanvasAgent()
  try {
    const result = mod.buildFallbackAgentResult({ aspectRatio: '3:4', resolution: '1k' }, '儿童节活动插画')

    assert.equal(result.shouldGenerate, true)
    assert.match(result.prompt, /illustration/i)
    assert.match(result.prompt, /playful visual language/i)
    assert.equal(result.styleIntent.medium, 'illustration')
  } finally {
    await cleanup()
  }
})

test('fallback uses ecommerce only for explicit product main image requests', async () => {
  const { mod, cleanup } = await importCanvasAgent()
  try {
    const result = mod.buildFallbackAgentResult({ aspectRatio: '1:1', resolution: '1k' }, '白底电商主图')

    assert.equal(result.shouldGenerate, true)
    assert.match(result.prompt, /ecommerce product visual/i)
    assert.equal(result.styleIntent.category, 'ecommerce_product')
  } finally {
    await cleanup()
  }
})

test('fallback routes 3D material requests to render language', async () => {
  const { mod, cleanup } = await importCanvasAgent()
  try {
    const result = mod.buildFallbackAgentResult({ aspectRatio: '4:3', resolution: '2k' }, '3D 质感香水广告')

    assert.equal(result.shouldGenerate, true)
    assert.match(result.prompt, /3D render/i)
    assert.match(result.prompt, /material/i)
    assert.equal(result.styleIntent.medium, '3d_render')
  } finally {
    await cleanup()
  }
})
