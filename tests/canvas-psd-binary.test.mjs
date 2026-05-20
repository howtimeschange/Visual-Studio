import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadAgPsd() {
  const source = await readFile(new URL('../public/vendor/ag-psd/ag-psd.bundle.js', import.meta.url), 'utf8')
  const sandbox = {
    console,
    Uint8Array,
    Uint8ClampedArray,
    ArrayBuffer,
    DataView,
    setTimeout,
    clearTimeout,
  }
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.global = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  sandbox.agPsd.initializeCanvas(createTestCanvas, createTestImageData)
  return sandbox.agPsd
}

function createTestImageData(width, height, data = null) {
  return {
    width,
    height,
    data: data || new Uint8ClampedArray(width * height * 4),
  }
}

function createTestCanvas(width, height) {
  let imageData = createTestImageData(width, height)
  return {
    width,
    height,
    getContext() {
      return {
        createImageData: createTestImageData,
        getImageData: () => imageData,
        putImageData: (nextImageData) => {
          imageData = nextImageData
        },
        drawImage: () => {},
        scale: () => {},
      }
    },
  }
}

function solidImageData(width, height, color) {
  const [r, g, b, a] = color
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = r
    data[offset + 1] = g
    data[offset + 2] = b
    data[offset + 3] = a
  }
  return { width, height, data }
}

test('generated PSD binary can be read back with named raster and editable text layers', async () => {
  const agPsd = await loadAgPsd()
  const psd = {
    width: 64,
    height: 48,
    children: [
      {
        name: 'Text OCR 01 Sale',
        left: 8,
        top: 10,
        imageData: solidImageData(24, 8, [255, 64, 64, 255]),
        text: {
          text: 'Sale',
          transform: [1, 0, 0, 1, 8, 10],
          shapeType: 'box',
          boxBounds: [0, 0, 80, 30],
          style: {
            font: { name: 'ArialMT', script: 0, type: 0, synthetic: 0 },
            fontSize: 18,
            fillColor: { r: 255, g: 255, b: 255 },
          },
          paragraphStyle: { justification: 'center' },
        },
      },
      {
        name: 'Main subject',
        left: 20,
        top: 14,
        imageData: solidImageData(16, 20, [40, 180, 120, 190]),
      },
      {
        name: 'Clean Background',
        left: 0,
        top: 0,
        imageData: solidImageData(64, 48, [245, 245, 238, 255]),
      },
    ],
  }

  const buffer = agPsd.writePsd(psd, {
    noBackground: true,
    invalidateTextLayers: true,
    trimImageData: true,
  })
  const parsed = agPsd.readPsd(buffer, { useImageData: true })

  assert.equal(parsed.width, 64)
  assert.equal(parsed.height, 48)
  assert.deepEqual(Array.from(parsed.children, (layer) => layer.name), [
    'Text OCR 01 Sale',
    'Main subject',
    'Clean Background',
  ])
  assert.equal(parsed.children[0].text.text, 'Sale')
  assert.equal(parsed.children[1].left, 20)
  assert.equal(parsed.children[1].top, 14)
  assert.equal(parsed.children[1].imageData.width, 16)
  assert.equal(parsed.children[2].imageData.height, 48)
})
