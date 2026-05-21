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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function okTaskCreateResponse(taskId = 'task_123') {
  return jsonResponse({
    id: taskId,
    object: 'image.task',
    status: 'queued',
    poll_url: `https://relay.example/v1/images/tasks/${taskId}`,
    poll_after: 0,
  }, 202)
}

function okTaskResultResponse(base64) {
  return jsonResponse({
    id: 'task_123',
    object: 'image.task',
    status: 'succeeded',
    data: [{ b64_json: base64 }],
  })
}

test('gpt-image-2 text generation creates and polls an async image task', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    if (calls.length === 1) return okTaskCreateResponse()
    return okTaskResultResponse('ZmFrZS1pbWFnZQ==')
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
    assert.equal(calls.length, 2)
    assert.equal(calls[0].input, 'https://relay.example/v1/images/tasks')
    assert.equal(calls[0].init.method, 'POST')
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key')
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json')
    assert.equal(calls[1].input, 'https://relay.example/v1/images/tasks/task_123')
    assert.equal(calls[1].init.method, 'GET')
    assert.equal(calls[1].init.headers.Authorization, 'Bearer test-key')

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
    if (calls.length === 2) return okTaskCreateResponse()
    return okTaskResultResponse('cmV0cmllZC1pbWFnZQ==')
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
    assert.equal(calls.length, 3)
    assert.equal(calls[0].input, 'https://relay.example/v1/images/tasks')
    assert.equal(calls[1].input, 'https://relay.example/v1/images/tasks')
    assert.equal(calls[2].input, 'https://relay.example/v1/images/tasks/task_123')
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('gpt-image-2 retries relay bad_response_body 500 before succeeding', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    if (calls.length === 1) {
      return jsonResponse({
        error: {
          message: 'unexpected end of JSON input',
          type: 'bad_response_body',
          param: '',
          code: 'bad_response_body',
        },
      }, 500)
    }
    if (calls.length === 2) return okTaskCreateResponse()
    return okTaskResultResponse('cmVjb3ZlcmVkLWltYWdl')
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
    assert.equal(result.dataUrl, 'data:image/png;base64,cmVjb3ZlcmVkLWltYWdl')
    assert.equal(calls.length, 3)
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

test('gpt-image-2 image editing sends reference images in async task JSON', async () => {
  const { mod, cleanup } = await importShared()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    if (calls.length === 1) return okTaskCreateResponse()
    return okTaskResultResponse('ZWRpdGVkLWltYWdl')
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
    assert.equal(calls.length, 2)
    assert.equal(calls[0].input, 'https://relay.example/v1/images/tasks')
    assert.equal(calls[0].init.method, 'POST')
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key')
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json')

    const payload = JSON.parse(calls[0].init.body)
    assert.deepEqual(payload, {
      model: 'gpt-image-2',
      prompt: 'keep the product shape and change the background',
      n: 1,
      size: 'auto',
      quality: 'high',
      output_format: 'png',
      image: ['data:image/png;base64,cmVmLWltYWdl'],
    })
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
    if (calls.length === 1) return okTaskCreateResponse()
    return okTaskResultResponse('ZmFrZS00aw==')
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
    if (calls.length === 1) return okTaskCreateResponse()
    return okTaskResultResponse('ZWRpdC00aw==')
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
    if (calls.length === 1) return okTaskCreateResponse()
    return okTaskResultResponse('c3F1YXJlLTRr')
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
