import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importEntry(exportNames) {
  const outdir = await mkdtemp(path.join(tmpdir(), 'canvas-agent-generic-'))
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

test('legacy poster banner passthrough remains a generic agent image action', async () => {
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

    assert.equal(result.actions[0].creativeMode, 'image')
    assert.ok(!('promptStyle' in result.actions[0]))
    assert.ok(!('posterBrief' in result.actions[0]))
    assert.doesNotMatch(result.actions[0].prompt, /text-free visual base/)
    assert.doesNotMatch(result.actions[0].prompt, /no readable words/)
    assert.doesNotMatch(result.actions[0].prompt, /local typography overlays/)
  } finally {
    await cleanup()
  }
})
