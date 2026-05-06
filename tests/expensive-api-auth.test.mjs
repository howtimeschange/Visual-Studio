import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importEntry(entryPoint, exportNames = ['onRequestPost']) {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-auth-gate-'))
  await build({
    stdin: {
      contents: [
        ...exportNames.map((name) => `export { ${name} } from './${entryPoint}'`),
        "export { createJob } from './functions/_lib/v2-store.ts'",
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
    ['functions/api/jobs/translate-batch.ts', { assetIds: ['asset_1'], targetLanguages: ['ja'], clientKeys: { banana2ApiKey: 'key' } }],
    ['functions/api/jobs/outfit-batch.ts', { modelAssetIds: ['asset_1'], garments: [{ assetId: 'asset_2' }], clientKeys: { bananaProApiKey: 'key' } }],
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
