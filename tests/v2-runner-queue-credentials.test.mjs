import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importRunner() {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto
  }
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-runner-queue-'))
  await build({
    stdin: {
      contents: `
        export * from './functions/_lib/v2-runner.ts'
        export {
          createAsset,
          createJob,
          createJobItems,
          createSealedCredential,
          ensureSession,
          getJob,
          getSealedCredential,
          listJobItems,
        } from './functions/_lib/v2-store.ts'
        export { sealJson, unsealJson } from './packages/core/crypto.ts'
      `,
      resolveDir: process.cwd(),
      sourcefile: 'test-entry.mjs',
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'v2-runner.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'v2-runner.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

test('submitTranslateBatch seals queued job credentials with the worker-shared job secret', async () => {
  const { mod, cleanup } = await importRunner()
  const sent = []
  const env = {
    CREDENTIAL_KEK: 'pages-only-account-secret',
    VS_JOB_CREDENTIAL_KEK: 'shared-job-secret',
    VS_TRANSLATE_JOBS_QUEUE: {
      send: async (message) => {
        sent.push(message)
      },
    },
  }

  try {
    const submitted = await mod.submitTranslateBatch(env, {
      sessionId: 'session_job_secret',
      assetIds: ['asset_for_later'],
      targetLanguages: ['ja'],
      clientKeys: { banana2ApiKey: 'job-api-key' },
    })
    const job = await mod.getJob(env, submitted.jobId)
    const credential = await mod.getSealedCredential(env, String(job.configJson.sealedCredentialId))

    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0].clientKeys, { banana2ApiKey: 'job-api-key' })
    await assert.rejects(
      () => mod.unsealJson(credential.ciphertext, env.CREDENTIAL_KEK),
      /decrypt|operation failed|operation-specific/i,
    )
    assert.deepEqual(
      await mod.unsealJson(credential.ciphertext, env.VS_JOB_CREDENTIAL_KEK),
      { banana2ApiKey: 'job-api-key' },
    )
  } finally {
    await cleanup()
  }
})

test('submitOutfitBatch stores per-garment instructions on each queued look item', async () => {
  const { mod, cleanup } = await importRunner()
  const env = {
    VS_OUTFIT_JOBS_QUEUE: {
      send: async () => {},
    },
  }

  try {
    const submitted = await mod.submitOutfitBatch(env, {
      sessionId: 'session_outfit_instructions',
      modelAssetIds: ['model_1'],
      modelId: 'gpt-image-2',
      garments: [
        {
          assetId: 'top_1',
          role: 'top',
          label: 'top.png',
          instructions: 'Make the collar more structured.',
        },
        {
          assetId: 'bottom_1',
          role: 'bottom',
          label: 'bottom.png',
          instructions: 'Keep the skirt knee-length.',
        },
      ],
      concurrency: 1,
    })

    const [item] = await mod.listJobItems(env, submitted.jobId)
    const job = await mod.getJob(env, submitted.jobId)

    assert.deepEqual(item.inputJson.lookAssetIds, ['top_1', 'bottom_1'])
    assert.deepEqual(item.inputJson.lookInstructions, [
      'Make the collar more structured.',
      'Keep the skirt knee-length.',
    ])
    assert.equal(
      job.configJson.garmentFingerprint,
      'bottom_1:bottom:Keep the skirt knee-length.|top_1:top:Make the collar more structured.',
    )
  } finally {
    await cleanup()
  }
})

test('runQueuedJob fails a queued job instead of leaving it pending when setup crashes', async () => {
  const { mod, cleanup } = await importRunner()
  const env = { VS_JOB_CREDENTIAL_KEK: 'shared-job-secret' }

  try {
    const session = await mod.ensureSession(env, 'session_bad_credential', null)
    const credential = await mod.createSealedCredential(
      env,
      'job_bad_credential',
      'not-a-valid-sealed-payload',
      new Date(Date.now() + 60_000).toISOString(),
    )
    const job = await mod.createJob(env, {
      id: 'job_bad_credential',
      sessionId: session.id,
      userId: null,
      type: 'translate_batch',
      status: 'queued',
      configJson: {
        modelId: 'nano-banana-2',
        sourceLanguage: 'auto',
        targetLanguages: ['ja'],
        preserveBrand: true,
        sealedCredentialId: credential.id,
      },
      summaryJson: {},
      progressTotal: 1,
      progressDone: 0,
      progressFailed: 0,
    })
    await mod.createJobItems(env, job.id, [{
      jobId: job.id,
      itemType: 'translate_cell',
      status: 'queued',
      inputJson: { assetId: 'asset_missing', targetLanguage: 'ja' },
      outputJson: {},
      attemptCount: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
    }])

    const result = await mod.runQueuedJob(env, job.id)
    const nextJob = await mod.getJob(env, job.id)
    const [nextItem] = await mod.listJobItems(env, job.id)

    assert.equal(result.status, 'failed')
    assert.equal(nextJob.status, 'failed')
    assert.equal(nextJob.progressFailed, 1)
    assert.equal(nextItem.status, 'failed')
    assert.equal(nextItem.errorCode, 'job_setup_failed')
    assert.match(nextItem.errorMessage, /invalid sealed payload|decrypt/i)
  } finally {
    await cleanup()
  }
})

test('runQueuedJob can decrypt job credentials that were sealed with the account secret during rollout', async () => {
  const { mod, cleanup } = await importRunner()
  const submitEnv = { CREDENTIAL_KEK: 'legacy-account-secret' }
  const workerEnv = {
    CREDENTIAL_KEK: 'legacy-account-secret',
    VS_JOB_CREDENTIAL_KEK: 'shared-job-secret',
  }

  try {
    const session = await mod.ensureSession(workerEnv, 'session_legacy_job_secret', null)
    const asset = await mod.createAsset(workerEnv, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,ZmFrZQ==',
      filename: 'asset.png',
    })
    const ciphertext = await mod.sealJson({ banana2ApiKey: 'job-api-key' }, submitEnv.CREDENTIAL_KEK)
    const credential = await mod.createSealedCredential(
      workerEnv,
      'job_legacy_job_secret',
      ciphertext,
      new Date(Date.now() + 60_000).toISOString(),
    )
    const job = await mod.createJob(workerEnv, {
      id: 'job_legacy_job_secret',
      sessionId: session.id,
      userId: null,
      type: 'translate_batch',
      status: 'queued',
      configJson: {
        modelId: 'nano-banana-2',
        sourceLanguage: 'auto',
        targetLanguages: ['ja'],
        preserveBrand: true,
        concurrency: 1,
        assetIds: [asset.id],
        sealedCredentialId: credential.id,
      },
      summaryJson: {},
      progressTotal: 1,
      progressDone: 0,
      progressFailed: 0,
    })
    await mod.createJobItems(workerEnv, job.id, [{
      jobId: job.id,
      itemType: 'translate_cell',
      status: 'queued',
      inputJson: { assetId: asset.id, targetLanguage: 'ja' },
      outputJson: {},
      attemptCount: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
    }])

    const originalFetch = globalThis.fetch
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({
      choices: [{
        message: {
          content: [{
            type: 'output_text',
            text: 'mocked image relay response',
          }],
        },
      }],
      data: [{ b64_json: 'ZmFrZQ==' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    try {
      const result = await mod.runQueuedJob(workerEnv, job.id)
      const nextJob = await mod.getJob(workerEnv, job.id)
      const [nextItem] = await mod.listJobItems(workerEnv, job.id)

      assert.equal(result.status, 'completed')
      assert.equal(nextJob.status, 'completed')
      assert.equal(nextItem.status, 'completed')
    } finally {
      globalThis.fetch = originalFetch
    }
  } finally {
    await cleanup()
  }
})

test('runQueuedJob prefers queue message client keys over an unreadable sealed credential', async () => {
  const { mod, cleanup } = await importRunner()
  const env = { VS_JOB_CREDENTIAL_KEK: 'shared-job-secret' }

  try {
    const session = await mod.ensureSession(env, 'session_inline_client_keys', null)
    const asset = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,ZmFrZQ==',
      filename: 'asset.png',
    })
    const credential = await mod.createSealedCredential(
      env,
      'job_inline_client_keys',
      'not-a-valid-sealed-payload',
      new Date(Date.now() + 60_000).toISOString(),
    )
    const job = await mod.createJob(env, {
      id: 'job_inline_client_keys',
      sessionId: session.id,
      userId: null,
      type: 'translate_batch',
      status: 'queued',
      configJson: {
        modelId: 'nano-banana-2',
        sourceLanguage: 'auto',
        targetLanguages: ['ja'],
        preserveBrand: true,
        concurrency: 1,
        assetIds: [asset.id],
        sealedCredentialId: credential.id,
      },
      summaryJson: {},
      progressTotal: 1,
      progressDone: 0,
      progressFailed: 0,
    })
    await mod.createJobItems(env, job.id, [{
      jobId: job.id,
      itemType: 'translate_cell',
      status: 'queued',
      inputJson: { assetId: asset.id, targetLanguage: 'ja' },
      outputJson: {},
      attemptCount: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
    }])

    const originalFetch = globalThis.fetch
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({
      choices: [{
        message: {
          content: [{
            type: 'output_text',
            text: 'mocked image relay response',
          }],
        },
      }],
      data: [{ b64_json: 'ZmFrZQ==' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    try {
      const result = await mod.runQueuedJob(env, job.id, { banana2ApiKey: 'job-api-key' })
      const nextJob = await mod.getJob(env, job.id)
      const [nextItem] = await mod.listJobItems(env, job.id)

      assert.equal(result.status, 'completed')
      assert.equal(nextJob.status, 'completed')
      assert.equal(nextItem.status, 'completed')
    } finally {
      globalThis.fetch = originalFetch
    }
  } finally {
    await cleanup()
  }
})
