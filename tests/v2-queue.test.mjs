import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importQueue() {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-queue-'))
  await build({
    entryPoints: ['functions/_lib/v2-queue.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'v2-queue.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'v2-queue.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

test('dispatchQueuedJob uses a bound queue by default', async () => {
  const { mod, cleanup } = await importQueue()
  const sent = []
  let fallbackCalled = false

  try {
    const mode = await mod.dispatchQueuedJob(
      {
        VS_OUTFIT_JOBS_QUEUE: {
          send: async (message) => {
            sent.push(message)
          },
        },
      },
      (promise) => {
        throw new Error('waitUntil should not be used when a queue binding exists')
      },
      mod.createJobQueueMessage({
        jobId: 'job_test',
        jobType: 'outfit_batch',
        reason: 'submit',
      }),
      async () => {
        fallbackCalled = true
      },
    )

    assert.equal(mode, 'queue')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].jobId, 'job_test')
    assert.equal(fallbackCalled, false)
  } finally {
    await cleanup()
  }
})

test('dispatchQueuedJob routes translate and outfit jobs to their dedicated queues', async () => {
  const { mod, cleanup } = await importQueue()
  const translateSent = []
  const outfitSent = []

  try {
    const translateMode = await mod.dispatchQueuedJob(
      {
        VS_TRANSLATE_JOBS_QUEUE: {
          send: async (message) => {
            translateSent.push(message)
          },
        },
        VS_OUTFIT_JOBS_QUEUE: {
          send: async (message) => {
            outfitSent.push(message)
          },
        },
      },
      undefined,
      mod.createJobQueueMessage({
        jobId: 'job_translate',
        jobType: 'translate_batch',
        reason: 'submit',
      }),
      async () => {},
    )

    const outfitMode = await mod.dispatchQueuedJob(
      {
        VS_TRANSLATE_JOBS_QUEUE: {
          send: async (message) => {
            translateSent.push(message)
          },
        },
        VS_OUTFIT_JOBS_QUEUE: {
          send: async (message) => {
            outfitSent.push(message)
          },
        },
      },
      undefined,
      mod.createJobQueueMessage({
        jobId: 'job_outfit',
        jobType: 'outfit_batch',
        reason: 'submit',
      }),
      async () => {},
    )

    assert.equal(translateMode, 'queue')
    assert.equal(outfitMode, 'queue')
    assert.deepEqual(translateSent.map((item) => item.jobId), ['job_translate'])
    assert.deepEqual(outfitSent.map((item) => item.jobId), ['job_outfit'])
  } finally {
    await cleanup()
  }
})
