import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { ensureImageExtension } from '../public/js/shared.js'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8')
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))

test('inline and stored image downloads preserve bytes and use the browser blob lifecycle', async () => {
  const downloads = []
  const context = { fetch, downloadBlob: (blob, name) => downloads.push({ blob, name }), ensureImageExtension: name => name }
  vm.createContext(context)
  vm.runInContext(section('async function downloadAsset(', 'async function copyTextToClipboard('), context)
  const bytes = Uint8Array.from([137, 80, 78, 71, 0, 255])
  await context.downloadAsset(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`, 'inline.png')
  assert.equal(downloads[0].name, 'inline.png')
  assert.deepEqual(new Uint8Array(await downloads[0].blob.arrayBuffer()), bytes)
  context.fetch = async () => new Response(bytes, { headers: { 'Content-Type': 'image/png' } })
  await context.downloadAsset('/api/results/owned-asset', 'stored.png')
  assert.deepEqual(new Uint8Array(await downloads[1].blob.arrayBuffer()), bytes)
  context.fetch = async () => new Response('denied', { status: 403 })
  await assert.rejects(context.downloadAsset('/api/results/forbidden', 'denied.png'), /HTTP 403/)
  assert.equal(downloads.length, 2)
})

test('download URLs stay usable until navigation starts and are eventually released', () => {
  const events = [], timers = []
  const anchor = { click: () => events.push('click'), remove: () => events.push('remove') }
  const context = {
    document: { createElement: () => anchor, body: { append: () => events.push('append') } },
    URL: { createObjectURL: () => 'blob:image', revokeObjectURL: url => events.push(`release ${url}`) },
    window: { setTimeout: (fn, delay) => timers.push({ fn, delay }) },
  }
  vm.createContext(context)
  vm.runInContext(section('function downloadBlob(', 'function formatCanvasRgbColor('), context)
  context.downloadBlob({}, 'image.png')
  assert.deepEqual(events, ['append', 'click', 'remove'])
  assert.equal(anchor.download, 'image.png')
  assert.equal(anchor.href, 'blob:image')
  assert.ok(timers[0].delay > 0 && timers[0].delay <= 60_000)
  timers[0].fn()
  assert.equal(events.at(-1), 'release blob:image')
})


test('HTTP JPEG download without a filename extension uses its response MIME', async () => {
  let saved
  const context = { fetch: async () => new Response(Uint8Array.from([255,216,255,217]), { headers:{'Content-Type':'image/jpeg'} }),
    ensureImageExtension, downloadBlob:(blob,name)=>{saved={blob,name}} }
  vm.createContext(context)
  vm.runInContext(section('async function downloadAsset(', 'async function copyTextToClipboard('), context)
  await context.downloadAsset('/api/results/jpeg-asset', '蓝色茶壶')
  assert.equal(saved.name,'蓝色茶壶.jpg')
  assert.equal(saved.blob.type,'image/jpeg')
})
