import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSelectedImagePsdModel,
  classifyPsdAlphaImageData,
  repairPsdCheckerboardTransparency,
  validatePsdExtractedLayers,
  buildCanvasPsdModel,
  chooseCanvasPsdBaseImage,
  createOcrTextLayerDescriptor,
  createRasterLayerDescriptor,
  createSemanticRasterLayerDescriptor,
  createTextLayerDescriptor,
  getCanvasPsdExportFrame,
  mapCanvasElementToPsdRect,
  splitImageDataIntoColorClusters,
} from '../public/js/canvas-psd-export.js'

const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgo='

test('PSD export uses the selected image original dimensions as canvas base', () => {
  const selected = {
    id: 'selected-image',
    type: 'image',
    x: 100,
    y: 50,
    width: 1024,
    height: 512,
    originalWidth: 2048,
    originalHeight: 1024,
    content: PNG_1X1,
    generatingPrompt: 'hero prompt',
  }
  const other = {
    id: 'larger-display',
    type: 'image',
    x: -200,
    y: 0,
    width: 1400,
    height: 900,
    originalWidth: 1600,
    originalHeight: 1200,
    content: PNG_1X1,
  }

  const base = chooseCanvasPsdBaseImage([other, selected], ['selected-image'])
  const frame = getCanvasPsdExportFrame([other, selected], ['selected-image'])

  assert.equal(base.id, 'selected-image')
  assert.deepEqual(frame, {
    mode: 'base-image',
    baseElementId: 'selected-image',
    x: 100,
    y: 50,
    width: 2048,
    height: 1024,
    scale: 2,
  })
})

test('PSD export falls back to the largest image when no selected image exists', () => {
  const small = {
    id: 'small',
    type: 'image',
    x: 0,
    y: 0,
    width: 300,
    height: 300,
    originalWidth: 600,
    originalHeight: 600,
    content: PNG_1X1,
  }
  const large = {
    id: 'large',
    type: 'image',
    x: 40,
    y: 80,
    width: 640,
    height: 360,
    originalWidth: 3840,
    originalHeight: 2160,
    content: PNG_1X1,
  }

  const base = chooseCanvasPsdBaseImage([small, large], [])

  assert.equal(base.id, 'large')
})

test('PSD export can use asset-backed image metadata as the canvas base before pixels hydrate', () => {
  const image = {
    id: 'asset-image',
    type: 'image',
    x: 12,
    y: 24,
    width: 512,
    height: 256,
    originalWidth: 1024,
    originalHeight: 512,
    content: '',
    assetId: '',
  }

  assert.equal(chooseCanvasPsdBaseImage([image], [])?.id, 'asset-image')
  assert.deepEqual(getCanvasPsdExportFrame([image], []), {
    mode: 'base-image',
    baseElementId: 'asset-image',
    x: 12,
    y: 24,
    width: 1024,
    height: 512,
    scale: 2,
  })
})

test('PSD export falls back to content bounds when the canvas has no image', () => {
  const elements = [
    { id: 'text', type: 'text', x: 20, y: 30, width: 200, height: 50, content: '标题' },
    { id: 'shape', type: 'shape', x: -40, y: 90, width: 80, height: 100, shape: 'square' },
  ]

  assert.deepEqual(getCanvasPsdExportFrame(elements, []), {
    mode: 'content-bounds',
    baseElementId: '',
    x: -80,
    y: -10,
    width: 340,
    height: 240,
    scale: 1,
  })
})

test('canvas element coordinates map into the PSD base image pixel space', () => {
  const frame = {
    mode: 'base-image',
    baseElementId: 'base',
    x: 100,
    y: 50,
    width: 2048,
    height: 1024,
    scale: 2,
  }
  const rect = mapCanvasElementToPsdRect({
    x: 356,
    y: 178,
    width: 100,
    height: 40,
  }, frame)

  assert.deepEqual(rect, {
    left: 512,
    top: 256,
    width: 200,
    height: 80,
    right: 712,
    bottom: 336,
  })
})

test('text elements create Photoshop editable text descriptors', () => {
  const frame = {
    mode: 'base-image',
    baseElementId: 'base',
    x: 100,
    y: 50,
    width: 2048,
    height: 1024,
    scale: 2,
  }
  const layer = createTextLayerDescriptor({
    id: 'text-1',
    type: 'text',
    x: 150,
    y: 75,
    width: 300,
    height: 80,
    content: '可编辑标题',
    fontSize: 24,
    fontFamily: 'Noto Sans SC',
    color: '#ff3366',
  }, frame)

  assert.equal(layer.name, 'Text 可编辑标题')
  assert.equal(layer.text.text, '可编辑标题')
  assert.deepEqual(layer.text.transform, [1, 0, 0, 1, 100, 50])
  assert.equal(layer.text.shapeType, 'box')
  assert.deepEqual(layer.text.boxBounds, [0, 0, 600, 160])
  assert.equal(layer.text.style.fontSize, 48)
  assert.deepEqual(layer.text.style.fillColor, { r: 255, g: 51, b: 102 })
})

test('PSD model orders layers top-to-bottom for ag-psd and keeps text editable', () => {
  const elements = [
    {
      id: 'base',
      type: 'image',
      x: 100,
      y: 50,
      width: 1024,
      height: 512,
      originalWidth: 2048,
      originalHeight: 1024,
      name: 'hero.png',
      content: PNG_1X1,
    },
    {
      id: 'text',
      type: 'text',
      x: 120,
      y: 70,
      width: 200,
      height: 60,
      content: 'Sale',
      fontSize: 20,
    },
    {
      id: 'shape',
      type: 'shape',
      x: 160,
      y: 120,
      width: 120,
      height: 80,
      shape: 'circle',
    },
  ]

  const model = buildCanvasPsdModel({
    elements,
    selectedIds: ['base'],
    title: '春季主图',
  })

  assert.equal(model.width, 2048)
  assert.equal(model.height, 1024)
  assert.equal(model.fileName, '春季主图.psd')
  assert.deepEqual(model.children.map((layer) => layer.name), [
    'Shape circle',
    'Text Sale',
    'Image hero',
  ])
  assert.ok(model.children[1].text, 'text layer should include editable text metadata')
  assert.equal(model.warnings.length, 0)
})

test('raster layer descriptors include image source and mapped bounds', () => {
  const frame = {
    mode: 'content-bounds',
    baseElementId: '',
    x: -80,
    y: -10,
    width: 340,
    height: 240,
    scale: 1,
  }
  const layer = createRasterLayerDescriptor({
    id: 'image-1',
    type: 'image',
    x: 20,
    y: 30,
    width: 200,
    height: 100,
    name: 'product.png',
    content: PNG_1X1,
  }, frame)

  assert.deepEqual(layer, {
    kind: 'image',
    name: 'Image product',
    source: PNG_1X1,
    left: 100,
    top: 40,
    width: 200,
    height: 100,
    original: {
      id: 'image-1',
      type: 'image',
    },
  })
})

test('base image raster layer keeps the original image pixel size at the PSD origin', () => {
  const frame = {
    mode: 'base-image',
    baseElementId: 'base',
    x: 100,
    y: 50,
    width: 2048,
    height: 1024,
    scale: 2,
  }
  const layer = createRasterLayerDescriptor({
    id: 'base',
    type: 'image',
    x: 100,
    y: 50,
    width: 1024,
    height: 512,
    originalWidth: 2048,
    originalHeight: 1024,
    name: 'hero.png',
    content: PNG_1X1,
  }, frame)

  assert.equal(layer.left, 0)
  assert.equal(layer.top, 0)
  assert.equal(layer.width, 2048)
  assert.equal(layer.height, 1024)
  assert.equal(layer.isBaseImage, true)
})

test('PSD model excludes elements completely outside the selected base image frame', () => {
  const model = buildCanvasPsdModel({
    elements: [
      {
        id: 'base',
        type: 'image',
        x: 100,
        y: 50,
        width: 1024,
        height: 512,
        originalWidth: 2048,
        originalHeight: 1024,
        name: 'hero.png',
        content: PNG_1X1,
      },
      {
        id: 'outside',
        type: 'image',
        x: 2000,
        y: 2000,
        width: 200,
        height: 100,
        originalWidth: 400,
        originalHeight: 200,
        name: 'other.png',
        content: PNG_1X1,
      },
    ],
    selectedIds: ['base'],
    title: 'hero',
  })

  assert.deepEqual(model.children.map((layer) => layer.original.id), ['base'])
})

test('selected image PSD model exports only the requested image even when other canvas images overlap', () => {
  const model = buildSelectedImagePsdModel({
    elements: [
      {
        id: 'selected',
        type: 'image',
        x: 100,
        y: 50,
        width: 500,
        height: 500,
        originalWidth: 1000,
        originalHeight: 1000,
        name: 'selected.png',
        content: PNG_1X1,
      },
      {
        id: 'overlap',
        type: 'image',
        x: 120,
        y: 80,
        width: 200,
        height: 200,
        originalWidth: 200,
        originalHeight: 200,
        name: 'overlap.png',
        content: PNG_1X1,
      },
      {
        id: 'text',
        type: 'text',
        x: 150,
        y: 150,
        width: 120,
        height: 40,
        content: '不应导出',
      },
    ],
    imageId: 'selected',
    title: '画布',
  })

  assert.equal(model.width, 1000)
  assert.equal(model.height, 1000)
  assert.equal(model.children.length, 1)
  assert.equal(model.children[0].original.id, 'selected')
  assert.equal(model.fileName, 'selected.psd')
})

test('selected image PSD model defaults to one full original image layer instead of color-split fragments', () => {
  const model = buildSelectedImagePsdModel({
    elements: [
      {
        id: 'selected',
        type: 'image',
        x: 100,
        y: 50,
        width: 500,
        height: 500,
        originalWidth: 1000,
        originalHeight: 1000,
        name: 'selected.png',
        content: PNG_1X1,
      },
    ],
    imageId: 'selected',
    title: '画布',
  })

  assert.equal(model.children.length, 1)
  assert.equal(model.children[0].kind, 'image')
  assert.equal(model.children[0].name, 'Original Image selected')
  assert.equal(model.children[0].left, 0)
  assert.equal(model.children[0].top, 0)
  assert.equal(model.children[0].width, 1000)
  assert.equal(model.children[0].height, 1000)
})

test('selected image PSD model can add OCR text as editable Photoshop text layers above the raster image', () => {
  const model = buildSelectedImagePsdModel({
    elements: [
      {
        id: 'selected',
        type: 'image',
        x: 100,
        y: 50,
        width: 500,
        height: 500,
        originalWidth: 1000,
        originalHeight: 1000,
        name: 'selected.png',
        content: PNG_1X1,
      },
    ],
    imageId: 'selected',
    ocrTextLayers: [
      {
        text: '可编辑',
        bbox: { x: 120, y: 80, width: 320, height: 72 },
        fontSize: 58,
        color: '#ffffff',
        align: 'center',
        fontWeight: 'bold',
      },
    ],
    title: '画布',
  })

  assert.equal(model.children.length, 2)
  assert.equal(model.children[0].kind, 'text')
  assert.equal(model.children[0].text.text, '可编辑')
  assert.equal(model.children[0].text.paragraphStyle.justification, 'center')
  assert.equal(model.children[0].text.style.fauxBold, true)
  assert.equal(model.children[1].kind, 'image')
  assert.equal(model.ocrTextLayerCount, 1)
})

test('selected image PSD model adds coarse semantic raster layers when image analysis provides a PSD layer plan', () => {
  const model = buildSelectedImagePsdModel({
    elements: [
      {
        id: 'selected',
        type: 'image',
        x: 100,
        y: 50,
        width: 500,
        height: 500,
        originalWidth: 1000,
        originalHeight: 1000,
        name: 'selected.png',
        content: PNG_1X1,
      },
    ],
    imageId: 'selected',
    ocrTextLayers: [
      {
        text: 'SALE',
        bbox: { x: 110, y: 40, width: 240, height: 70 },
        fontSize: 56,
      },
    ],
    semanticLayers: [
      {
        name: 'Main product',
        type: 'subject',
        bbox: { x: 180, y: 220, width: 460, height: 560 },
        zIndex: 10,
      },
      {
        name: 'Red badge',
        type: 'decoration',
        bbox: { x: 620, y: 90, width: 180, height: 180 },
        zIndex: 20,
      },
      {
        name: 'Flat background',
        type: 'background',
        bbox: { x: 0, y: 0, width: 1000, height: 1000 },
        zIndex: 0,
      },
    ],
    title: '画布',
  })

  assert.equal(model.width, 1000)
  assert.equal(model.height, 1000)
  assert.equal(model.ocrTextLayerCount, 1)
  assert.equal(model.semanticLayerCount, 2)
  assert.deepEqual(model.children.map((layer) => layer.kind), [
    'text',
    'semantic-image',
    'semantic-image',
    'image',
  ])
  assert.deepEqual(model.children.map((layer) => layer.name), [
    'Text OCR 01 SALE',
    'Decoration 02 Red badge',
    'Subject 01 Main product',
    'Original Image selected',
  ])
  assert.deepEqual(model.children[1].sourceRect, { x: 620, y: 90, width: 180, height: 180 })
  assert.deepEqual(model.children[2].sourceRect, { x: 180, y: 220, width: 460, height: 560 })
  assert.equal(model.children[1].source, PNG_1X1)
})

test('selected image PSD model prefers model extracted transparent layers and clean background over rectangle crops', () => {
  const CUTOUT = 'data:image/png;base64,Y3V0b3V0'
  const CLEAN_BG = 'data:image/png;base64,YmFja2dyb3VuZA=='
  const model = buildSelectedImagePsdModel({
    elements: [
      {
        id: 'selected',
        type: 'image',
        x: 100,
        y: 50,
        width: 500,
        height: 500,
        originalWidth: 1000,
        originalHeight: 1000,
        name: 'selected.png',
        content: PNG_1X1,
      },
    ],
    imageId: 'selected',
    extractedLayers: [
      {
        name: 'Main product',
        type: 'subject',
        bbox: { x: 180, y: 220, width: 460, height: 560 },
        dataUrl: CUTOUT,
        zIndex: 40,
      },
    ],
    semanticLayers: [
      {
        name: 'Rect fallback should not be used',
        type: 'subject',
        bbox: { x: 10, y: 20, width: 30, height: 40 },
        zIndex: 10,
      },
    ],
    backgroundLayer: {
      name: 'Clean Background',
      dataUrl: CLEAN_BG,
      repaired: true,
    },
    title: '画布',
  })

  assert.equal(model.children.length, 2)
  assert.deepEqual(model.children.map((layer) => layer.name), [
    'Subject 01 Main product',
    'Clean Background',
  ])
  assert.deepEqual(model.children.map((layer) => layer.kind), ['image', 'image'])
  assert.equal(model.children[0].source, CUTOUT)
  assert.equal(model.children[0].left, 0)
  assert.equal(model.children[0].top, 0)
  assert.equal(model.children[0].width, 1000)
  assert.equal(model.children[0].height, 1000)
  assert.equal(model.children[0].original.type, 'extracted-image')
  assert.equal(model.children[0].original.semanticType, 'subject')
  assert.equal(model.children[1].source, CLEAN_BG)
  assert.equal(model.children[1].original.type, 'clean-background')
  assert.equal(model.semanticLayerCount, 1)
  assert.equal(model.extractedLayerCount, 1)
  assert.equal(model.backgroundRepaired, true)
  assert.equal(model.warnings.length, 0)
})

test('PSD alpha classifier rejects opaque checkerboard images as fake transparency', () => {
  const data = []
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const value = (x + y) % 2 ? 204 : 255
      data.push(value, value, value, 255)
    }
  }

  const result = classifyPsdAlphaImageData({
    width: 8,
    height: 8,
    data: new Uint8ClampedArray(data),
  })

  assert.equal(result.hasRealAlpha, false)
  assert.equal(result.likelyCheckerboard, true)
  assert.equal(result.isUsableTransparentCutout, false)
})

test('PSD alpha classifier accepts images with real alpha pixels', () => {
  const data = []
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const inside = x >= 2 && x <= 5 && y >= 2 && y <= 5
      data.push(255, 0, 0, inside ? 255 : 0)
    }
  }

  const result = classifyPsdAlphaImageData({
    width: 8,
    height: 8,
    data: new Uint8ClampedArray(data),
  })

  assert.equal(result.hasRealAlpha, true)
  assert.equal(result.likelyCheckerboard, false)
  assert.equal(result.isUsableTransparentCutout, true)
})

test('PSD checkerboard repair converts edge-connected fake transparency into real alpha', () => {
  const data = []
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const inside = x >= 3 && x <= 4 && y >= 3 && y <= 4
      const value = (x + y) % 2 ? 204 : 255
      data.push(inside ? 255 : value, inside ? 0 : value, inside ? 0 : value, 255)
    }
  }

  const repaired = repairPsdCheckerboardTransparency({
    width: 8,
    height: 8,
    data: new Uint8ClampedArray(data),
  })
  const result = classifyPsdAlphaImageData(repaired.imageData)

  assert.equal(repaired.changedPixelCount, 60)
  assert.equal(result.isUsableTransparentCutout, true)
})

test('PSD extracted layer validation repairs checkerboard cutouts when an encoder is provided', async () => {
  const data = []
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const inside = x >= 3 && x <= 4 && y >= 3 && y <= 4
      const value = (x + y) % 2 ? 204 : 255
      data.push(inside ? 255 : value, inside ? 0 : value, inside ? 0 : value, 255)
    }
  }

  const result = await validatePsdExtractedLayers([
    { name: 'Main product', dataUrl: 'data:image/png;base64,b2xk' },
  ], async () => ({
    width: 8,
    height: 8,
    data: new Uint8ClampedArray(data),
  }), {
    encodeImageData: async () => 'data:image/png;base64,cmVwYWlyZWQ=',
  })

  assert.equal(result.extractedLayers.length, 1)
  assert.equal(result.extractedLayers[0].dataUrl, 'data:image/png;base64,cmVwYWlyZWQ=')
  assert.equal(result.extractedLayers[0].alphaStatus, 'repaired')
  assert.match(result.warnings[0], /已自动转换为真实 alpha/)
})

test('OCR text layer descriptors fall back to a safe Photoshop font descriptor', () => {
  const layer = createOcrTextLayerDescriptor({
    text: 'COMING SOON',
    bbox: { x: 20, y: 30, width: 300, height: 60 },
    fontFamily: 'Imaginary Poster Font',
  }, 0)

  assert.deepEqual(layer.text.style.font, {
    name: 'ArialMT',
    script: 0,
    type: 0,
    synthetic: 0,
  })
})

test('selected image PSD model uses semantic layer type priority when z-index is unreliable', () => {
  const CUTOUT = 'data:image/png;base64,Y3V0b3V0'
  const model = buildSelectedImagePsdModel({
    elements: [
      {
        id: 'selected',
        type: 'image',
        x: 0,
        y: 0,
        width: 1000,
        height: 1000,
        originalWidth: 1000,
        originalHeight: 1000,
        name: 'selected.png',
        content: PNG_1X1,
      },
    ],
    imageId: 'selected',
    extractedLayers: [
      {
        name: 'Main subject',
        type: 'subject',
        bbox: { x: 200, y: 200, width: 500, height: 600 },
        dataUrl: CUTOUT,
        zIndex: 900,
      },
      {
        name: 'Ground shadow',
        type: 'shadow',
        bbox: { x: 180, y: 760, width: 560, height: 90 },
        dataUrl: CUTOUT,
        zIndex: 950,
      },
      {
        name: 'Brand logo',
        type: 'logo',
        bbox: { x: 100, y: 80, width: 220, height: 80 },
        dataUrl: CUTOUT,
        zIndex: 10,
      },
    ],
    backgroundLayer: {
      name: 'Clean Background',
      dataUrl: CUTOUT,
      repaired: true,
    },
    title: '画布',
  })

  assert.deepEqual(model.children.map((layer) => layer.name), [
    'Logo 03 Brand logo',
    'Subject 01 Main subject',
    'Shadow 02 Ground shadow',
    'Clean Background',
  ])
})

test('semantic raster layer descriptors clamp layer bounds to the selected image pixel canvas', () => {
  const layer = createSemanticRasterLayerDescriptor({
    name: 'Hero object',
    type: 'subject',
    bbox: { x: -20, y: 40, width: 180, height: 90 },
    confidence: 0.82,
  }, {
    source: PNG_1X1,
    width: 120,
    height: 100,
    original: { id: 'selected', type: 'image' },
  }, {
    width: 120,
    height: 100,
  }, 0)

  assert.equal(layer.kind, 'semantic-image')
  assert.equal(layer.name, 'Subject 01 Hero object')
  assert.equal(layer.left, 0)
  assert.equal(layer.top, 40)
  assert.equal(layer.width, 120)
  assert.equal(layer.height, 60)
  assert.deepEqual(layer.sourceRect, { x: 0, y: 40, width: 120, height: 60 })
  assert.equal(layer.original.type, 'semantic-image')
  assert.equal(layer.original.semanticType, 'subject')
  assert.equal(layer.original.confidence, 0.82)
})

test('OCR text layer descriptors keep original image pixel coordinates for editable Photoshop text', () => {
  const layer = createOcrTextLayerDescriptor({
    text: 'SALE',
    bbox: { x: 120.4, y: 80.2, width: 300.1, height: 64.7 },
    fontSize: 56,
    color: '#fff',
    align: 'center',
    fontWeight: 'bold',
    fontStyle: 'italic',
    fontFamily: 'Noto Sans SC',
    confidence: 0.92,
  }, 0)

  assert.equal(layer.kind, 'text')
  assert.equal(layer.name, 'Text OCR 01 SALE')
  assert.equal(layer.left, 120)
  assert.equal(layer.top, 80)
  assert.equal(layer.width, 300)
  assert.equal(layer.height, 65)
  assert.deepEqual(layer.text.transform, [1, 0, 0, 1, 120, 80])
  assert.deepEqual(layer.text.boxBounds, [0, 0, 300, 65])
  assert.equal(layer.text.style.fontSize, 56)
  assert.equal(layer.text.style.fauxBold, true)
  assert.equal(layer.text.style.fauxItalic, true)
  assert.deepEqual(layer.text.style.fillColor, { r: 255, g: 255, b: 255 })
  assert.equal(layer.text.paragraphStyle.justification, 'center')
  assert.equal(layer.original.type, 'ocr-text')
})

test('color split creates multiple full-image cluster layers from one flat image', () => {
  const imageData = {
    width: 4,
    height: 1,
    data: new Uint8ClampedArray([
      255, 0, 0, 255,
      250, 0, 0, 255,
      0, 0, 255, 255,
      0, 0, 245, 255,
    ]),
  }

  const split = splitImageDataIntoColorClusters(imageData, { colorCount: 2, maxSamplePixels: 4, iterations: 4 })

  assert.equal(split.width, 4)
  assert.equal(split.height, 1)
  assert.equal(split.clusters.length, 2)
  assert.deepEqual(split.clusters.map((cluster) => cluster.pixelCount).sort((a, b) => b - a), [2, 2])
  assert.equal(new Set(split.assignments).size, 2)
})
