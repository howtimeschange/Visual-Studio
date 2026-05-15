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
