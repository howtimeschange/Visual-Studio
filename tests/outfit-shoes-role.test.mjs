import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importOutfitLooks() {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-outfit-looks-'))
  await build({
    entryPoints: ['packages/core/outfit-looks.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'outfit-looks.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'outfit-looks.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

async function importOutfitSwap() {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-outfit-swap-'))
  await build({
    entryPoints: ['functions/api/outfit-swap.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'outfit-swap.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'outfit-swap.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

function okImageResponse(base64) {
  return new Response(JSON.stringify({ data: [{ b64_json: base64 }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('buildOutfitLooks layers shoes onto base garment looks', async () => {
  const { mod, cleanup } = await importOutfitLooks()

  try {
    const looks = mod.buildOutfitLooks([
      { id: 'top-1', role: 'top' },
      { id: 'bottom-1', role: 'bottom' },
      { id: 'shoes-1', role: 'shoes' },
    ])

    assert.deepEqual(looks.map((look) => look.id), [
      'top-1+bottom-1',
      'top-1+bottom-1+shoes-1',
    ])
    assert.deepEqual(looks[1].roles, ['top', 'bottom', 'shoes'])
  } finally {
    await cleanup()
  }
})

test('buildOutfitLooks uses shoes as the base before accessory-only looks', async () => {
  const { mod, cleanup } = await importOutfitLooks()

  try {
    const looks = mod.buildOutfitLooks([
      { id: 'shoes-1', role: 'shoes' },
      { id: 'bag-1', role: 'accessory' },
    ])

    assert.deepEqual(looks.map((look) => look.id), [
      'shoes-1',
      'shoes-1+bag-1',
    ])
    assert.deepEqual(looks[1].roles, ['shoes', 'accessory'])
  } finally {
    await cleanup()
  }
})

test('executeOutfitSwap describes shoes in the prompt sent to the image model', async () => {
  const { mod, cleanup } = await importOutfitSwap()
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return okImageResponse('c2hvZXMtcmVzdWx0')
  }

  try {
    const result = await mod.executeOutfitSwap({
      modelId: 'gpt-image-2',
      model: { base64: 'bW9kZWw=', mime: 'image/png' },
      garments: [{ base64: 'c2hvZXM=', mime: 'image/png', role: 'shoes', label: 'loafer.png' }],
      clientKeys: { gptImageApiKey: 'test-key' },
    }, {})

    assert.equal(result.resultDataUrl, 'data:image/png;base64,c2hvZXMtcmVzdWx0')
    assert.equal(calls.length, 1)
    const form = calls[0].init.body
    const prompt = form.get('prompt')

    assert.match(prompt, /Image #2: GARMENT role: shoes/i)
    assert.match(prompt, /shoes should be placed on the feet/i)
    assert.match(prompt, /soles/i)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})
