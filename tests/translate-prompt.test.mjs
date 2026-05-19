import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importTranslate() {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-translate-'))
  await build({
    entryPoints: ['functions/api/translate.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'translate.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'translate.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

test('executeTranslate tells the image model to translate visible source text omitted from a cached OCR plan', async () => {
  const { mod, cleanup } = await importTranslate()
  const originalFetch = globalThis.fetch
  let prompt = ''

  globalThis.fetch = async (input, init = {}) => {
    const payload = JSON.parse(String(init.body || '{}'))
    const textPart = payload.messages?.[0]?.content?.find((part) => part.type === 'text')
    prompt = textPart?.text || ''
    return new Response(JSON.stringify({ data: [{ b64_json: 'dHJhbnNsYXRlZA==' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await mod.executeTranslate({
      imageBase64: 'c291cmNl',
      mime: 'image/png',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      modelId: 'nano-banana-2',
      preserveBrand: true,
      clientKeys: { banana2ApiKey: 'image-key' },
      ocrPlan: {
        sourceLang: 'zh',
        textCount: 1,
        keepCount: 0,
        translateCount: 1,
        texts: [{
          original: '经典木履鞋型',
          translation: 'Classic clog silhouette',
          translations: { en: 'Classic clog silhouette' },
          keep: false,
          position: 'topCenter',
          size: 'large',
          style: 'bold',
        }],
      },
    }, {})

    assert.match(prompt, /TRANSLATE these \(1 items\)/)
    assert.match(prompt, /Also translate any other visible Simplified Chinese/i)
    assert.match(prompt, /not listed in the OCR plan/i)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('executeTranslate preserves the source image canvas when a font reference has a different orientation', async () => {
  const { mod, cleanup } = await importTranslate()
  const originalFetch = globalThis.fetch
  let prompt = ''
  let images = []

  globalThis.fetch = async (input, init = {}) => {
    const payload = JSON.parse(String(init.body || '{}'))
    const content = payload.messages?.[0]?.content || []
    prompt = content.find((part) => part.type === 'text')?.text || ''
    images = content.filter((part) => part.type === 'image_url')
    return new Response(JSON.stringify({ data: [{ b64_json: 'dHJhbnNsYXRlZA==' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await mod.executeTranslate({
      imageBase64: 'dmVydGljYWwtc291cmNl',
      mime: 'image/jpeg',
      sourceWidth: 790,
      sourceHeight: 1914,
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      modelId: 'nano-banana-2',
      preserveBrand: true,
      fontMode: 'reference',
      fontReferenceImage: {
        base64: 'aG9yaXpvbnRhbC1mb250LXJlZg==',
        mime: 'image/png',
      },
      clientKeys: { banana2ApiKey: 'image-key' },
    }, {})

    assert.equal(images.length, 2)
    assert.match(prompt, /output canvas must match Image #1/i)
    assert.match(prompt, /790\s*x\s*1914/i)
    assert.match(prompt, /portrait/i)
    assert.match(prompt, /Do NOT use Image #2's landscape orientation/i)
    assert.match(prompt, /Do NOT add.+AI generated/i)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})

test('executeTranslate adds headline and body color rules to the image prompt', async () => {
  const { mod, cleanup } = await importTranslate()
  const originalFetch = globalThis.fetch
  let prompt = ''

  globalThis.fetch = async (input, init = {}) => {
    const payload = JSON.parse(String(init.body || '{}'))
    const content = payload.messages?.[0]?.content || []
    prompt = content.find((part) => part.type === 'text')?.text || ''
    return new Response(JSON.stringify({ data: [{ b64_json: 'Y29sb3JlZA==' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await mod.executeTranslate({
      imageBase64: 'c291cmNl',
      mime: 'image/png',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      modelId: 'nano-banana-2',
      preserveBrand: true,
      textColorMode: 'custom',
      headlineColor: '#ff6600',
      bodyColor: '#1f2937',
      clientKeys: { banana2ApiKey: 'image-key' },
      ocrPlan: {
        sourceLang: 'zh',
        textCount: 2,
        keepCount: 0,
        translateCount: 2,
        texts: [
          {
            original: '夏日新品',
            translation: 'Summer New Arrivals',
            translations: { en: 'Summer New Arrivals' },
            keep: false,
            position: 'topCenter',
            size: 'large',
            style: 'bold',
          },
          {
            original: '轻盈透气，全天舒适',
            translation: 'Light and breathable, all-day comfort',
            translations: { en: 'Light and breathable, all-day comfort' },
            keep: false,
            position: 'bottomCenter',
            size: 'medium',
            style: 'regular',
          },
        ],
      },
    }, {})

    assert.match(prompt, /TEXT COLOR STRATEGY/i)
    assert.match(prompt, /Identify the main headline/i)
    assert.match(prompt, /main headline.+#FF6600/i)
    assert.match(prompt, /body text.+#1F2937/i)
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})
