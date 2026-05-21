import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importOutfitLooks() {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-outfit-looks-'))
  await build({
    entryPoints: ['packages/core/outfit-looks.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'outfit-looks.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'outfit-looks.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

async function importOutfitSwap() {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-outfit-swap-'))
  await build({
    entryPoints: ['functions/api/outfit-swap.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'outfit-swap.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'outfit-swap.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function okTaskCreateResponse(taskId = 'task_outfit') {
  return jsonResponse({
    id: taskId,
    object: 'image.task',
    status: 'queued',
    poll_url: `https://api.1xm.ai/v1/images/tasks/${taskId}`,
    poll_after: 0,
  }, 202)
}

function okTaskResultResponse(base64) {
  return jsonResponse({
    id: 'task_outfit',
    object: 'image.task',
    status: 'succeeded',
    data: [{ b64_json: base64 }],
  })
}

function parseImageTaskPayload(call) {
  return JSON.parse(String(call?.init?.body || '{}'))
}

test('buildOutfitLooks layers shoes onto base garment looks', async () => {
  const { mod, cleanup } = await importOutfitLooks()

  try {
    const looks = mod.buildOutfitLooks([
      { id: 'top-1', role: 'top' },
      { id: 'bottom-1', role: 'bottom' },
      { id: 'shoes-1', role: 'shoes' },
    ])

    assert.deepEqual(looks.map((look) => look.id), [
      'top-1+bottom-1',
      'top-1+bottom-1+shoes-1',
    ])
    assert.deepEqual(looks[1].roles, ['top', 'bottom', 'shoes'])
  } finally {
    await cleanup()
  }
})

test('buildOutfitLooks uses shoes as the base before accessory-only looks', async () => {
  const { mod, cleanup } = await importOutfitLooks()

  try {
    const looks = mod.buildOutfitLooks([
      { id: 'shoes-1', role: 'shoes' },
      { id: 'bag-1', role: 'accessory' },
    ])

    assert.deepEqual(looks.map((look) => look.id), [
      'shoes-1',
      'shoes-1+bag-1',
    ])
    assert.deepEqual(looks[1].roles, ['shoes', 'accessory'])
  } finally {
    await cleanup()
  }
})

test('executeOutfitSwap describes shoes in the prompt sent to the image model', async () => {
  const { mod, cleanup } = await importOutfitSwap()
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    if (calls.length === 1) return okTaskCreateResponse()
    return okTaskResultResponse('c2hvZXMtcmVzdWx0')
  }

  try {
    const result = await mod.executeOutfitSwap({
      modelId: 'gpt-image-2',
      model: { base64: 'bW9kZWw=', mime: 'image/png' },
      garments: [{ base64: 'c2hvZXM=', mime: 'image/png', role: 'shoes', label: 'loafer.png' }],
      clientKeys: { gptImageApiKey: 'test-key' },
    }, {})

    assert.equal(result.resultDataUrl, 'data:image/png;base64,c2hvZXMtcmVzdWx0')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].input, 'https://api.1xm.ai/v1/images/tasks')
    const payload = parseImageTaskPayload(calls[0])
    const prompt = payload.prompt

    assert.match(prompt, /Image #2: GARMENT role: shoes/i)
    assert.match(prompt, /shoes should be placed on the feet/i)
    assert.match(prompt, /soles/i)
    assert.deepEqual(payload.image, [
      'data:image/png;base64,bW9kZWw=',
      'data:image/png;base64,c2hvZXM=',
    ])
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('executeOutfitSwap includes per-garment instructions beside the matching reference', async () => {
  const { mod, cleanup } = await importOutfitSwap()
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    if (calls.length === 1) return okTaskCreateResponse()
    return okTaskResultResponse('c3R5bGVkLXJlc3VsdA==')
  }

  try {
    await mod.executeOutfitSwap({
      modelId: 'gpt-image-2',
      model: { base64: 'bW9kZWw=', mime: 'image/png' },
      garments: [
        { base64: 'dG9w', mime: 'image/png', role: 'top', label: 'top.png' },
        {
          base64: 'c2hvZXM=',
          mime: 'image/png',
          role: 'shoes',
          label: 'shoes.png',
          instructions: 'Make these shoes bright red and keep the chunky sole visible.',
        },
      ],
      clientKeys: { gptImageApiKey: 'test-key' },
    }, {})

    const payload = parseImageTaskPayload(calls[0])
    const prompt = payload.prompt
    const instructionSection = prompt.match(/## PER-GARMENT ADDITIONAL INSTRUCTIONS\n([\s\S]*?)(?:\n\n##|\nReturn|$)/i)?.[1] || ''

    assert.match(prompt, /## PER-GARMENT ADDITIONAL INSTRUCTIONS/i)
    assert.match(instructionSection, /Image #3[\s\S]*Make these shoes bright red and keep the chunky sole visible\./i)
    assert.doesNotMatch(instructionSection, /Image #2[^\n]*Make these shoes bright red and keep the chunky sole visible\./i)
    assert.deepEqual(payload.image, [
      'data:image/png;base64,bW9kZWw=',
      'data:image/png;base64,dG9w',
      'data:image/png;base64,c2hvZXM=',
    ])
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('executeOutfitSwap keeps queued look item instructions aligned with their image order', async () => {
  const { mod, cleanup } = await importOutfitSwap()
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init })
    if (calls.length === 1) return okTaskCreateResponse()
    return okTaskResultResponse('bG9vay1yZXN1bHQ=')
  }

  try {
    await mod.executeOutfitSwap({
      modelId: 'gpt-image-2',
      model: { base64: 'bW9kZWw=', mime: 'image/png' },
      garments: [
        {
          base64: 'Ym90dG9t',
          mime: 'image/png',
          role: 'bottom',
          label: 'bottom.png',
          instructions: 'Keep the skirt knee-length.',
        },
        {
          base64: 'dG9w',
          mime: 'image/png',
          role: 'top',
          label: 'top.png',
          instructions: 'Make the collar more structured.',
        },
      ],
      clientKeys: { gptImageApiKey: 'test-key' },
    }, {})

    const payload = parseImageTaskPayload(calls[0])
    const prompt = payload.prompt
    const instructionSection = prompt.match(/## PER-GARMENT ADDITIONAL INSTRUCTIONS\n([\s\S]*?)(?:\n\n##|\nReturn|$)/i)?.[1] || ''

    assert.match(instructionSection, /Image #2[\s\S]*Keep the skirt knee-length\./i)
    assert.match(instructionSection, /Image #3[\s\S]*Make the collar more structured\./i)
    assert.deepEqual(payload.image, [
      'data:image/png;base64,bW9kZWw=',
      'data:image/png;base64,Ym90dG9t',
      'data:image/png;base64,dG9w',
    ])
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})
