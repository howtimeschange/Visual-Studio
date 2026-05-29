import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importStyleTransfer(exportNames) {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-style-transfer-'))
  await build({
    stdin: {
      contents: exportNames.map((name) => `export { ${name} } from './functions/api/style-transfer.ts'`).join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'style-transfer-test-entry.mjs',
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

test('style JSON parser rejects empty model JSON instead of accepting an empty style', async () => {
  const { mod, cleanup } = await importStyleTransfer(['parseStyleJson'])
  try {
    assert.throws(
      () => mod.parseStyleJson('{}'),
      /Style analysis JSON is missing visual_style/,
    )
  } finally {
    await cleanup()
  }
})

test('style JSON parser keeps valid visual style payloads', async () => {
  const { mod, cleanup } = await importStyleTransfer(['parseStyleJson'])
  try {
    const parsed = mod.parseStyleJson(JSON.stringify({
      visual_style: {
        overall_concept: {
          theme: 'Soft catalog minimalism',
          keywords: ['soft', 'minimal'],
        },
        color_palette: {
          dominant_colors: [{ name: 'warm white', hex: '#F7F3EC' }],
          accent_colors: [{ name: 'ink', hex: '#1F2937' }],
          background_color: { name: 'paper', hex: '#FFFDF8' },
        },
        composition: {
          layout_type: 'centered',
          focal_point: 'product',
        },
        effects_and_textures: {
          lighting: { type: 'softbox' },
        },
        reproduction_prompt: {
          style_essence_en: 'Soft catalog minimalism with warm paper tones',
          style_essence_zh: '温暖纸感的极简商品目录风',
          style_tags: ['catalog', 'minimal'],
        },
      },
    }))

    assert.equal(parsed.visualStyle.overall_concept.theme, 'Soft catalog minimalism')
    assert.equal(parsed.styleSummary, '温暖纸感的极简商品目录风')
    assert.deepEqual(parsed.tags, ['catalog', 'minimal'])
    assert.equal(parsed.colorPalette.length, 3)
  } finally {
    await cleanup()
  }
})

test('style JSON parser unwraps nested style analysis payloads', async () => {
  const { mod, cleanup } = await importStyleTransfer(['parseStyleJson'])
  try {
    const parsed = mod.parseStyleJson(JSON.stringify({
      style_analysis: {
        visual_style: {
          overall_concept: {
            theme: 'Lightweight editorial fashion',
            keywords: ['editorial', 'airy'],
          },
          color_palette: {
            dominant_colors: [{ name: 'gallery white', hex: '#F8F8F6' }],
          },
          reproduction_prompt: {
            style_essence_en: 'Airy editorial fashion photography',
          },
        },
      },
    }))

    assert.equal(parsed.visualStyle.overall_concept.theme, 'Lightweight editorial fashion')
    assert.equal(parsed.colorPalette[0].hex, '#F8F8F6')
  } finally {
    await cleanup()
  }
})

test('style JSON parser accepts camelCase visualStyle wrappers', async () => {
  const { mod, cleanup } = await importStyleTransfer(['parseStyleJson'])
  try {
    const parsed = mod.parseStyleJson(JSON.stringify({
      result: {
        visualStyle: {
          overall_concept: {
            theme: 'Soft indoor portrait',
          },
          reproduction_prompt: {
            style_essence_zh: '柔和室内人像风格',
            style_tags: ['portrait', 'soft light'],
          },
        },
      },
    }))

    assert.equal(parsed.styleSummary, '柔和室内人像风格')
    assert.deepEqual(parsed.tags, ['portrait', 'soft light'])
  } finally {
    await cleanup()
  }
})

test('style JSON parser rejects empty visual_style payloads', async () => {
  const { mod, cleanup } = await importStyleTransfer(['parseStyleJson'])
  try {
    assert.throws(
      () => mod.parseStyleJson('{"visual_style":{}}'),
      /Style analysis JSON is missing/,
    )
  } finally {
    await cleanup()
  }
})
