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

test('local queue bridge runs the queue consumer path and acknowledges skipped paused jobs', async () => {
  const { mod, cleanup } = await importConsumer()
  const env = { VS_LOCAL_QUEUE_BRIDGE: '1' }

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
    }), env)
    const payload = await response.json()
    const stillPaused = await mod.getJob(env, job.id)
    const [item] = await mod.listJobItems(env, job.id)

    assert.equal(response.status, 200)
    assert.equal(payload.ok, true)
    assert.equal(payload.acked, 1)
    assert.equal(payload.retried, 0)
    assert.equal(stillPaused.status, 'paused')
    assert.equal(item.status, 'queued')
    assert.equal(item.attemptCount, 0)
  } finally {
    await cleanup()
  }
})
