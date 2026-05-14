import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importEntry(entryPoint, exportNames) {
  const outdir = await mkdtemp(path.join(tmpdir(), 'canvas-psd-ocr-'))
  await build({
    stdin: {
      contents: exportNames.map((name) => `export { ${name} } from './${entryPoint}'`).join('\n'),
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

test('PSD OCR normalization clamps text boxes to the original image pixel canvas', async () => {
  const { mod, cleanup } = await importEntry('functions/api/canvas/psd-ocr.ts', ['normalizeCanvasPsdOcrResult'])
  try {
    const result = mod.normalizeCanvasPsdOcrResult({
      texts: [
        {
          text: ' SALE ',
          bbox: { x: -12.2, y: 10.4, width: 80, height: 30 },
          fontSize: '24',
          color: { r: 255, g: 0, b: 20 },
          align: 'middle',
          fontWeight: '700',
          fontStyle: 'italic',
          confidence: '0.81',
        },
        {
          text: 'outside',
          bbox: { x: 140, y: 10, width: 20, height: 20 },
        },
        {
          text: '',
          bbox: { x: 10, y: 10, width: 20, height: 20 },
        },
      ],
    }, 100, 80)

    assert.equal(result.textCount, 1)
    assert.deepEqual(result.texts[0], {
      text: 'SALE',
      bbox: { x: 0, y: 10, width: 68, height: 30 },
      fontSize: 24,
      color: '#ff0014',
      align: 'center',
      fontFamily: '',
      fontWeight: 'bold',
      fontStyle: 'italic',
      orientation: 'horizontal',
      confidence: 0.81,
    })
  } finally {
    await cleanup()
  }
})

test('PSD OCR normalization returns a compact semantic layer plan for PSD decomposition', async () => {
  const { mod, cleanup } = await importEntry('functions/api/canvas/psd-ocr.ts', ['normalizeCanvasPsdOcrResult'])
  try {
    const result = mod.normalizeCanvasPsdOcrResult({
      semanticLayers: [
        {
          name: ' poster background ',
          type: 'background',
          bbox: { x: 0, y: 0, width: 300, height: 200 },
          description: 'flat blue backdrop',
          confidence: '0.9',
          zIndex: 0,
        },
        {
          name: 'Hero shoe',
          type: 'product',
          bbox: { x: 40, y: 60, width: 220, height: 130 },
          confidence: 0.84,
          zIndex: 20,
        },
        {
          name: 'Headline duplicate',
          type: 'text',
          bbox: { x: 30, y: 15, width: 190, height: 40 },
        },
        {
          name: 'tiny speck',
          type: 'decoration',
          bbox: { x: 10, y: 10, width: 1, height: 1 },
        },
        {
          name: 'off canvas',
          type: 'object',
          bbox: { x: 320, y: 10, width: 50, height: 50 },
        },
      ],
      warnings: [' semantic crop warning '],
    }, 300, 200)

    assert.equal(result.semanticLayerCount, 2)
    assert.deepEqual(result.semanticLayers, [
      {
        name: 'poster background',
        type: 'background',
        bbox: { x: 0, y: 0, width: 300, height: 200 },
        description: 'flat blue backdrop',
        confidence: 0.9,
        zIndex: 0,
      },
      {
        name: 'Hero shoe',
        type: 'subject',
        bbox: { x: 40, y: 60, width: 220, height: 130 },
        description: '',
        confidence: 0.84,
        zIndex: 20,
      },
    ])
    assert.deepEqual(result.warnings, ['semantic crop warning'])
  } finally {
    await cleanup()
  }
})

test('PSD decomposition normalization keeps extracted transparent layers and repaired background', async () => {
  const { mod, cleanup } = await importEntry('functions/api/canvas/psd-ocr.ts', ['normalizeCanvasPsdDecomposeResult'])
  try {
    const result = mod.normalizeCanvasPsdDecomposeResult({
      analysis: {
        texts: [
          {
            text: 'SALE',
            bbox: { x: 10, y: 20, width: 120, height: 40 },
            color: '#fff',
          },
        ],
        semanticLayers: [
          {
            name: 'Background',
            type: 'background',
            bbox: { x: 0, y: 0, width: 300, height: 200 },
            zIndex: 0,
          },
        ],
      },
      extractedLayers: [
        {
          name: ' Main product ',
          type: 'product',
          bbox: { x: 40, y: 60, width: 220, height: 130 },
          dataUrl: 'data:image/png;base64,Y3V0b3V0',
          confidence: '0.88',
          zIndex: 40,
        },
        {
          name: 'broken layer',
          type: 'logo',
          bbox: { x: 0, y: 0, width: 10, height: 10 },
          dataUrl: 'not-a-data-url',
        },
      ],
      backgroundLayer: {
        name: ' Clean background ',
        dataUrl: 'data:image/png;base64,YmFja2dyb3VuZA==',
        repaired: true,
      },
      warnings: [' one failed '],
    }, 300, 200)

    assert.equal(result.textCount, 1)
    assert.equal(result.semanticLayerCount, 1)
    assert.equal(result.extractedLayerCount, 1)
    assert.deepEqual(result.extractedLayers[0], {
      name: 'Main product',
      type: 'subject',
      bbox: { x: 40, y: 60, width: 220, height: 130 },
      dataUrl: 'data:image/png;base64,Y3V0b3V0',
      description: '',
      confidence: 0.88,
      zIndex: 40,
    })
    assert.deepEqual(result.backgroundLayer, {
      name: 'Clean background',
      dataUrl: 'data:image/png;base64,YmFja2dyb3VuZA==',
      repaired: true,
    })
    assert.deepEqual(result.warnings, ['one failed'])
  } finally {
    await cleanup()
  }
})
