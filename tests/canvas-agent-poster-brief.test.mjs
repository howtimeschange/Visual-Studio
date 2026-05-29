import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importEntry(exportNames) {
  const outdir = await mkdtemp(path.join(tmpdir(), 'canvas-agent-poster-'))
  await build({
    stdin: {
      contents: exportNames.map((name) => `export { ${name} } from './functions/api/canvas/agent.ts'`).join('\n'),
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

test('default passthrough routes the raw request through style-aware prompting', async () => {
  const { mod, cleanup } = await importEntry(['buildPassthroughAgentResult'])
  try {
    const result = mod.buildPassthroughAgentResult({
      aspectRatio: '1:1',
      resolution: '1k',
    }, '黄仁勋在北京街头吃炸酱面')

    assert.match(result.prompt, /Create an image based on this request/)
    assert.match(result.prompt, /黄仁勋在北京街头吃炸酱面/)
    assert.match(result.actions[0].prompt, /Visual language:/)
    assert.equal(result.actions[0].creativeMode, 'image')
    assert.equal(result.needsClarification, false)
  } finally {
    await cleanup()
  }
})

test('poster banner passthrough creates a text-free visual base prompt and brief', async () => {
  const { mod, cleanup } = await importEntry(['buildPassthroughAgentResult'])
  try {
    const result = mod.buildPassthroughAgentResult({
      creativeMode: 'poster_banner',
      aspectRatio: '16:9',
      resolution: '2k',
      posterBrief: {
        headline: '夏促新品',
        subheadline: '轻盈上新',
        cta: '立即查看',
        badges: ['限时', '新品'],
        layout: 'right',
      },
    }, '生成一张夏促 banner')

    assert.equal(result.actions[0].creativeMode, 'poster_banner')
    assert.equal(result.actions[0].promptStyle, 'visual_base')
    assert.equal(result.actions[0].posterBrief.headline, '夏促新品')
    assert.match(result.actions[0].prompt, /text-free visual base/)
    assert.match(result.actions[0].prompt, /no readable words/)
    assert.match(result.actions[0].prompt, /Do not include signboards/)
    assert.match(result.actions[0].prompt, /one integrated hero image/)
    assert.match(result.actions[0].prompt, /not a puzzle, collage, grid/)
    assert.match(result.actions[0].prompt, /copy space/)
  } finally {
    await cleanup()
  }
})

test('poster banner hardening removes text-bearing visual surfaces', async () => {
  const { mod, cleanup } = await importEntry(['hardenPosterBannerBasePrompt'])
  try {
    const prompt = mod.hardenPosterBannerBasePrompt('neon-lit Hong Kong street cinema scene with screens, signboards and GPU chip labels')

    assert.doesNotMatch(prompt, /neon-lit Hong Kong street/)
    assert.doesNotMatch(prompt, /signboards and GPU chip labels/)
    assert.match(prompt, /Do not include signboards/)
    assert.match(prompt, /screen UI/)
    assert.match(prompt, /chip labels/)
    assert.match(prompt, /zero glyph-like strokes/)
    assert.match(prompt, /local compositor/)
    assert.match(prompt, /Unified poster\/banner composition rules/)
    assert.match(prompt, /Avoid split-screen/)
  } finally {
    await cleanup()
  }
})

test('poster banner prompt sanitizer rewrites sign-prone scene language', async () => {
  const { mod, cleanup } = await importEntry(['sanitizePosterBannerBasePrompt'])
  try {
    const prompt = mod.sanitizePosterBannerBasePrompt('A neon-lit Hong Kong street with neon signs, billboards, store signs, screen text, and chip labels.')

    assert.doesNotMatch(prompt, /neon-lit Hong Kong street/i)
    assert.doesNotMatch(prompt, /neon signs/i)
    assert.doesNotMatch(prompt, /billboards/i)
    assert.doesNotMatch(prompt, /store signs/i)
    assert.doesNotMatch(prompt, /screen text/i)
    assert.doesNotMatch(prompt, /chip labels/i)
    assert.match(prompt, /blank light panels/)
    assert.match(prompt, /abstract neon reflections/)
    assert.match(prompt, /unmarked chip surfaces/)
  } finally {
    await cleanup()
  }
})

test('poster banner composition rules reject collage-like output', async () => {
  const { mod, cleanup } = await importEntry(['getPosterBannerCompositionRules'])
  try {
    const rules = mod.getPosterBannerCompositionRules()

    assert.match(rules, /one integrated hero image/)
    assert.match(rules, /not a puzzle, collage, grid/)
    assert.match(rules, /one primary focal subject/)
    assert.match(rules, /reserved copy area calm/)
    assert.match(rules, /repeated portraits/)
  } finally {
    await cleanup()
  }
})

test('poster brief normalization clamps badges and invalid layout', async () => {
  const { mod, cleanup } = await importEntry(['normalizePosterBrief'])
  try {
    const brief = mod.normalizePosterBrief({
      aspectRatio: '9:16',
      resolution: '4k',
      headline: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890-extra',
      badges: ['one', 'two', 'three', 'four', 'five'],
      layout: 'diagonal',
    })

    assert.equal(brief.layout, 'bottom')
    assert.equal(brief.badges.length, 4)
    assert.equal(brief.headline.length, 36)
    assert.equal(brief.format, 'poster')
    assert.equal(brief.resolution, '4k')
  } finally {
    await cleanup()
  }
})
