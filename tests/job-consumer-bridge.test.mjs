import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importConsumer() {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-consumer-'))
  await build({
    stdin: {
      contents: `
        import worker from './workers/job-consumer.ts'
        export default worker
        export {
          createJob,
          createJobItems,
          ensureSession,
          getJob,
          listJobItems,
        } from './functions/_lib/v2-store.ts'
      `,
      resolveDir: process.cwd(),
      sourcefile: 'consumer-test-entry.mjs',
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'job-consumer.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'job-consumer.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

test('local queue bridge accepts queue messages and runs the consumer path in waitUntil', async () => {
  const { mod, cleanup } = await importConsumer()
  const env = { VS_LOCAL_QUEUE_BRIDGE: '1' }
  const background = []

  try {
    assert.equal(typeof mod.default.fetch, 'function')
    const session = await mod.ensureSession(env, 'session_consumer_bridge', null)
    const job = await mod.createJob(env, {
      id: 'job_consumer_bridge_paused',
      sessionId: session.id,
      userId: null,
      type: 'translate_batch',
      status: 'paused',
      configJson: {
        modelId: 'nano-banana-2',
        sourceLanguage: 'auto',
        targetLanguages: ['ja'],
        preserveBrand: true,
        concurrency: 1,
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

    const response = await mod.default.fetch(new Request('http://local.test/__queue/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'run_job', jobId: job.id, jobType: job.type, reason: 'submit' }),
    }), env, {
      waitUntil: (promise) => {
        background.push(promise)
      },
    })
    const payload = await response.json()
    await Promise.all(background)
    const stillPaused = await mod.getJob(env, job.id)
    const [item] = await mod.listJobItems(env, job.id)

    assert.equal(response.status, 200)
    assert.equal(payload.ok, true)
    assert.equal(payload.accepted, 1)
    assert.equal(payload.mode, 'background')
    assert.equal(payload.acked, 0)
    assert.equal(payload.retried, 0)
    assert.equal(background.length, 1)
    assert.equal(stillPaused.status, 'paused')
    assert.equal(item.status, 'queued')
    assert.equal(item.attemptCount, 0)
  } finally {
    await cleanup()
  }
})

test('queue consumer retries active running jobs instead of acknowledging them', async () => {
  const { mod, cleanup } = await importConsumer()
  const env = { VS_LOCAL_QUEUE_BRIDGE: '1', VS_JOB_ITEM_TIMEOUT_MS: '60000' }

  try {
    const session = await mod.ensureSession(env, 'session_consumer_running_retry', null)
    const job = await mod.createJob(env, {
      id: 'job_consumer_running_retry',
      sessionId: session.id,
      userId: null,
      type: 'outfit_batch',
      status: 'running',
      configJson: {
        modelId: 'nano-banana-2',
        concurrency: 1,
      },
      summaryJson: {},
      progressTotal: 1,
      progressDone: 0,
      progressFailed: 0,
    })
    await mod.createJobItems(env, job.id, [{
      jobId: job.id,
      itemType: 'outfit_cell',
      status: 'running',
      inputJson: {},
      outputJson: {},
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }])

    const response = await mod.default.fetch(new Request('http://local.test/__queue/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'run_job', jobId: job.id, jobType: job.type, reason: 'recover' }),
    }), env)
    const payload = await response.json()
    const stillRunning = await mod.getJob(env, job.id)

    assert.equal(response.status, 502)
    assert.equal(payload.ok, false)
    assert.equal(payload.accepted, 1)
    assert.equal(payload.acked, 0)
    assert.equal(payload.retried, 1)
    assert.equal(stillRunning.status, 'running')
  } finally {
    await cleanup()
  }
})

test('queue consumer scheduled handler recovers stale queued jobs', async () => {
  const { mod, cleanup } = await importConsumer()
  const sent = []
  const env = {
    VS_OUTFIT_JOBS_QUEUE: {
      send: async (message) => {
        sent.push(message)
      },
    },
  }

  try {
    const session = await mod.ensureSession(env, 'session_consumer_scheduled_recover', null)
    const job = await mod.createJob(env, {
      id: 'job_consumer_scheduled_recover',
      sessionId: session.id,
      userId: null,
      type: 'outfit_batch',
      status: 'queued',
      configJson: {
        modelId: 'nano-banana-2',
        concurrency: 1,
      },
      summaryJson: {},
      progressTotal: 1,
      progressDone: 0,
      progressFailed: 0,
    })
    await mod.createJobItems(env, job.id, [{
      jobId: job.id,
      itemType: 'outfit_cell',
      status: 'queued',
      inputJson: {},
      outputJson: {},
      attemptCount: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
    }])

    assert.equal(typeof mod.default.scheduled, 'function')
    await mod.default.scheduled({}, env)

    assert.equal(sent.length, 1)
    assert.equal(sent[0].jobId, job.id)
    assert.equal(sent[0].reason, 'recover')
  } finally {
    await cleanup()
  }
})

test('queue consumer scheduled handler preserves pending task poll delay', async () => {
  const { mod, cleanup } = await importConsumer()
  const sent = []
  const options = []
  const env = {
    VS_OUTFIT_JOBS_QUEUE: {
      send: async (message, opts) => {
        sent.push(message)
        options.push(opts || {})
      },
    },
  }

  try {
    const session = await mod.ensureSession(env, 'session_consumer_scheduled_delay', null)
    const job = await mod.createJob(env, {
      id: 'job_consumer_scheduled_delay',
      sessionId: session.id,
      userId: null,
      type: 'outfit_batch',
      status: 'queued',
      configJson: {
        modelId: 'nano-banana-2',
        concurrency: 1,
      },
      summaryJson: {},
      progressTotal: 1,
      progressDone: 0,
      progressFailed: 0,
    })
    await mod.createJobItems(env, job.id, [{
      jobId: job.id,
      itemType: 'outfit_cell',
      status: 'queued',
      inputJson: {},
      outputJson: {
        imageTask: {
          id: 'task_delayed_watchdog',
          status: 'running',
          poll_url: 'https://relay.example/v1/images/tasks/task_delayed_watchdog',
        },
        imageTaskStatus: 'running',
        nextPollAfterMs: 45_000,
      },
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
    }])

    await mod.default.scheduled({}, env)

    assert.equal(sent.length, 1)
    assert.equal(sent[0].jobId, job.id)
    assert.equal(sent[0].reason, 'recover')
    assert.equal(sent[0].delaySeconds, 45)
    assert.deepEqual(options[0], { delaySeconds: 45 })
  } finally {
    await cleanup()
  }
})
