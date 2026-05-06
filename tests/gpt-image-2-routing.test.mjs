import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importShared() {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-shared-'))
  await build({
    entryPoints: ['functions/_shared.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'shared.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'shared.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

function okImageResponse(base64) {
  return new Response(JSON.stringify({ data: [{ b64_json: base64 }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('gpt-image-2 text generation uses /images/generations', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return okImageResponse('ZmFrZS1pbWFnZQ==')
  }

  try {
    const result = await mod.callImageModel(
      'https://relay.example/v1',
      'test-key',
      'gpt-image-2',
      [],
      'make a clean product poster',
      { timeoutMs: 1000 },
    )

    assert.equal(result.ok, true)
    assert.equal(result.dataUrl, 'data:image/png;base64,ZmFrZS1pbWFnZQ==')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input, 'https://relay.example/v1/images/generations')
    assert.equal(calls[0].init.method, 'POST')
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key')
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json')

    const payload = JSON.parse(calls[0].init.body)
    assert.deepEqual(payload, {
      model: 'gpt-image-2',
      prompt: 'make a clean product poster',
      n: 1,
      size: 'auto',
      quality: 'high',
      output_format: 'png',
    })
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('gpt-image-2 image editing sends reference images as multipart form data', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return okImageResponse('ZWRpdGVkLWltYWdl')
  }

  try {
    const result = await mod.callImageModel(
      'https://relay.example/v1',
      'test-key',
      'gpt-image-2',
      [{ base64: 'cmVmLWltYWdl', mime: 'image/png' }],
      'keep the product shape and change the background',
      { timeoutMs: 1000 },
    )

    assert.equal(result.ok, true)
    assert.equal(result.dataUrl, 'data:image/png;base64,ZWRpdGVkLWltYWdl')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input, 'https://relay.example/v1/images/edits')
    assert.equal(calls[0].init.method, 'POST')
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key')
    assert.equal(calls[0].init.headers['Content-Type'], undefined)

    const form = calls[0].init.body
    assert.equal(form.get('model'), 'gpt-image-2')
    assert.equal(form.get('prompt'), 'keep the product shape and change the background')
    assert.equal(form.get('n'), '1')
    assert.equal(form.get('size'), 'auto')
    assert.equal(form.get('quality'), 'high')
    assert.equal(form.get('output_format'), 'png')

    const uploaded = form.getAll('image[]')
    assert.equal(uploaded.length, 1)
    assert.equal(uploaded[0].type, 'image/png')
    assert.equal(uploaded[0].name, 'reference-1.png')
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})
