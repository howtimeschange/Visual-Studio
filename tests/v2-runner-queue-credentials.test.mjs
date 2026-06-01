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
          getAssetDataUrl,
          getJob,
          getSealedCredential,
          listEvents,
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

function createMemoryBucket(stats = {}) {
  const objects = new Map()
  stats.get = stats.get || 0
  stats.put = stats.put || 0
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
        httpMetadata: object.httpMetadata,
        arrayBuffer: async () => object.buffer,
      }
    },
  }
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

test('batch submit defaults use gpt image 2 for translation and async image concurrency 10', async () => {
  const { mod, cleanup } = await importRunner()
  const env = {
    VS_TRANSLATE_JOBS_QUEUE: {
      send: async () => {},
    },
    VS_OUTFIT_JOBS_QUEUE: {
      send: async () => {},
    },
  }

  try {
    const translate = await mod.submitTranslateBatch(env, {
      sessionId: 'session_batch_defaults',
      assetIds: ['source_1'],
      targetLanguages: ['ja'],
    })
    const outfit = await mod.submitOutfitBatch(env, {
      sessionId: 'session_batch_defaults',
      modelAssetIds: ['model_1'],
      garments: [{
        assetId: 'garment_1',
        role: 'top',
        label: 'top.png',
      }],
    })
    const translateJob = await mod.getJob(env, translate.jobId)
    const outfitJob = await mod.getJob(env, outfit.jobId)

    assert.equal(translateJob.configJson.modelId, 'gpt-image-2')
    assert.equal(translateJob.configJson.concurrency, 10)
    assert.equal(outfitJob.configJson.modelId, 'nano-banana-2')
    assert.equal(outfitJob.configJson.concurrency, 10)
  } finally {
    await cleanup()
  }
})

test('batch submit clamps async image concurrency to 10 for every image model', async () => {
  const { mod, cleanup } = await importRunner()
  const env = {
    VS_TRANSLATE_JOBS_QUEUE: {
      send: async () => {},
    },
    VS_OUTFIT_JOBS_QUEUE: {
      send: async () => {},
    },
  }
  const models = ['nano-banana-2', 'nano-banana-pro', 'gpt-image-2']

  try {
    for (const modelId of models) {
      const translate = await mod.submitTranslateBatch(env, {
        sessionId: `session_translate_${modelId}`,
        assetIds: ['source_1'],
        targetLanguages: ['ja'],
        modelId,
        concurrency: 999,
      })
      const outfit = await mod.submitOutfitBatch(env, {
        sessionId: `session_outfit_${modelId}`,
        modelAssetIds: ['model_1'],
        modelId,
        garments: [{
          assetId: 'garment_1',
          role: 'top',
          label: 'top.png',
        }],
        concurrency: 999,
      })
      const translateJob = await mod.getJob(env, translate.jobId)
      const outfitJob = await mod.getJob(env, outfit.jobId)

      assert.equal(translateJob.configJson.modelId, modelId)
      assert.equal(translateJob.configJson.concurrency, 10)
      assert.equal(outfitJob.configJson.modelId, modelId)
      assert.equal(outfitJob.configJson.concurrency, 10)
    }
  } finally {
    await cleanup()
  }
})

test('submitTranslateBatch stores uploaded font reference fields and treats removed preset as match original', async () => {
  const { mod, cleanup } = await importRunner()
  const env = {
    VS_TRANSLATE_JOBS_QUEUE: {
      send: async () => {},
    },
  }

  try {
    const reference = await mod.submitTranslateBatch(env, {
      sessionId: 'session_translate_font_config',
      assetIds: ['source_1'],
      targetLanguages: ['th'],
      fontMode: 'reference',
      fontReferenceAssetId: 'font_ref_1',
      fontPrompt: 'Use the rounded headline letterforms from the reference.',
    })
    const removedPreset = await mod.submitTranslateBatch(env, {
      sessionId: 'session_translate_font_config',
      assetIds: ['source_1'],
      targetLanguages: ['th'],
      fontMode: 'preset',
      fontFamily: 'Kanit',
      fontReferenceAssetId: 'font_ref_1',
      fontPrompt: 'Use the rounded headline letterforms from the reference.',
    })

    const referenceJob = await mod.getJob(env, reference.jobId)
    const removedPresetJob = await mod.getJob(env, removedPreset.jobId)

    assert.equal(referenceJob.configJson.fontMode, 'reference')
    assert.equal(referenceJob.configJson.fontFamily, '')
    assert.equal(referenceJob.configJson.fontReferenceAssetId, 'font_ref_1')
    assert.equal(referenceJob.configJson.fontPrompt, 'Use the rounded headline letterforms from the reference.')
    assert.equal(removedPresetJob.configJson.fontMode, 'match_original')
    assert.equal(removedPresetJob.configJson.fontFamily, '')
    assert.equal(removedPresetJob.configJson.fontReferenceAssetId, '')
    assert.equal(removedPresetJob.configJson.fontPrompt, '')
    assert.notEqual(referenceJob.configJson.configHash, removedPresetJob.configJson.configHash)
  } finally {
    await cleanup()
  }
})

test('submitStyleTransferBatch queues one style item per subject and seals credentials', async () => {
  const { mod, cleanup } = await importRunner()
  const sent = []
  const env = {
    VS_JOB_CREDENTIAL_KEK: 'shared-style-secret',
    VS_JOBS_QUEUE: {
      send: async (message) => {
        sent.push(message)
      },
    },
  }

  try {
    const visualStyle = {
      overall_concept: { theme: 'Soft catalog' },
      reproduction_prompt: { style_essence_en: 'soft catalog lighting' },
    }
    const submitted = await mod.submitStyleTransferBatch(env, {
      sessionId: 'session_style_batch_submit',
      sourceAssetId: 'style_source_asset',
      visualStyle,
      subjects: [
        { subject: '红色手袋', subjectAssetIds: ['bag_asset'], label: 'bag.png' },
        { subject: '白色运动鞋', subjectAssetIds: ['shoe_asset'], label: 'shoe.png' },
      ],
      modelId: 'nano-banana-2',
      concurrency: 999,
      clientKeys: { banana2ApiKey: 'style-key' },
    })

    const job = await mod.getJob(env, submitted.jobId)
    const items = await mod.listJobItems(env, submitted.jobId)
    const credential = await mod.getSealedCredential(env, String(job.configJson.sealedCredentialId))

    assert.equal(submitted.itemCount, 2)
    assert.equal(job.type, 'style_transfer_batch')
    assert.equal(job.progressTotal, 2)
    assert.equal(job.configJson.modelId, 'nano-banana-2')
    assert.equal(job.configJson.concurrency, 10)
    assert.equal(job.configJson.sourceAssetId, 'style_source_asset')
    assert.deepEqual(job.configJson.visualStyle, visualStyle)
    assert.equal(items[0].itemType, 'style_transfer_cell')
    assert.deepEqual(items.map((item) => item.inputJson.subject), ['红色手袋', '白色运动鞋'])
    assert.deepEqual(items.map((item) => item.inputJson.subjectAssetIds), [['bag_asset'], ['shoe_asset']])
    assert.equal(sent.length, 1)
    assert.equal(sent[0].jobType, 'style_transfer_batch')
    assert.deepEqual(
      await mod.unsealJson(credential.ciphertext, env.VS_JOB_CREDENTIAL_KEK),
      { banana2ApiKey: 'style-key' },
    )
  } finally {
    await cleanup()
  }
})

test('runStyleTransferBatchJob stores completed style transfer results', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const calls = []
  const env = {
    VS_JOBS_QUEUE: {
      send: async () => {},
    },
  }

  globalThis.fetch = async (input, init = {}) => {
    const payload = JSON.parse(String(init.body || '{}'))
    calls.push({ input: String(input), payload })
    return new Response(JSON.stringify({ status: 'succeeded', data: [{ b64_json: 'c3R5bGUtYmF0Y2gtcmVzdWx0' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const session = await mod.ensureSession(env, 'session_style_batch_run', null)
    const source = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,c3R5bGUtc291cmNl',
      filename: 'style.png',
    })
    const subject = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'reference',
      source: 'test',
      dataUrl: 'data:image/png;base64,c3ViamVjdA==',
      filename: 'subject.png',
    })
    const submitted = await mod.submitStyleTransferBatch(env, {
      sessionId: session.id,
      sourceAssetId: source.id,
      visualStyle: {
        overall_concept: { theme: 'Soft catalog' },
        reproduction_prompt: { style_essence_en: 'soft catalog lighting' },
      },
      subjects: [{ subject: '手袋', subjectAssetIds: [subject.id], label: 'subject.png' }],
      modelId: 'nano-banana-2',
      clientKeys: { banana2ApiKey: 'style-key' },
    })

    await mod.runQueuedJob(env, submitted.jobId)

    const job = await mod.getJob(env, submitted.jobId)
    const [item] = await mod.listJobItems(env, submitted.jobId)
    const resultDataUrl = await mod.getAssetDataUrl(env, String(item.outputJson.resultAssetId))

    assert.equal(job.status, 'completed')
    assert.equal(item.status, 'completed')
    assert.equal(item.outputJson.subject, '手袋')
    assert.equal(resultDataUrl, 'data:image/png;base64,c3R5bGUtYmF0Y2gtcmVzdWx0')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].payload.image.length, 2)
    assert.match(calls[0].payload.prompt, /STYLE SOURCE/i)
    assert.match(calls[0].payload.prompt, /SUBJECT REFERENCE/i)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('runTranslateBatchJob sends uploaded font reference as Image 2 with scoped prompt instructions', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const calls = []
  const env = {
    VS_TRANSLATE_JOBS_QUEUE: {
      send: async () => {},
    },
  }

  globalThis.fetch = async (input, init = {}) => {
    const payload = JSON.parse(String(init.body || '{}'))
    calls.push({ input: String(input), payload })
    return new Response(JSON.stringify({ status: 'succeeded', data: [{ b64_json: 'dHJhbnNsYXRlZC1pbWFnZQ==' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const session = await mod.ensureSession(env, 'session_translate_font_reference', null)
    const source = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,c291cmNlLWltYWdl',
      filename: 'source.png',
    })
    const fontReference = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'reference',
      source: 'translate_font_reference',
      dataUrl: 'data:image/png;base64,Zm9udC1yZWZlcmVuY2U=',
      filename: 'kanit-sample.png',
    })
    const submitted = await mod.submitTranslateBatch(env, {
      sessionId: session.id,
      assetIds: [source.id],
      targetLanguages: ['th'],
      modelId: 'nano-banana-2',
      fontMode: 'reference',
      fontReferenceAssetId: fontReference.id,
      fontPrompt: 'Match the rounded Kanit headline sample.',
      clientKeys: {
        banana2ApiKey: 'image-key',
      },
    })

    await mod.runQueuedJob(env, submitted.jobId)

    const job = await mod.getJob(env, submitted.jobId)
    const [call] = calls
    const images = Array.isArray(call.payload.image) ? call.payload.image : []
    const prompt = call.payload.prompt || ''

    assert.equal(job.status, 'completed')
    assert.equal(images.length, 2)
    assert.equal(images[0], 'data:image/png;base64,c291cmNlLWltYWdl')
    assert.equal(images[1], 'data:image/png;base64,Zm9udC1yZWZlcmVuY2U=')
    assert.match(prompt, /Image #1 is the source image/i)
    assert.match(prompt, /Image #2 is a font reference/i)
    assert.match(prompt, /only for typography/i)
    assert.match(prompt, /Match the rounded Kanit headline sample/)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('runTranslateBatchJob passes source asset dimensions so font references cannot change orientation', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const prompts = []
  const env = {
    VS_TRANSLATE_JOBS_QUEUE: {
      send: async () => {},
    },
  }

  globalThis.fetch = async (input, init = {}) => {
    const payload = JSON.parse(String(init.body || '{}'))
    const prompt = payload.prompt || ''
    prompts.push(prompt)
    return new Response(JSON.stringify({ status: 'succeeded', data: [{ b64_json: 'dHJhbnNsYXRlZC1pbWFnZQ==' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const session = await mod.ensureSession(env, 'session_translate_source_dimensions', null)
    const source = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/jpeg;base64,c291cmNlLWltYWdl',
      filename: 'source.jpg',
      width: 790,
      height: 1914,
    })
    const fontReference = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'reference',
      source: 'translate_font_reference',
      dataUrl: 'data:image/png;base64,Zm9udC1yZWZlcmVuY2U=',
      filename: 'wide-font-sample.png',
      width: 1598,
      height: 466,
    })
    const submitted = await mod.submitTranslateBatch(env, {
      sessionId: session.id,
      assetIds: [source.id],
      targetLanguages: ['en'],
      modelId: 'nano-banana-2',
      fontMode: 'reference',
      fontReferenceAssetId: fontReference.id,
      clientKeys: {
        banana2ApiKey: 'image-key',
      },
    })

    await mod.runQueuedJob(env, submitted.jobId)

    assert.match(prompts[0], /790\s*x\s*1914/i)
    assert.match(prompts[0], /portrait/i)
    assert.match(prompts[0], /Do NOT use Image #2's landscape orientation/i)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('runTranslateBatchJob reuses one OCR plan and one asset read per source image', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const inputStats = {}
  const resultStats = {}
  let visionCalls = 0
  let imageCalls = 0
  const env = {
    VS_INPUTS_BUCKET: createMemoryBucket(inputStats),
    VS_RESULTS_BUCKET: createMemoryBucket(resultStats),
    VS_TRANSLATE_JOBS_QUEUE: {
      send: async () => {},
    },
  }

  globalThis.fetch = async (input, init = {}) => {
    const payload = JSON.parse(String(init.body || '{}'))
    if (payload.model === 'gemini-3-flash-preview') {
      visionCalls += 1
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              sourceLang: 'zh',
              textCount: 1,
              keepCount: 0,
              translateCount: 1,
              texts: [{
                index: 1,
                original: '你好',
                translation: 'こんにちは',
                translations: {
                  ja: 'こんにちは',
                  ko: '안녕하세요',
                },
                keep: false,
                position: 'center',
                size: 'large',
                style: 'normal',
              }],
            }),
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    imageCalls += 1
    const image = Buffer.from(`translated-${imageCalls}`).toString('base64')
    return new Response(JSON.stringify({ status: 'succeeded', data: [{ b64_json: image }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const session = await mod.ensureSession(env, 'session_translate_plan_cache', null)
    const asset = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,c291cmNlLWltYWdl',
      filename: 'source.png',
    })
    const submitted = await mod.submitTranslateBatch(env, {
      sessionId: session.id,
      assetIds: [asset.id],
      targetLanguages: ['ja', 'ko'],
      modelId: 'nano-banana-2',
      concurrency: 2,
      clientKeys: {
        banana2ApiKey: 'image-key',
        visionApiKey: 'vision-key',
      },
    })

    await mod.runQueuedJob(env, submitted.jobId)

    const job = await mod.getJob(env, submitted.jobId)
    const items = await mod.listJobItems(env, submitted.jobId)

    assert.equal(job.status, 'completed')
    assert.deepEqual(items.map((item) => item.status), ['completed', 'completed'])
    assert.equal(visionCalls, 2)
    assert.equal(imageCalls, 2)
    assert.equal(inputStats.get, 1)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('runTranslateBatchJob processes at most 10 queued items per queue invocation by default', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const sent = []
  let imageCalls = 0
  const env = {
    VS_INPUTS_BUCKET: createMemoryBucket(),
    VS_RESULTS_BUCKET: createMemoryBucket(),
    VS_TRANSLATE_JOBS_QUEUE: {
      send: async (message) => {
        sent.push(message)
      },
    },
  }

  globalThis.fetch = async () => {
    imageCalls += 1
    const image = Buffer.from(`translated-${imageCalls}`).toString('base64')
    return new Response(JSON.stringify({ status: 'succeeded', data: [{ b64_json: image }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const session = await mod.ensureSession(env, 'session_translate_items_per_run_default', null)
    const assets = []
    for (let index = 0; index < 11; index += 1) {
      assets.push(await mod.createAsset(env, {
        sessionId: session.id,
        userId: null,
        kind: 'upload',
        source: 'test',
        dataUrl: `data:image/png;base64,${Buffer.from(`source-${index}`).toString('base64')}`,
        filename: `source-${index}.png`,
      }))
    }
    const submitted = await mod.submitTranslateBatch(env, {
      sessionId: session.id,
      assetIds: assets.map((asset) => asset.id),
      targetLanguages: ['ja'],
      modelId: 'nano-banana-2',
      clientKeys: {
        banana2ApiKey: 'image-key',
      },
    })

    assert.equal(sent.length, 1)
    await mod.runQueuedJob(env, submitted.jobId)

    let job = await mod.getJob(env, submitted.jobId)
    let items = await mod.listJobItems(env, submitted.jobId)
    assert.equal(job.status, 'queued')
    assert.equal(items.filter((item) => item.status === 'completed').length, 10)
    assert.equal(items.filter((item) => item.status === 'queued').length, 1)
    assert.equal(imageCalls, 10)
    assert.equal(sent.length, 2)

    await mod.runQueuedJob(env, submitted.jobId)

    job = await mod.getJob(env, submitted.jobId)
    items = await mod.listJobItems(env, submitted.jobId)
    assert.equal(job.status, 'completed')
    assert.equal(items.filter((item) => item.status === 'completed').length, 11)
    assert.equal(imageCalls, 11)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('submitGenerateDirectJob queues 4k canvas generation and runner stores the result asset', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const sent = []
  const calls = []
  const env = {
    VS_JOBS_QUEUE: {
      send: async (message) => {
        sent.push(message)
      },
    },
  }

  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    return new Response(JSON.stringify({ status: 'succeeded', data: [{ b64_json: 'YXN5bmMtNGstaW1hZ2U=' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const submitted = await mod.submitGenerateDirectJob(env, {
      sessionId: 'session_canvas_direct_async',
      modelId: 'gpt-image-2',
      prompt: 'make a 4k widescreen campaign poster',
      aspectRatio: '16:9',
      resolution: '4k',
      clientKeys: { gptImageApiKey: 'job-gpt-image-key' },
    })

    assert.equal(submitted.sessionId, 'session_canvas_direct_async')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].jobId, submitted.jobId)
    assert.equal(sent[0].jobType, 'generate_batch')

    await mod.runQueuedJob(env, submitted.jobId)

    const job = await mod.getJob(env, submitted.jobId)
    const [item] = await mod.listJobItems(env, submitted.jobId)
    const payload = JSON.parse(calls[0].init.body)

    assert.equal(job.status, 'completed')
    assert.equal(item.status, 'completed')
    assert.equal(payload.size, '3840x2160')
    assert.equal(payload.quality, 'high')
    assert.equal(Boolean(item.outputJson.resultAssetId), true)
    assert.equal(
      await mod.getAssetDataUrl(env, String(item.outputJson.resultAssetId)),
      'data:image/png;base64,YXN5bmMtNGstaW1hZ2U=',
    )
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('runGenerateBatchJob resumes a pending image task across queue invocations', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const sent = []
  const calls = []
  const env = {
    VS_GENERATE_TASK_MAX_POLLS_PER_RUN: '1',
    VS_JOBS_QUEUE: {
      send: async (message) => {
        sent.push(message)
      },
    },
  }

  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    if (String(input).endsWith('/images/tasks') && init.method === 'POST') {
      return new Response(JSON.stringify({
        id: 'task_resume_1',
        status: 'queued',
        poll_url: 'https://relay.example/v1/images/tasks/task_resume_1',
        poll_after: 0,
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (calls.filter((call) => String(call.input).includes('task_resume_1')).length === 1) {
      return new Response(JSON.stringify({
        id: 'task_resume_1',
        status: 'running',
        poll_url: 'https://relay.example/v1/images/tasks/task_resume_1',
        poll_after: 0,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      id: 'task_resume_1',
      status: 'succeeded',
      data: [{ b64_json: 'cmVzdW1lZC1pbWFnZQ==' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const submitted = await mod.submitGenerateDirectJob(env, {
      sessionId: 'session_canvas_direct_resume',
      modelId: 'gpt-image-2',
      prompt: 'make a long running campaign poster',
      aspectRatio: '16:9',
      resolution: '4k',
      clientKeys: { gptImageApiKey: 'job-gpt-image-key' },
    })

    assert.equal(sent.length, 1)
    await mod.runQueuedJob(env, submitted.jobId)

    let job = await mod.getJob(env, submitted.jobId)
    let [item] = await mod.listJobItems(env, submitted.jobId)
    assert.equal(job.status, 'queued')
    assert.equal(item.status, 'queued')
    assert.equal(item.outputJson.imageTaskStatus, 'running')
    assert.equal(sent.length, 2)

    await mod.runQueuedJob(env, submitted.jobId)

    job = await mod.getJob(env, submitted.jobId)
    ;[item] = await mod.listJobItems(env, submitted.jobId)
    assert.equal(job.status, 'completed')
    assert.equal(item.status, 'completed')
    assert.equal(calls.filter((call) => String(call.input).endsWith('/images/tasks') && call.init.method === 'POST').length, 1)
    assert.equal(
      await mod.getAssetDataUrl(env, String(item.outputJson.resultAssetId)),
      'data:image/png;base64,cmVzdW1lZC1pbWFnZQ==',
    )
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('runQueuedJob claims a generate batch item once under duplicate delivery', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  let imageCalls = 0
  let releaseFetch
  let markFetchStarted
  const fetchGate = new Promise((resolve) => {
    releaseFetch = resolve
  })
  const fetchStarted = new Promise((resolve) => {
    markFetchStarted = resolve
  })
  const env = {
    VS_JOBS_QUEUE: {
      send: async () => {},
    },
  }

  globalThis.fetch = async () => {
    imageCalls += 1
    markFetchStarted()
    await fetchGate
    return new Response(JSON.stringify({ status: 'succeeded', data: [{ b64_json: 'ZHVwLWNsYWlt' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const submitted = await mod.submitGenerateDirectJob(env, {
      sessionId: 'session_generate_claim_once',
      modelId: 'gpt-image-2',
      prompt: 'make a campaign poster',
      aspectRatio: '1:1',
      resolution: '2k',
      clientKeys: { gptImageApiKey: 'job-gpt-image-key' },
    })

    const first = mod.runQueuedJob(env, submitted.jobId)
    await fetchStarted
    const second = await mod.runQueuedJob(env, submitted.jobId)
    releaseFetch()
    const firstResult = await first

    const job = await mod.getJob(env, submitted.jobId)
    const [item] = await mod.listJobItems(env, submitted.jobId)

    assert.equal(firstResult.status, 'completed')
    assert.equal(second.skipped, true)
    assert.equal(job.status, 'completed')
    assert.equal(item.status, 'completed')
    assert.equal(imageCalls, 1)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('retryJob supports failed generate batch jobs', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const env = {
    VS_JOBS_QUEUE: {
      send: async () => {},
    },
  }
  let shouldFail = true

  globalThis.fetch = async () => {
    if (shouldFail) {
      return new Response(JSON.stringify({ error: { message: 'temporary upstream outage' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ status: 'succeeded', data: [{ b64_json: 'cmV0cnktZ2VuZXJhdGU=' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const submitted = await mod.submitGenerateDirectJob(env, {
      sessionId: 'session_generate_retry',
      modelId: 'gpt-image-2',
      prompt: 'make a retryable campaign poster',
      aspectRatio: '1:1',
      resolution: '2k',
      clientKeys: { gptImageApiKey: 'job-gpt-image-key' },
    })

    await mod.runQueuedJob(env, submitted.jobId)
    let job = await mod.getJob(env, submitted.jobId)
    let [item] = await mod.listJobItems(env, submitted.jobId)
    assert.equal(job.status, 'failed')
    assert.equal(item.status, 'failed')
    assert.ok(await mod.getSealedCredential(env, String(job.configJson.sealedCredentialId)))

    shouldFail = false
    await mod.retryJob(env, submitted.jobId)
    await mod.runQueuedJob(env, submitted.jobId)

    job = await mod.getJob(env, submitted.jobId)
    ;[item] = await mod.listJobItems(env, submitted.jobId)
    assert.equal(job.status, 'completed')
    assert.equal(item.status, 'completed')
    assert.equal(await mod.getSealedCredential(env, String(job.configJson.sealedCredentialId)), null)
    assert.equal(
      await mod.getAssetDataUrl(env, String(item.outputJson.resultAssetId)),
      'data:image/png;base64,cmV0cnktZ2VuZXJhdGU=',
    )
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('runOutfitBatchJob reuses outfit analysis and asset reads for duplicate model look items', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const inputStats = {}
  const resultStats = {}
  let visionCalls = 0
  let imageCalls = 0
  const env = {
    VS_OUTFIT_ITEMS_PER_RUN: '2',
    VS_INPUTS_BUCKET: createMemoryBucket(inputStats),
    VS_RESULTS_BUCKET: createMemoryBucket(resultStats),
    VS_OUTFIT_JOBS_QUEUE: {
      send: async () => {},
    },
  }

  globalThis.fetch = async (input, init = {}) => {
    const payload = JSON.parse(String(init.body || '{}'))
    if (payload.model === 'gemini-3-flash-preview') {
      visionCalls += 1
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              model: {
                framing: 'full-body',
                pose: 'standing',
                background: 'studio',
                lighting: 'soft',
              },
              garments: [{
                index: 2,
                role: 'top',
                category: 'shirt',
                colors: ['white'],
                keyDetails: ['collar'],
              }],
            }),
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    imageCalls += 1
    const image = Buffer.from(`outfit-${imageCalls}`).toString('base64')
    return new Response(JSON.stringify({ status: 'succeeded', data: [{ b64_json: image }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const session = await mod.ensureSession(env, 'session_outfit_analysis_cache', null)
    const model = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,bW9kZWw=',
      filename: 'model.png',
    })
    const top = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,dG9w',
      filename: 'top.png',
    })
    const submitted = await mod.submitOutfitBatch(env, {
      sessionId: session.id,
      modelAssetIds: [model.id, model.id],
      modelId: 'nano-banana-pro',
      garments: [{
        assetId: top.id,
        role: 'top',
        label: 'top.png',
      }],
      concurrency: 1,
      clientKeys: {
        bananaProApiKey: 'image-key',
        visionApiKey: 'vision-key',
      },
    })

    await mod.runQueuedJob(env, submitted.jobId)

    const job = await mod.getJob(env, submitted.jobId)
    const items = await mod.listJobItems(env, submitted.jobId)

    assert.equal(job.status, 'completed')
    assert.deepEqual(items.map((item) => item.status), ['completed', 'completed'])
    assert.equal(visionCalls, 1)
    assert.equal(imageCalls, 2)
    assert.equal(inputStats.get, 2)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('runOutfitBatchJob processes 10 queued items per queue invocation by default', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const sent = []
  let visionCalls = 0
  let imageCalls = 0
  const env = {
    VS_INPUTS_BUCKET: createMemoryBucket(),
    VS_RESULTS_BUCKET: createMemoryBucket(),
    VS_OUTFIT_JOBS_QUEUE: {
      send: async (message) => {
        sent.push(message)
      },
    },
  }

  globalThis.fetch = async (input, init = {}) => {
    const payload = JSON.parse(String(init.body || '{}'))
    if (payload.model === 'gemini-3-flash-preview') {
      visionCalls += 1
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              model: { framing: 'full-body', pose: 'standing' },
              garments: [{ index: 2, role: 'top', category: 'shirt' }],
            }),
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    imageCalls += 1
    const image = Buffer.from(`outfit-${imageCalls}`).toString('base64')
    return new Response(JSON.stringify({ status: 'succeeded', data: [{ b64_json: image }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const session = await mod.ensureSession(env, 'session_outfit_items_per_run_default', null)
    const model = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,bW9kZWw=',
      filename: 'model.png',
    })
    const garments = []
    for (let index = 0; index < 11; index += 1) {
      garments.push(await mod.createAsset(env, {
        sessionId: session.id,
        userId: null,
        kind: 'upload',
        source: 'test',
        dataUrl: `data:image/png;base64,${Buffer.from(`top-${index}`).toString('base64')}`,
        filename: `top-${index}.png`,
      }))
    }
    const submitted = await mod.submitOutfitBatch(env, {
      sessionId: session.id,
      modelAssetIds: [model.id],
      modelId: 'nano-banana-2',
      garments: garments.map((garment, index) => ({
        assetId: garment.id,
        role: 'top',
        label: `top-${index}.png`,
      })),
      clientKeys: {
        banana2ApiKey: 'image-key',
        visionApiKey: 'vision-key',
      },
    })

    assert.equal(sent.length, 1)
    await mod.runQueuedJob(env, submitted.jobId)

    let job = await mod.getJob(env, submitted.jobId)
    let items = await mod.listJobItems(env, submitted.jobId)
    assert.equal(job.status, 'queued')
    assert.equal(items.filter((item) => item.status === 'completed').length, 10)
    assert.equal(items.filter((item) => item.status === 'queued').length, 1)
    assert.equal(imageCalls, 10)
    assert.equal(sent.length, 2)

    await mod.runQueuedJob(env, submitted.jobId)

    job = await mod.getJob(env, submitted.jobId)
    items = await mod.listJobItems(env, submitted.jobId)
    assert.equal(job.status, 'completed')
    assert.equal(items.filter((item) => item.status === 'completed').length, 11)
    assert.equal(imageCalls, 11)
    assert.equal(visionCalls, 11)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('runOutfitBatchJob resumes a pending outfit image task across queue invocations', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const sent = []
  const calls = []
  const env = {
    VS_OUTFIT_TASK_MAX_POLLS_PER_RUN: '1',
    VS_INPUTS_BUCKET: createMemoryBucket(),
    VS_RESULTS_BUCKET: createMemoryBucket(),
    VS_OUTFIT_JOBS_QUEUE: {
      send: async (message) => {
        sent.push(message)
      },
    },
  }

  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    const payload = init.body ? JSON.parse(String(init.body || '{}')) : {}
    if (payload.model === 'gemini-3-flash-preview') {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              model: { framing: 'full-body', pose: 'standing' },
              garments: [{ index: 2, role: 'top', category: 'shirt' }],
            }),
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (String(input).endsWith('/images/tasks') && init.method === 'POST') {
      return new Response(JSON.stringify({
        id: 'task_outfit_resume_1',
        status: 'queued',
        poll_url: 'https://relay.example/v1/images/tasks/task_outfit_resume_1',
        poll_after: 0,
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (calls.filter((call) => String(call.input).includes('task_outfit_resume_1')).length === 1) {
      return new Response(JSON.stringify({
        id: 'task_outfit_resume_1',
        status: 'running',
        poll_url: 'https://relay.example/v1/images/tasks/task_outfit_resume_1',
        poll_after: 0,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      id: 'task_outfit_resume_1',
      status: 'succeeded',
      data: [{ b64_json: 'b3V0Zml0LXJlc3VtZWQ=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const session = await mod.ensureSession(env, 'session_outfit_pending_resume', null)
    const model = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,bW9kZWw=',
      filename: 'model.png',
    })
    const top = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,dG9w',
      filename: 'top.png',
    })

    const submitted = await mod.submitOutfitBatch(env, {
      sessionId: session.id,
      modelAssetIds: [model.id],
      modelId: 'nano-banana-2',
      garments: [{ assetId: top.id, role: 'top', label: 'top.png' }],
      concurrency: 1,
      clientKeys: {
        banana2ApiKey: 'image-key',
        visionApiKey: 'vision-key',
      },
    })

    assert.equal(sent.length, 1)
    await mod.runQueuedJob(env, submitted.jobId)

    let job = await mod.getJob(env, submitted.jobId)
    let [item] = await mod.listJobItems(env, submitted.jobId)
    assert.equal(job.status, 'queued')
    assert.equal(item.status, 'queued')
    assert.equal(item.outputJson.imageTaskStatus, 'running')
    assert.equal(item.attemptCount, 1)
    assert.equal(sent.length, 2)

    await mod.runQueuedJob(env, submitted.jobId)

    job = await mod.getJob(env, submitted.jobId)
    ;[item] = await mod.listJobItems(env, submitted.jobId)
    assert.equal(job.status, 'completed')
    assert.equal(item.status, 'completed')
    assert.equal(item.attemptCount, 1)
    assert.equal(calls.filter((call) => String(call.input).endsWith('/images/tasks') && call.init.method === 'POST').length, 1)
    assert.equal(
      await mod.getAssetDataUrl(env, String(item.outputJson.resultAssetId)),
      'data:image/png;base64,b3V0Zml0LXJlc3VtZWQ=',
    )
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('runOutfitBatchJob keeps job recoverable while another outfit item is still running', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const sent = []
  const env = {
    BANANA2_API_KEY: 'image-key',
    VS_INPUTS_BUCKET: createMemoryBucket(),
    VS_RESULTS_BUCKET: createMemoryBucket(),
    VS_OUTFIT_JOBS_QUEUE: {
      send: async (message) => {
        sent.push(message)
      },
    },
  }

  globalThis.fetch = async () => new Response(JSON.stringify({
    status: 'succeeded',
    data: [{ b64_json: 'b25lLWl0ZW0tZG9uZQ==' }],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  try {
    const session = await mod.ensureSession(env, 'session_outfit_running_sibling', null)
    const model = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,bW9kZWw=',
      filename: 'model.png',
    })
    const top = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,dG9w',
      filename: 'top.png',
    })
    const job = await mod.createJob(env, {
      id: 'job_outfit_running_sibling',
      sessionId: session.id,
      userId: null,
      type: 'outfit_batch',
      status: 'queued',
      configJson: {
        modelId: 'nano-banana-2',
        concurrency: 1,
      },
      summaryJson: { lookCount: 2 },
      progressTotal: 2,
      progressDone: 0,
      progressFailed: 0,
    })
    await mod.createJobItems(env, job.id, [
      {
        jobId: job.id,
        itemType: 'outfit_cell',
        status: 'queued',
        inputJson: {
          modelAssetId: model.id,
          modelLabel: 'model.png',
          lookId: `${top.id}-queued`,
          lookAssetIds: [top.id],
          lookRoles: ['top'],
          lookLabels: ['top.png'],
        },
        outputJson: {},
        attemptCount: 0,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
      },
      {
        jobId: job.id,
        itemType: 'outfit_cell',
        status: 'running',
        inputJson: {
          modelAssetId: model.id,
          modelLabel: 'model.png',
          lookId: `${top.id}-running`,
          lookAssetIds: [top.id],
          lookRoles: ['top'],
          lookLabels: ['top.png'],
        },
        outputJson: {
          imageTask: {
            id: 'task_running_sibling',
            status: 'running',
            poll_url: 'https://relay.example/v1/images/tasks/task_running_sibling',
            poll_after: 5,
          },
          imageTaskStatus: 'running',
        },
        attemptCount: 1,
        errorCode: null,
        errorMessage: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      },
    ])

    const result = await mod.runQueuedJob(env, job.id)
    const nextJob = await mod.getJob(env, job.id)
    const items = await mod.listJobItems(env, job.id)

    assert.equal(result.status, 'running')
    assert.equal(nextJob.status, 'running')
    assert.equal(nextJob.progressDone, 1)
    assert.equal(nextJob.progressFailed, 0)
    assert.equal(items.filter((item) => item.status === 'completed').length, 1)
    assert.equal(items.filter((item) => item.status === 'running').length, 1)
    assert.equal(sent.length, 1)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('runQueuedJob recovers a stale running outfit image task on duplicate delivery', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const calls = []
  const env = {
    VS_JOB_ITEM_TIMEOUT_MS: '60000',
    BANANA2_API_KEY: 'image-key',
    VS_INPUTS_BUCKET: createMemoryBucket(),
    VS_RESULTS_BUCKET: createMemoryBucket(),
    VS_OUTFIT_JOBS_QUEUE: {
      send: async () => {},
    },
  }
  const staleStartedAt = new Date(Date.now() - 5 * 60_000).toISOString()

  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    const payload = init.body ? JSON.parse(String(init.body || '{}')) : {}
    if (payload.model === 'gemini-3-flash-preview') {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              model: { framing: 'full-body', pose: 'standing' },
              garments: [{ index: 2, role: 'top', category: 'shirt' }],
            }),
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      id: 'task_outfit_stale_1',
      status: 'succeeded',
      data: [{ b64_json: 'c3RhbGUtb3V0Zml0LXJlc3VsdA==' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const session = await mod.ensureSession(env, 'session_outfit_stale_resume', null)
    const model = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,bW9kZWw=',
      filename: 'model.png',
    })
    const top = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,dG9w',
      filename: 'top.png',
    })
    const job = await mod.createJob(env, {
      id: 'job_outfit_stale_running',
      sessionId: session.id,
      userId: null,
      type: 'outfit_batch',
      status: 'running',
      configJson: {
        modelId: 'nano-banana-2',
        concurrency: 1,
      },
      summaryJson: { lookCount: 1 },
      progressTotal: 1,
      progressDone: 0,
      progressFailed: 0,
    })
    await mod.createJobItems(env, job.id, [{
      jobId: job.id,
      itemType: 'outfit_cell',
      status: 'running',
      inputJson: {
        modelAssetId: model.id,
        modelLabel: 'model.png',
        lookId: top.id,
        lookAssetIds: [top.id],
        lookRoles: ['top'],
        lookLabels: ['top.png'],
      },
      outputJson: {
        imageTask: {
          id: 'task_outfit_stale_1',
          status: 'running',
          poll_url: 'https://relay.example/v1/images/tasks/task_outfit_stale_1',
          poll_after: 0,
        },
        imageTaskStatus: 'running',
      },
      attemptCount: 1,
      errorCode: null,
      errorMessage: null,
      startedAt: staleStartedAt,
      finishedAt: null,
    }])

    const result = await mod.runQueuedJob(env, job.id)
    const nextJob = await mod.getJob(env, job.id)
    const [nextItem] = await mod.listJobItems(env, job.id)

    assert.equal(result.status, 'completed')
    assert.equal(nextJob.status, 'completed')
    assert.equal(nextItem.status, 'completed')
    assert.equal(nextItem.attemptCount, 1)
    assert.equal(calls.filter((call) => String(call.input).endsWith('/images/tasks')).length, 0)
    assert.equal(
      await mod.getAssetDataUrl(env, String(nextItem.outputJson.resultAssetId)),
      'data:image/png;base64,c3RhbGUtb3V0Zml0LXJlc3VsdA==',
    )
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('runOutfitBatchJob retries a failed upstream image task with a fresh task id', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const sent = []
  const calls = []
  const env = {
    VS_OUTFIT_TASK_MAX_POLLS_PER_RUN: '1',
    VS_INPUTS_BUCKET: createMemoryBucket(),
    VS_RESULTS_BUCKET: createMemoryBucket(),
    VS_OUTFIT_JOBS_QUEUE: {
      send: async (message) => {
        sent.push(message)
      },
    },
  }

  let taskCreates = 0
  let firstTaskPolls = 0

  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    const payload = init.body ? JSON.parse(String(init.body || '{}')) : {}
    if (payload.model === 'gemini-3-flash-preview') {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              model: { framing: 'full-body', pose: 'standing' },
              garments: [{ index: 2, role: 'top', category: 'shirt' }],
            }),
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (String(input).endsWith('/images/tasks') && init.method === 'POST') {
      taskCreates += 1
      const id = `task_outfit_retry_${taskCreates}`
      return new Response(JSON.stringify({
        id,
        status: 'queued',
        poll_url: `https://relay.example/v1/images/tasks/${id}`,
        poll_after: 0,
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (String(input).includes('task_outfit_retry_1')) {
      firstTaskPolls += 1
      if (firstTaskPolls === 1) {
        return new Response(JSON.stringify({
          id: 'task_outfit_retry_1',
          status: 'running',
          poll_url: 'https://relay.example/v1/images/tasks/task_outfit_retry_1',
          poll_after: 0,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({
        id: 'task_outfit_retry_1',
        status: 'failed',
        error: { message: 'system memory overloaded (current: 91.7%, threshold: 90%)' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      id: 'task_outfit_retry_2',
      status: 'succeeded',
      data: [{ b64_json: 'cmV0cnktb3V0Zml0LXJlc3VsdA==' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const session = await mod.ensureSession(env, 'session_outfit_failed_task_retry', null)
    const model = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,bW9kZWw=',
      filename: 'model.png',
    })
    const top = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,dG9w',
      filename: 'top.png',
    })

    const submitted = await mod.submitOutfitBatch(env, {
      sessionId: session.id,
      modelAssetIds: [model.id],
      modelId: 'nano-banana-2',
      garments: [{ assetId: top.id, role: 'top', label: 'top.png' }],
      concurrency: 1,
      clientKeys: {
        banana2ApiKey: 'image-key',
        visionApiKey: 'vision-key',
      },
    })

    await mod.runQueuedJob(env, submitted.jobId)

    let job = await mod.getJob(env, submitted.jobId)
    let [item] = await mod.listJobItems(env, submitted.jobId)
    assert.equal(job.status, 'queued')
    assert.equal(item.status, 'queued')
    assert.equal(item.attemptCount, 1)
    assert.equal(item.outputJson.imageTaskStatus, 'running')
    assert.equal(sent.length, 2)

    await mod.runQueuedJob(env, submitted.jobId)

    job = await mod.getJob(env, submitted.jobId)
    ;[item] = await mod.listJobItems(env, submitted.jobId)
    assert.equal(job.status, 'queued')
    assert.equal(item.status, 'queued')
    assert.equal(item.attemptCount, 1)
    assert.equal(item.outputJson.imageTaskStatus, 'retrying')
    assert.match(item.outputJson.lastImageTaskError, /system memory overloaded/)
    assert.equal(Boolean(item.outputJson.imageTask), false)

    await mod.runQueuedJob(env, submitted.jobId)

    job = await mod.getJob(env, submitted.jobId)
    ;[item] = await mod.listJobItems(env, submitted.jobId)
    assert.equal(job.status, 'completed')
    assert.equal(item.status, 'completed')
    assert.equal(item.attemptCount, 2)
    assert.equal(taskCreates, 2)
    assert.equal(
      await mod.getAssetDataUrl(env, String(item.outputJson.resultAssetId)),
      'data:image/png;base64,cmV0cnktb3V0Zml0LXJlc3VsdA==',
    )
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('runOutfitBatchJob fails item when image task result is empty', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  const env = {
    VS_INPUTS_BUCKET: createMemoryBucket(),
    VS_RESULTS_BUCKET: createMemoryBucket(),
    VS_OUTFIT_JOBS_QUEUE: {
      send: async () => {},
    },
  }

  globalThis.fetch = async (input, init = {}) => {
    const payload = JSON.parse(String(init.body || '{}'))
    if (payload.model === 'gemini-3-flash-preview') {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              model: { framing: 'full-body', pose: 'standing' },
              garments: [{ index: 2, role: 'top', category: 'shirt' }],
            }),
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
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
    const session = await mod.ensureSession(env, 'session_outfit_empty_result', null)
    const model = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,bW9kZWw=',
      filename: 'model.png',
    })
    const top = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,dG9w',
      filename: 'top.png',
    })
    const submitted = await mod.submitOutfitBatch(env, {
      sessionId: session.id,
      modelAssetIds: [model.id],
      modelId: 'nano-banana-2',
      garments: [{ assetId: top.id, role: 'top', label: 'top.png' }],
      concurrency: 1,
      clientKeys: {
        banana2ApiKey: 'image-key',
        visionApiKey: 'vision-key',
      },
    })

    await mod.runQueuedJob(env, submitted.jobId)
    await mod.runQueuedJob(env, submitted.jobId)
    await mod.runQueuedJob(env, submitted.jobId)

    const job = await mod.getJob(env, submitted.jobId)
    const [item] = await mod.listJobItems(env, submitted.jobId)

    assert.equal(job.status, 'failed')
    assert.equal(item.status, 'failed')
    assert.equal(item.errorCode, 'outfit_failed')
    assert.match(item.errorMessage, /Image result fetch returned an empty body/)
    assert.equal(Boolean(item.outputJson?.resultAssetId), false)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('runOutfitBatchJob retries transient outfit analysis upstream failures', async () => {
  const { mod, cleanup } = await importRunner()
  const originalFetch = globalThis.fetch
  let visionCalls = 0
  let imageCalls = 0
  const env = {
    VS_INPUTS_BUCKET: createMemoryBucket(),
    VS_RESULTS_BUCKET: createMemoryBucket(),
    VS_OUTFIT_JOBS_QUEUE: {
      send: async () => {},
    },
  }

  globalThis.fetch = async (input, init = {}) => {
    const payload = JSON.parse(String(init.body || '{}'))
    if (payload.model === 'gemini-3-flash-preview') {
      visionCalls += 1
      if (visionCalls === 1) {
        return new Response(JSON.stringify({ error: { message: 'temporary analysis outage' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              model: { framing: 'full-body', pose: 'standing' },
              garments: [{ index: 2, role: 'top', category: 'shirt' }],
            }),
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    imageCalls += 1
    return new Response(JSON.stringify({
      status: 'succeeded',
      data: [{ b64_json: Buffer.from(`outfit-${imageCalls}`).toString('base64') }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const session = await mod.ensureSession(env, 'session_outfit_analysis_retry', null)
    const model = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,bW9kZWw=',
      filename: 'model.png',
    })
    const top = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      dataUrl: 'data:image/png;base64,dG9w',
      filename: 'top.png',
    })
    const submitted = await mod.submitOutfitBatch(env, {
      sessionId: session.id,
      modelAssetIds: [model.id],
      modelId: 'nano-banana-2',
      garments: [{ assetId: top.id, role: 'top', label: 'top.png' }],
      concurrency: 1,
      clientKeys: {
        banana2ApiKey: 'image-key',
        visionApiKey: 'vision-key',
      },
    })

    await mod.runQueuedJob(env, submitted.jobId)

    const job = await mod.getJob(env, submitted.jobId)
    const [item] = await mod.listJobItems(env, submitted.jobId)

    assert.equal(job.status, 'completed')
    assert.equal(item.status, 'completed')
    assert.equal(visionCalls, 2)
    assert.equal(imageCalls, 1)
    assert.equal(Boolean(item.outputJson?.resultAssetId), true)
  } finally {
    globalThis.fetch = originalFetch
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

test('submitOutfitBatch stores per-model instructions on each queued look item', async () => {
  const { mod, cleanup } = await importRunner()
  const env = {
    VS_OUTFIT_JOBS_QUEUE: {
      send: async () => {},
    },
  }

  try {
    const submitted = await mod.submitOutfitBatch(env, {
      sessionId: 'session_outfit_model_instructions',
      models: [
        {
          assetId: 'model_1',
          label: 'studio model',
          instructions: 'Keep her left hand visible and use a calmer smile.',
        },
      ],
      garments: [
        {
          assetId: 'dress_1',
          role: 'dress',
          label: 'dress.png',
        },
      ],
      concurrency: 1,
    })

    const [item] = await mod.listJobItems(env, submitted.jobId)
    const job = await mod.getJob(env, submitted.jobId)

    assert.equal(item.inputJson.modelAssetId, 'model_1')
    assert.equal(item.inputJson.modelLabel, 'studio model')
    assert.equal(item.inputJson.modelInstructions, 'Keep her left hand visible and use a calmer smile.')
    assert.equal(job.configJson.modelInstructions[0], 'model_1:Keep her left hand visible and use a calmer smile.')
  } finally {
    await cleanup()
  }
})

test('pauseJob prevents a queued job from running until it is resumed', async () => {
  const { mod, cleanup } = await importRunner()
  const sent = []
  const env = {
    VS_TRANSLATE_JOBS_QUEUE: {
      send: async (message) => {
        sent.push(message)
      },
    },
  }

  try {
    const session = await mod.ensureSession(env, 'session_pause_resume', null)
    const job = await mod.createJob(env, {
      id: 'job_pause_resume',
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

    const paused = await mod.pauseJob(env, job.id)
    const skipped = await mod.runQueuedJob(env, job.id)
    const stillPausedJob = await mod.getJob(env, job.id)
    const [stillQueuedItem] = await mod.listJobItems(env, job.id)

    assert.equal(paused.status, 'paused')
    assert.deepEqual(skipped, { jobId: job.id, status: 'paused', skipped: true })
    assert.equal(stillPausedJob.status, 'paused')
    assert.equal(stillQueuedItem.status, 'queued')
    assert.equal(stillQueuedItem.attemptCount, 0)

    const resumed = await mod.resumeJob(env, job.id)
    const resumedJob = await mod.getJob(env, job.id)

    assert.equal(resumed.status, 'queued')
    assert.equal(resumedJob.status, 'queued')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].jobId, job.id)
    assert.equal(sent[0].reason, 'retry')
  } finally {
    await cleanup()
  }
})

test('deleteJob removes a job, its items, and job events', async () => {
  const { mod, cleanup } = await importRunner()
  const env = {}

  try {
    const session = await mod.ensureSession(env, 'session_delete_job', null)
    const job = await mod.createJob(env, {
      id: 'job_delete_me',
      sessionId: session.id,
      userId: null,
      type: 'outfit_batch',
      status: 'queued',
      configJson: { modelId: 'nano-banana-pro' },
      summaryJson: {},
      progressTotal: 1,
      progressDone: 0,
      progressFailed: 0,
    })
    await mod.createJobItems(env, job.id, [{
      jobId: job.id,
      itemType: 'outfit_cell',
      status: 'queued',
      inputJson: { modelAssetId: 'model_1', lookId: 'look_1' },
      outputJson: {},
      attemptCount: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
    }])
    await mod.pauseJob(env, job.id)

    const deleted = await mod.deleteJob(env, job.id)
    const missingJob = await mod.getJob(env, job.id)
    const items = await mod.listJobItems(env, job.id)
    const events = await mod.listEvents(env, 'job', job.id)

    assert.deepEqual(deleted, { jobId: job.id, deleted: true })
    assert.equal(missingJob, null)
    assert.deepEqual(items, [])
    assert.deepEqual(events, [])
  } finally {
    await cleanup()
  }
})

test('cancelJob marks unfinished items as cancelled so history stops showing them as queued', async () => {
  const { mod, cleanup } = await importRunner()
  const env = {}

  try {
    const session = await mod.ensureSession(env, 'session_cancel_job', null)
    const job = await mod.createJob(env, {
      id: 'job_cancel_me',
      sessionId: session.id,
      userId: null,
      type: 'translate_batch',
      status: 'running',
      configJson: {
        modelId: 'nano-banana-2',
        targetLanguages: ['ja'],
      },
      summaryJson: {},
      progressTotal: 3,
      progressDone: 1,
      progressFailed: 0,
    })
    await mod.createJobItems(env, job.id, [
      {
        jobId: job.id,
        itemType: 'translate_cell',
        status: 'completed',
        inputJson: { assetId: 'asset_done', targetLanguage: 'ja' },
        outputJson: { resultAssetId: 'result_done' },
        attemptCount: 1,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: new Date().toISOString(),
      },
      {
        jobId: job.id,
        itemType: 'translate_cell',
        status: 'queued',
        inputJson: { assetId: 'asset_queued', targetLanguage: 'ja' },
        outputJson: {},
        attemptCount: 0,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
      },
      {
        jobId: job.id,
        itemType: 'translate_cell',
        status: 'running',
        inputJson: { assetId: 'asset_running', targetLanguage: 'ja' },
        outputJson: {},
        attemptCount: 1,
        errorCode: null,
        errorMessage: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      },
    ])

    const cancelled = await mod.cancelJob(env, job.id)
    const items = await mod.listJobItems(env, job.id)

    assert.deepEqual(cancelled, { jobId: job.id, status: 'cancelled' })
    assert.equal((await mod.getJob(env, job.id)).status, 'cancelled')
    assert.deepEqual(items.map((item) => item.status), ['completed', 'cancelled', 'cancelled'])
    assert.ok(items[1].finishedAt)
    assert.ok(items[2].finishedAt)
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
      status: 'succeeded',
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
      status: 'succeeded',
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
