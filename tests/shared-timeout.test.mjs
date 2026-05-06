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

test('callImageModel aborts a hung upstream request instead of waiting forever', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => new Promise(() => {})

  try {
    const started = Date.now()
    const result = await Promise.race([
      mod.callImageModel(
        'https://relay.example/v1',
        'test-key',
        'gemini-3.1-flash-image-preview',
        [],
        'make an image',
        { timeoutMs: 1000 },
      ),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 1500)),
    ])

    assert.notEqual(result, 'hung')
    assert.equal(result.ok, false)
    assert.equal(result.status, 504)
    assert.match(result.error, /timed out/i)
    assert.ok(Date.now() - started < 1500)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('image model options default to a longer generation timeout and two retries', async () => {
  const { mod, cleanup } = await importShared()

  try {
    const options = mod.resolveImageModelOptions('gpt-image-2', {}, {})

    assert.equal(options.timeoutMs, 600_000)
    assert.equal(options.retryCount, 2)
    assert.equal(options.retryDelayMs, 1_000)
  } finally {
    await cleanup()
  }
})
