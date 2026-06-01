import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importResultsRoute() {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-results-route-'))
  await build({
    stdin: {
      contents: `
        export { onRequestGet } from './functions/api/results/[assetId].ts'
        export { createAsset, ensureSession } from './functions/_lib/v2-store.ts'
      `,
      resolveDir: process.cwd(),
      sourcefile: 'results-route-test-entry.mjs',
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'results-route.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'results-route.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

function createMemoryBucket(stats = {}) {
  const objects = new Map()
  stats.get = stats.get || 0
  stats.put = stats.put || 0
  stats.arrayBuffer = stats.arrayBuffer || 0
  return {
    async put(key, value, options = {}) {
      stats.put += 1
      const buffer = value instanceof ArrayBuffer
        ? value
        : await new Response(value).arrayBuffer()
      objects.set(key, {
        buffer,
        httpMetadata: options.httpMetadata || {},
      })
    },
    async get(key) {
      stats.get += 1
      const object = objects.get(key)
      if (!object) return null
      return {
        body: object.buffer.slice(0),
        httpMetadata: object.httpMetadata,
        arrayBuffer: async () => {
          stats.arrayBuffer += 1
          return object.buffer.slice(0)
        },
      }
    },
  }
}

test('results route streams R2 object bytes without data-url rehydration', async () => {
  const { mod, cleanup } = await importResultsRoute()
  const resultStats = {}
  const env = {
    VS_RESULTS_BUCKET: createMemoryBucket(resultStats),
  }

  try {
    const session = await mod.ensureSession(env, 'session-results-route', null)
    const asset = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'result',
      source: 'outfit_batch',
      filename: 'outfit.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    })

    const response = await mod.onRequestGet({
      env,
      params: { assetId: asset.id },
      request: new Request(`https://example.com/api/results/${asset.id}`),
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(response.headers.get('cache-control'), 'private, max-age=3600')
    assert.equal(resultStats.get, 1)
    assert.equal(resultStats.arrayBuffer, 0)
    assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), [137, 80, 78, 71, 13, 10, 26, 10])
  } finally {
    await cleanup()
  }
})
