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
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-runner-'))
  await build({
    stdin: {
      contents: `
        export * from './functions/_lib/v2-runner.ts'
        export {
          createJob,
          createJobItems,
          ensureSession,
          getJob,
          listJobItems,
        } from './functions/_lib/v2-store.ts'
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

test('recoverJobs fails a stale running batch item after its retry budget is exhausted', async () => {
  const { mod, cleanup } = await importRunner()
  const env = {}
  const staleStartedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

  try {
    const session = await mod.ensureSession(env, 'session_stale_recover', null)
    const job = await mod.createJob(env, {
      id: 'job_stale_recover',
      sessionId: session.id,
      userId: null,
      type: 'outfit_batch',
      status: 'running',
      configJson: { modelId: 'nano-banana-pro' },
      summaryJson: {},
      progressTotal: 1,
      progressDone: 0,
      progressFailed: 0,
    })
    const [item] = await mod.createJobItems(env, job.id, [{
      jobId: job.id,
      itemType: 'outfit_cell',
      status: 'running',
      inputJson: {},
      outputJson: {},
      attemptCount: 3,
      errorCode: null,
      errorMessage: null,
      startedAt: staleStartedAt,
      finishedAt: null,
    }])

    const recovered = await mod.recoverJobs(env, undefined)
    const nextJob = await mod.getJob(env, job.id)
    const [nextItem] = await mod.listJobItems(env, job.id)

    assert.equal(recovered.recovered, 0)
    assert.equal(nextJob.status, 'failed')
    assert.equal(nextJob.progressFailed, 1)
    assert.equal(nextItem.id, item.id)
    assert.equal(nextItem.status, 'failed')
    assert.equal(nextItem.errorCode, 'job_item_timeout')
    assert.match(nextItem.errorMessage, /timed out/i)
  } finally {
    await cleanup()
  }
})
