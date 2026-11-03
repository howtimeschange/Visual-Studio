import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`)
  const args = source.indexOf(')', start)
  const open = source.indexOf('{', args)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
  }
  throw new Error(`Missing function ${name}`)
}

test('concurrent batch progress updates coalesce and the final progress is retained', async () => {
  const source = await readFile(new URL('../functions/_lib/v2-runner.ts', import.meta.url), 'utf8')
  let reads = 0, latest = 0
  const emitted = []
  const context = { updateJobCounts: async () => { reads++; return { progressDone: latest } }, publishJobProgress: async (_env, job) => { emitted.push(job.progressDone) } }
  vm.createContext(context)
  // This helper has only two TypeScript parameter annotations.
  vm.runInContext(functionSource(source, 'queueProgressPublisher').replace('(env: Env, jobId: string)', '(env, jobId)'), context)
  const publisher = context.queueProgressPublisher({}, 'job')
  for (let i = 1; i <= 10; i++) { latest = i; publisher.publish() }
  await publisher.drain()
  assert.equal(reads, 1)
  assert.deepEqual(emitted, [10])
  latest = 11
  publisher.publish()
  await publisher.drain()
  assert.deepEqual(emitted, [10, 11])
})

test('canvas rerenders do not reset a relative image URL or refetch its pixels', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  let srcWrites = 0
  const image = { getAttribute: name => name === 'src' ? '/api/results/asset-1' : null, get src() { return 'http://localhost/api/results/asset-1' }, set src(_value) { srcWrites++ } }
  const element = { id: 'one', type: 'image', content: '/api/results/asset-1', x: 1, y: 1, width: 10, height: 10 }
  const node = { dataset: { elId: 'one', elType: 'image' }, style: {}, classList: { toggle() {} }, querySelector: name => name === '.canvas-el-image' ? image : null }
  const context = { state: { generate: { elements: [element], selectedIds: [] } }, dom: { gCanvas: {}, gCanvasEmpty: { classList: { toggle() {} } } }, $$: () => [node], getLinkedCanvasElementIds: () => new Set(), renderCanvasGuide() {}, updateCanvasTransform() {}, renderConnectors() {}, renderDesignAgentContext() {} }
  vm.createContext(context)
  vm.runInContext(functionSource(source, 'renderCanvas'), context)
  for (let i = 0; i < 20; i++) context.renderCanvas()
  assert.equal(srcWrites, 0)
  element.content = '/api/results/new-asset'
  context.renderCanvas()
  assert.equal(srcWrites, 1)
  element.content = ''
  context.renderCanvas()
  assert.equal(srcWrites, 1, 'an unhydrated cached image does not issue an empty-src request or flash an error')
})

test('PSD dependency loads only on export, shares concurrent requests and allows retry after failure', async () => {
  const scripts = []
  const oldWindow = globalThis.window, oldDocument = globalThis.document
  globalThis.window = { setTimeout, clearTimeout }
  globalThis.document = { createElement: () => ({ remove() {} }), head: { append: script => scripts.push(script) } }
  try {
    const { loadPsdLibrary } = await import(`../public/js/psd-loader.js?t=${Date.now()}`)
    assert.equal(scripts.length, 0)
    const first = loadPsdLibrary(), second = loadPsdLibrary()
    assert.equal(first, second)
    assert.equal(scripts.length, 1)
    scripts[0].onerror()
    await assert.rejects(first, /加载失败/)
    const retried = loadPsdLibrary()
    assert.equal(scripts.length, 2)
    window.agPsd = { writePsd() {} }
    scripts[1].onload()
    assert.equal(await retried, window.agPsd)
    assert.equal(await loadPsdLibrary(), window.agPsd)
    const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8')
    assert.doesNotMatch(html, /<script[^>]+ag-psd/)
  } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument
  }
})

test('canvas remembers an accepted job before polling and resumes that job after reauthorization', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  const calls = []
  let remembered = ''
  const context = {
    state: { runtime: {}, generate: { projectId: 'project', genModel: '', genRatio: '1:1', genResolution: '1k' } },
    dom: { gModel: {}, gGenRatio: {}, gGenResolution: {} },
    shouldUseAsyncCanvasGenerate: () => true,
    normalizeAspectRatio: value => value, normalizeCanvasResolution: value => value,
    postJson: async (url) => { calls.push(url); return { jobId: 'accepted-job' } },
    getJson: async () => ({ job: { status: 'failed', configJson: { modelId: 'gpt-image-2.5-sunburst' } } }),
    waitForCanvasGenerateJob: async (id) => { assert.equal(remembered, id); throw new Error('reauthorize') },
  }
  vm.createContext(context)
  vm.runInContext(`async ${functionSource(source, 'requestCanvasGenerate')}`, context)
  await assert.rejects(context.requestCanvasGenerate({}, { onSubmitted: id => { remembered = id } }), /reauthorize/)
  assert.equal(remembered, 'accepted-job')
  context.waitForCanvasGenerateJob = async id => ({ jobId: id })
  const resumed = await context.requestCanvasGenerate({}, { resumeJobId: remembered })
  assert.equal(resumed.jobId, remembered)
  assert.deepEqual(calls, ['/api/jobs/generate-direct', '/api/jobs/accepted-job/retry'])
  assert.equal(context.dom.gModel.value, 'gpt-image-2.5-sunburst')
})
