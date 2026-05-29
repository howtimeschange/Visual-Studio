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

test('PSD OCR normalization merges fragmented semantic plans into compact editable layers', async () => {
  const { mod, cleanup } = await importEntry('functions/api/canvas/psd-ocr.ts', ['normalizeCanvasPsdOcrResult'])
  try {
    const result = mod.normalizeCanvasPsdOcrResult({
      semanticLayers: [
        {
          name: 'Background',
          type: 'background',
          bbox: { x: 0, y: 0, width: 1000, height: 800 },
          zIndex: 0,
        },
        {
          name: 'Face',
          type: 'subject',
          bbox: { x: 300, y: 120, width: 220, height: 260 },
          zIndex: 42,
        },
        {
          name: 'Body',
          type: 'person',
          bbox: { x: 260, y: 300, width: 300, height: 360 },
          zIndex: 40,
        },
        {
          name: 'sparkle 1',
          type: 'decoration',
          bbox: { x: 90, y: 80, width: 30, height: 30 },
          zIndex: 90,
        },
        {
          name: 'sparkle 2',
          type: 'decoration',
          bbox: { x: 860, y: 110, width: 28, height: 28 },
          zIndex: 91,
        },
        {
          name: 'brand mark',
          type: 'logo',
          bbox: { x: 780, y: 680, width: 130, height: 70 },
          zIndex: 80,
        },
      ],
    }, 1000, 800)

    assert.equal(result.semanticLayerCount, 4)
    assert.deepEqual(result.semanticLayers.map((layer) => layer.type), [
      'background',
      'subject',
      'logo',
      'decoration',
    ])
    assert.ok(result.semanticLayers[1].bbox.x <= 260)
    assert.ok(result.semanticLayers[1].bbox.y <= 120)
    assert.ok(result.semanticLayers[1].bbox.x + result.semanticLayers[1].bbox.width >= 560)
    assert.ok(result.semanticLayers[1].bbox.y + result.semanticLayers[1].bbox.height >= 660)
    assert.match(result.semanticLayers[1].name, /Main subject|Subject/i)
    assert.ok(result.semanticLayers[3].bbox.x <= 90)
    assert.ok(result.semanticLayers[3].bbox.y <= 80)
    assert.ok(result.semanticLayers[3].bbox.x + result.semanticLayers[3].bbox.width >= 888)
    assert.ok(result.semanticLayers[3].bbox.y + result.semanticLayers[3].bbox.height >= 138)
  } finally {
    await cleanup()
  }
})

test('PSD extraction target selection keeps meaningful objects ahead of tiny high-z fragments', async () => {
  const { mod, cleanup } = await importEntry('functions/api/canvas/psd-ocr.ts', ['selectCanvasPsdExtractionTargets'])
  try {
    const layers = [
      {
        name: 'Tiny glow',
        type: 'effect',
        bbox: { x: 20, y: 20, width: 20, height: 20 },
        description: '',
        confidence: 0.7,
        zIndex: 99,
      },
      {
        name: 'Main product',
        type: 'subject',
        bbox: { x: 220, y: 160, width: 420, height: 360 },
        description: '',
        confidence: 0.92,
        zIndex: 40,
      },
      {
        name: 'Logo',
        type: 'logo',
        bbox: { x: 720, y: 620, width: 180, height: 90 },
        description: '',
        confidence: 0.86,
        zIndex: 80,
      },
    ]

    const targets = mod.selectCanvasPsdExtractionTargets(layers, 2, 1000, 800)

    assert.deepEqual(targets.map((layer) => layer.name), ['Main product', 'Logo'])
  } finally {
    await cleanup()
  }
})

test('PSD cutout generation runs layer jobs concurrently and keeps failure warnings', async () => {
  const { mod, cleanup } = await importEntry('functions/api/canvas/psd-ocr.ts', ['runCanvasPsdCutoutJobs'])
  try {
    const layers = [
      { name: 'Main subject', type: 'subject', bbox: { x: 0, y: 0, width: 10, height: 10 } },
      { name: 'Logo', type: 'logo', bbox: { x: 10, y: 10, width: 10, height: 10 } },
      { name: 'Decoration', type: 'decoration', bbox: { x: 20, y: 20, width: 10, height: 10 } },
    ]
    let active = 0
    let peakActive = 0
    const result = await mod.runCanvasPsdCutoutJobs(layers, async (layer) => {
      active += 1
      peakActive = Math.max(peakActive, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active -= 1
      if (layer.name === 'Logo') return { ok: false, error: 'mask failed', status: 502 }
      return { ok: true, dataUrl: `data:image/png;base64,${Buffer.from(layer.name).toString('base64')}` }
    }, { concurrency: 2 })

    assert.equal(peakActive, 2)
    assert.deepEqual(result.extractedLayers.map((layer) => layer.name), ['Main subject', 'Decoration'])
    assert.deepEqual(result.warnings, ['Logo 透明图层生成失败：mask failed'])
  } finally {
    await cleanup()
  }
})
