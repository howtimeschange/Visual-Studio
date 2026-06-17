import assert from 'node:assert/strict'
import { webcrypto, createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importEntry(entryPoint, exportNames = ['onRequestPost']) {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto
  }
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-auth-gate-'))
  await build({
    stdin: {
      contents: [
        ...exportNames.map((name) => `export { ${name} } from './${entryPoint}'`),
        "export { createAuthSession, createAsset, createJob, createUser, ensureSession, getAssetDataUrl, getJob, listJobItems } from './functions/_lib/v2-store.ts'",
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

function jsonPost(body = {}) {
  return new Request('https://example.com/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function createAuthedEnv(mod, env = {}) {
  const token = `token-${Date.now()}-${Math.random()}`
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const user = await mod.createUser(env, {
    email: `tester-${Date.now()}-${Math.random()}@example.com`,
    name: 'Tester',
    passwordHash: 'hash',
    passwordSalt: 'salt',
  })
  await mod.createAuthSession(env, {
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  })
  return {
    env,
    headers: {
      Cookie: `vs_auth=${encodeURIComponent(token)}`,
      'Content-Type': 'application/json',
    },
    user,
  }
}

async function assertLoginRequired(response) {
  assert.equal(response.status, 401)
  const body = await response.json()
  assert.equal(body.error, 'Login required')
  if ('status' in body) assert.equal(body.status, 401)
}

test('expensive POST APIs require a logged-in user before spending upstream calls', async () => {
  const originalFetch = globalThis.fetch
  const targets = [
    ['functions/api/translate.ts', { imageBase64: 'abc', targetLanguage: 'ja', clientKeys: { banana2ApiKey: 'key' } }],
    ['functions/api/generate.ts', { userMessage: 'make a poster', clientKeys: { banana2ApiKey: 'key' } }],
    ['functions/api/generate-direct.ts', { prompt: 'make a poster', clientKeys: { banana2ApiKey: 'key' } }],
    ['functions/api/style-transfer.ts', { action: 'analyze', assetId: 'asset_1', clientKeys: { visionApiKey: 'key' } }],
    ['functions/api/outfit-swap.ts', {
      model: { base64: 'model' },
      garment: { base64: 'garment' },
      clientKeys: { bananaProApiKey: 'key' },
    }],
    ['functions/api/jobs/generate-turn.ts', { userMessage: 'make a poster', clientKeys: { banana2ApiKey: 'key' } }],
    ['functions/api/jobs/generate-direct.ts', { prompt: 'make a 4k poster', clientKeys: { gptImageApiKey: 'key' } }],
    ['functions/api/jobs/translate-batch.ts', { assetIds: ['asset_1'], targetLanguages: ['ja'], clientKeys: { banana2ApiKey: 'key' } }],
    ['functions/api/jobs/outfit-batch.ts', { modelAssetIds: ['asset_1'], garments: [{ assetId: 'asset_2' }], clientKeys: { bananaProApiKey: 'key' } }],
    ['functions/api/jobs/style-transfer-batch.ts', {
      sourceAssetId: 'asset_1',
      visualStyle: { overall_concept: { theme: 'catalog' } },
      subjects: [{ subjectAssetIds: ['asset_2'] }],
      clientKeys: { banana2ApiKey: 'key' },
    }],
    ['functions/api/jobs/ai-test-batch.ts', {
      images: [{ assetId: 'asset_1' }],
      count: 1,
      clientKeys: { gptImageApiKey: 'key' },
    }],
    ['functions/api/jobs/recover.ts', {}],
  ]

  globalThis.fetch = async () => {
    throw new Error('upstream fetch should not be called before auth')
  }

  try {
    for (const [entryPoint, body] of targets) {
      const { mod, cleanup } = await importEntry(entryPoint)
      try {
        await assertLoginRequired(await mod.onRequestPost({
          request: jsonPost(body),
          env: {},
          params: {},
          waitUntil: () => {},
        }))
      } finally {
        await cleanup()
      }
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('style-transfer generate returns a pending task instead of synchronously waiting for completion', async () => {
  const { mod, cleanup } = await importEntry('functions/api/style-transfer.ts')
  const originalFetch = globalThis.fetch
  const calls = []
  const env = { VS_IMAGE_REQUEST_TIMEOUT_MS: '1000' }

  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return new Response(JSON.stringify({
      id: 'task_style_pending_1',
      status: 'queued',
      poll_url: 'https://relay.example/v1/images/tasks/task_style_pending_1',
      poll_after: 1,
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const auth = await createAuthedEnv(mod, env)
    const session = await mod.ensureSession(env, 'session_style_pending', auth.user.id)
    const source = await mod.createAsset(env, {
      sessionId: session.id,
      userId: auth.user.id,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,c3R5bGU=',
      filename: 'style.png',
    })

    const response = await mod.onRequestPost({
      request: new Request('https://example.com/api/style-transfer', {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({
          action: 'generate',
          sessionId: session.id,
          assetId: source.id,
          visualStyle: {
            reproduction_prompt: { style_essence_en: 'muted studio editorial lighting' },
            overall_concept: { theme: 'editorial' },
          },
          subject: 'catalog dress',
          modelId: 'nano-banana-2',
          existingTask: null,
          maxPollAttempts: 0,
          clientKeys: { banana2ApiKey: 'image-key' },
        }),
      }),
      env,
      params: {},
      waitUntil: () => {},
    })

    const body = await response.json()
    assert.equal(response.status, 202)
    assert.equal(body.pending, true)
    assert.equal(body.task.status, 'queued')
    assert.equal(body.pollUrl, 'https://relay.example/v1/images/tasks/task_style_pending_1')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input, 'https://api.1xm.ai/v1/images/tasks')
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('job detail routes require login even when legacy anonymous jobs exist', async () => {
  const { mod, cleanup } = await importEntry('functions/api/jobs/[jobId].ts', ['onRequestGet', 'onRequestDelete'])
  try {
    const env = {}
    const storedJob = {
      id: 'job_auth_gate',
      sessionId: 'session_auth_gate',
      userId: null,
      type: 'translate_batch',
      status: 'queued',
      configJson: {},
      summaryJson: {},
      progressTotal: 1,
      progressDone: 0,
      progressFailed: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await mod.createJob(env, storedJob)

    const getResponse = await mod.onRequestGet({
      request: new Request('https://example.com/api/jobs/job_auth_gate'),
      env,
      params: { jobId: 'job_auth_gate' },
    })
    await assertLoginRequired(getResponse)

    const deleteResponse = await mod.onRequestDelete({
      request: new Request('https://example.com/api/jobs/job_auth_gate', { method: 'DELETE' }),
      env,
      params: { jobId: 'job_auth_gate' },
    })
    await assertLoginRequired(deleteResponse)
  } finally {
    await cleanup()
  }
})

test('job mutation routes require login even when legacy anonymous jobs exist', async () => {
  const targets = [
    ['functions/api/jobs/[jobId]/cancel.ts', 'onRequestPost'],
    ['functions/api/jobs/[jobId]/pause.ts', 'onRequestPost'],
    ['functions/api/jobs/[jobId]/resume.ts', 'onRequestPost'],
    ['functions/api/jobs/[jobId]/retry.ts', 'onRequestPost'],
    ['functions/api/jobs/[jobId]/items.ts', 'onRequestGet'],
    ['functions/api/jobs/[jobId]/items/[itemId]/retry.ts', 'onRequestPost'],
  ]

  for (const [entryPoint, handlerName] of targets) {
    const { mod, cleanup } = await importEntry(entryPoint, [handlerName])
    try {
      const env = {}
      await mod.createJob(env, {
        id: 'job_auth_gate',
        sessionId: 'session_auth_gate',
        userId: null,
        type: 'translate_batch',
        status: 'queued',
        configJson: {},
        summaryJson: {},
        progressTotal: 1,
        progressDone: 0,
        progressFailed: 0,
      })

      const response = await mod[handlerName]({
        request: new Request('https://example.com/api/jobs/job_auth_gate', { method: handlerName === 'onRequestGet' ? 'GET' : 'POST' }),
        env,
        params: { jobId: 'job_auth_gate', itemId: 'item_auth_gate' },
        waitUntil: () => {},
      })
      await assertLoginRequired(response)
    } finally {
      await cleanup()
    }
  }
})
