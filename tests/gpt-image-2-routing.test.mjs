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

function okTaskResponse(base64, overrides = {}) {
  return new Response(JSON.stringify({ status: 'succeeded', data: [{ b64_json: base64 }], ...overrides }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('gpt-image-2 text generation creates an async image task', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return okTaskResponse('ZmFrZS1pbWFnZQ==')
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
    assert.equal(calls[0].input, 'https://relay.example/v1/images/tasks')
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

test('gpt-image-2 retries transient upstream errors before succeeding', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    if (calls.length === 1) {
      return new Response('gateway timeout', { status: 524 })
    }
    return okTaskResponse('cmV0cmllZC1pbWFnZQ==')
  }

  try {
    const result = await mod.callImageModel(
      'https://relay.example/v1',
      'test-key',
      'gpt-image-2',
      [],
      'make a clean product poster',
      { timeoutMs: 1000, retryDelayMs: 1 },
    )

    assert.equal(result.ok, true)
    assert.equal(result.dataUrl, 'data:image/png;base64,cmV0cmllZC1pbWFnZQ==')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].input, 'https://relay.example/v1/images/tasks')
    assert.equal(calls[1].input, 'https://relay.example/v1/images/tasks')
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('gpt-image-2 does not retry non-transient upstream errors', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return new Response('bad request', { status: 400 })
  }

  try {
    const result = await mod.callImageModel(
      'https://relay.example/v1',
      'test-key',
      'gpt-image-2',
      [],
      'make a clean product poster',
      { timeoutMs: 1000, retryDelayMs: 1 },
    )

    assert.equal(result.ok, false)
    assert.equal(result.status, 400)
    assert.match(result.error, /Upstream 400/)
    assert.equal(calls.length, 1)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('gpt-image-2 image editing sends reference images as async task data URLs', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return okTaskResponse('ZWRpdGVkLWltYWdl')
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
    assert.equal(calls[0].input, 'https://relay.example/v1/images/tasks')
    assert.equal(calls[0].init.method, 'POST')
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key')
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json')

    const payload = JSON.parse(calls[0].init.body)
    assert.equal(payload.model, 'gpt-image-2')
    assert.equal(payload.prompt, 'keep the product shape and change the background')
    assert.equal(payload.n, 1)
    assert.equal(payload.size, 'auto')
    assert.equal(payload.quality, 'high')
    assert.equal(payload.output_format, 'png')
    assert.deepEqual(payload.image, ['data:image/png;base64,cmVmLWltYWdl'])
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('gpt-image-2 maps existing 4k landscape config to a supported size', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return okTaskResponse('ZmFrZS00aw==')
  }

  try {
    const result = await mod.callImageModel(
      'https://relay.example/v1',
      'test-key',
      'gpt-image-2',
      [],
      'make a 4k widescreen campaign poster',
      { timeoutMs: 1000, aspectRatio: '16:9', resolution: '4k' },
    )

    assert.equal(result.ok, true)
    const payload = JSON.parse(calls[0].init.body)
    assert.equal(payload.size, '3840x2160')
    assert.equal(payload.quality, 'high')
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('gpt-image-2 maps existing 4k portrait config to a supported edit size', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return okTaskResponse('ZWRpdC00aw==')
  }

  try {
    const result = await mod.callImageModel(
      'https://relay.example/v1',
      'test-key',
      'gpt-image-2',
      [{ base64: 'cmVmLWltYWdl', mime: 'image/png' }],
      'extend this into a 4k vertical poster',
      { timeoutMs: 1000, aspectRatio: '9:16', resolution: '4k' },
    )

    assert.equal(result.ok, true)
    const payload = JSON.parse(calls[0].init.body)
    assert.equal(payload.size, '2160x3840')
    assert.equal(payload.quality, 'high')
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('gpt-image-2 keeps square 4k under the documented pixel limit', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return okTaskResponse('c3F1YXJlLTRr')
  }

  try {
    const result = await mod.callImageModel(
      'https://relay.example/v1',
      'test-key',
      'gpt-image-2',
      [],
      'make a square 4k product render',
      { timeoutMs: 1000, aspectRatio: '1:1', resolution: '4k' },
    )

    assert.equal(result.ok, true)
    const payload = JSON.parse(calls[0].init.body)
    assert.equal(payload.size, '2880x2880')
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('nano banana models also use async image tasks with data URL references', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return okTaskResponse('bmFuby1pbWFnZQ==')
  }

  try {
    const result = await mod.callImageModel(
      'https://relay.example/v1',
      'test-key',
      'gemini-3.1-flash-image-preview',
      [{ base64: 'cmVm', mime: 'image/jpeg' }],
      'place the garment on the model',
      { timeoutMs: 1000, aspectRatio: '3:4', resolution: '2k' },
    )

    assert.equal(result.ok, true)
    assert.equal(result.dataUrl, 'data:image/png;base64,bmFuby1pbWFnZQ==')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input, 'https://relay.example/v1/images/tasks')
    const payload = JSON.parse(calls[0].init.body)
    assert.deepEqual(payload, {
      model: 'gemini-3.1-flash-image-preview',
      prompt: 'place the garment on the model',
      n: 1,
      output_format: 'png',
      size: '3:4',
      quality: '2K',
      image: ['data:image/jpeg;base64,cmVm'],
    })
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('async image tasks poll until a stable result URL is available', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    if (String(input) === 'https://img.example/result.png') {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      })
    }
    if (String(input).endsWith('/images/tasks')) {
      return new Response(JSON.stringify({
        id: 'task_123',
        status: 'queued',
        poll_url: 'https://relay.example/v1/images/tasks/task_123',
        poll_after: 0,
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      status: 'succeeded',
      data: [{ url: 'https://img.example/result.png' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const result = await mod.callImageModel(
      'https://relay.example/v1',
      'test-key',
      'gpt-image-2',
      [],
      'make a clean product poster',
      { timeoutMs: 3000, imageFetchTimeoutMs: 1000 },
    )

    assert.equal(result.ok, true)
    assert.equal(result.dataUrl, 'data:image/png;base64,AQID')
    assert.equal(calls.length, 3)
    assert.equal(calls[1].input, 'https://relay.example/v1/images/tasks/task_123')
    assert.equal(calls[1].init.method, 'GET')
    assert.equal(calls[1].init.headers.Authorization, 'Bearer test-key')
    assert.equal(calls[2].input, 'https://img.example/result.png')
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('async image task rejects empty fetched image results', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input) === 'https://img.example/empty.png') {
      return new Response(new Uint8Array([]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      })
    }
    return new Response(JSON.stringify({
      status: 'succeeded',
      data: [{ url: 'https://img.example/empty.png' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const result = await mod.callImageModel(
      'https://relay.example/v1',
      'test-key',
      'gpt-image-2',
      [],
      'make a clean product poster',
      { timeoutMs: 3000, imageFetchTimeoutMs: 1000 },
    )

    assert.equal(result.ok, false)
    assert.equal(result.status, 502)
    assert.equal(result.error, 'Image result fetch returned an empty body.')
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('async image task extracts image URLs from result and output payloads', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    if (String(input) === 'https://img.example/result-from-task.png') {
      return new Response(new Uint8Array([4, 5, 6]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      })
    }
    return new Response(JSON.stringify({
      status: 'succeeded',
      result: {
        output: [{
          image_url: 'https://img.example/result-from-task.png',
        }],
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const result = await mod.callImageModel(
      'https://relay.example/v1',
      'test-key',
      'gpt-image-2',
      [],
      'make a clean product poster',
      { timeoutMs: 3000, imageFetchTimeoutMs: 1000 },
    )

    assert.equal(result.ok, true)
    assert.equal(result.dataUrl, 'data:image/png;base64,BAUG')
    assert.deepEqual(calls, [
      'https://relay.example/v1/images/tasks',
      'https://img.example/result-from-task.png',
    ])
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('async image task rejects unsupported image result sources', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: 'succeeded',
    data: [{ url: '/relative-result.png' }],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  try {
    const result = await mod.callImageModel(
      'https://relay.example/v1',
      'test-key',
      'gpt-image-2',
      [],
      'make a clean product poster',
      { timeoutMs: 3000, imageFetchTimeoutMs: 1000 },
    )

    assert.equal(result.ok, false)
    assert.equal(result.status, 502)
    assert.match(result.error, /unsupported image source/i)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('async image task reports result fetch failures with upstream status', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input) === 'https://img.example/forbidden.png') {
      return new Response(JSON.stringify({ error: { message: 'signed URL expired' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      status: 'succeeded',
      data: [{ url: 'https://img.example/forbidden.png' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const result = await mod.callImageModel(
      'https://relay.example/v1',
      'test-key',
      'gpt-image-2',
      [],
      'make a clean product poster',
      { timeoutMs: 3000, imageFetchTimeoutMs: 1000 },
    )

    assert.equal(result.ok, false)
    assert.equal(result.status, 502)
    assert.match(result.error, /result fetch failed/i)
    assert.match(result.error, /403/)
    assert.match(result.error, /signed URL expired/)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})
