import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const APP_PATH = new URL('../public/app.js', import.meta.url)
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  const asyncStart = source.indexOf(`async function ${name}(`)
  const actualStart = start === -1 ? asyncStart : (asyncStart === -1 ? start : Math.min(start, asyncStart))
  if (actualStart === -1) return ''
  const paramsEnd = source.indexOf(')', actualStart)
  const bodyStart = source.indexOf('{', paramsEnd)
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(actualStart, index + 1)
  }
  throw new Error(`Could not extract function ${name}`)
}

async function createJobHarness() {
  const source = await readFile(APP_PATH, 'utf8')
  const context = {
    KNOWN_JOB_STATUSES: new Set(['', 'queued', 'running', 'paused', 'completed', 'partial_failed', 'failed', 'cancelled']),
    ACTIVE_JOB_STATUSES: new Set(['queued', 'running']),
    CURRENT_TASK_JOB_STATUSES: new Set(['queued', 'running', 'paused', 'partial_failed', 'failed']),
    JOB_TASKS_PER_PAGE: 5,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    sanitizeFileName: (value) => String(value || '').replace(/[\\/:*?"<>|]+/g, '-'),
    basename: (value) => String(value || '').replace(/\.[^.]+$/, ''),
    getModel: (id) => ({
      'nano-banana-2': { id: 'nano-banana-2', label: 'Nano Banana 2' },
      'nano-banana-pro': { id: 'nano-banana-pro', label: 'Nano Banana Pro' },
      'gpt-image-2': { id: 'gpt-image-2', label: 'GPT Image 2' },
    })[id],
    JOB_DOWNLOAD_CONCURRENCY: 3,
    wait: async () => {},
    downloadAsset: async () => {},
    translateWorkspaceLoadToken: 0,
    outfitWorkspaceLoadToken: 0,
    styleWorkspaceLoadToken: 0,
    aiTestWorkspaceLoadToken: 0,
    fetchJobSnapshot: async () => ({ job: null, items: [] }),
    hydrateTranslateWorkspaceFromJob: async () => {},
    hydrateOutfitWorkspaceFromJob: async () => {},
    hydrateStyleWorkspaceFromJob: async () => {},
    hydrateAiTestWorkspaceFromJob: async () => {},
    applyTranslateJobSnapshot: () => {},
    applyOutfitJobSnapshot: () => {},
    applyStyleJobSnapshot: () => {},
    applyAiTestJobSnapshot: () => {},
    syncTranslateJob: () => {},
    syncOutfitJob: () => {},
    syncStyleJob: () => {},
    syncAiTestJob: () => {},
    saveRuntimeState: () => {},
    formatBatchProgress: (job) => `${Number(job?.progressDone || 0)} / ${Number(job?.progressTotal || 0)}`,
    formatRelativeTime: () => '刚刚',
    renderTranslate: () => {},
    renderOutfit: () => {},
    renderStyle: () => {},
    renderAiTest: () => {},
    renderTranslateDropdowns: () => {},
    trimError: (error) => String(error?.message || error || ''),
    showAuthView: () => {},
    window: { location: { pathname: '/', search: '' } },
    state: {
      translate: { jobs: [], jobId: '', jobTab: 'current', progress: '' },
      outfit: { jobs: [], jobId: '', jobTab: 'current', models: [], garments: [], results: {}, progress: '' },
      style: { jobs: [], jobId: '', jobTab: 'current', resultDataUrl: '', progress: '' },
      aiTest: { jobs: [], jobId: '', jobTab: 'current', images: [], results: {}, progress: '' },
    },
    translateJobWatchers: new Map(),
    outfitJobWatchers: new Map(),
    styleJobWatchers: new Map(),
    aiTestJobWatchers: new Map(),
  }
  const createElement = (tagName) => {
    const node = {
      tagName,
      children: [],
      dataset: {},
      className: '',
      textContent: '',
      disabled: false,
      attributes: {},
      classList: {
        values: new Set(),
        toggle(name, force) {
          const active = force === undefined ? !this.values.has(name) : Boolean(force)
          if (active) this.values.add(name)
          else this.values.delete(name)
          return active
        },
        add(name) {
          this.values.add(name)
        },
        remove(name) {
          this.values.delete(name)
        },
        contains(name) {
          return this.values.has(name)
        },
      },
      append(...children) {
        this.children.push(...children)
      },
      replaceChildren(...children) {
        this.children = children
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value)
      },
      addEventListener() {},
    }
    return node
  }
  const createPanel = () => ({
    list: createElement('div'),
    empty: createElement('span'),
    tabs: [
      { dataset: { jobTab: 'current' }, classList: createElement('button').classList, setAttribute() {}, textContent: '' },
      { dataset: { jobTab: 'history' }, classList: createElement('button').classList, setAttribute() {}, textContent: '' },
    ],
  })
  const translatePanel = createPanel()
  const outfitPanel = createPanel()
  const stylePanel = createPanel()
  const aiTestPanel = createPanel()
  context.document = {
    createElement,
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
  }
  context.dom = {
    tJobList: translatePanel.list,
    tJobEmpty: translatePanel.empty,
    tJobTabs: translatePanel.tabs,
    oJobList: outfitPanel.list,
    oJobEmpty: outfitPanel.empty,
    oJobTabs: outfitPanel.tabs,
    sJobList: stylePanel.list,
    sJobEmpty: stylePanel.empty,
    sJobTabs: stylePanel.tabs,
    aiTestJobList: aiTestPanel.list,
    aiTestJobEmpty: aiTestPanel.empty,
    aiTestJobTabs: aiTestPanel.tabs,
  }
  const functionNames = [
    'base64Bytes',
    'hasImageMagicBytes',
    'normalizeImageResultSrc',
    'assetImageSrc',
    'looksLikeBase64Blob',
    'isMachineImageName',
    'readableAssetLabel',
    'sanitizeJobTaskThumbs',
    'serializeJobTask',
    'sanitizeStoredJobTasks',
    'getLoadedStoredJobId',
    'getJobTasks',
    'getLoadedJobId',
    'getJobTab',
    'getJobPage',
    'setJobTab',
    'setJobPage',
    'setLoadedJobId',
    'makeJobTask',
    'upsertJobTask',
    'markJobTaskLoaded',
    'clearJobTaskLoaded',
    'removeJobTask',
    'resetLoadedWorkspaceForDraft',
    'getJobTaskBucket',
    'filterJobTasksForTab',
    'releaseCompletedLoadedTasksForKind',
    'getTaskSortTime',
    'getSortedJobTasksForTab',
    'getPagedJobTasksForTab',
    'getJobTaskPageCount',
    'clampJobTaskPage',
    'getJobTaskDownloadEntries',
    'getJobTaskThumbsFromWorkspace',
    'addJobTaskThumbFromItem',
    'updateJobTaskFromJob',
    'createJobTaskLabel',
    'getJobPanelDom',
    'renderJobList',
    'createJobTaskCard',
    'shouldShowJobTaskDownload',
    'createJobTaskThumbs',
    'getJobTypeLabel',
    'getJobStatusLabel',
    'getJobStatusTone',
    'createJobPagination',
    'loadJobIntoWorkspace',
    'downloadAll',
    'classifyJobItemFailure',
    'formatJobItemFailureMessage',
    'summarizeJobItemFailures',
    'shouldShowLoadedJobWorkspace',
    'assetResultUrl',
    'addJobTaskThumb',
    'getJobTaskThumbsFromItems',
  ]
  const harnessSource = functionNames.map((name) => extractFunction(source, name)).filter(Boolean).join('\n')
  vm.createContext(context)
  vm.runInContext(harnessSource, context)
  return context
}

async function flushMicrotasks(count = 4) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve()
  }
}

async function waitForCondition(predicate, attempts = 20) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return
    await flushMicrotasks()
  }
}

test('sanitizeStoredJobTasks keeps only tasks matching the current view type', async () => {
  const harness = await createJobHarness()
  const result = harness.sanitizeStoredJobTasks([
    { jobId: 'job-outfit', type: 'outfit_batch', status: 'queued', label: 'outfit' },
    { jobId: 'job-ai-test', type: 'ai_test_batch', status: 'queued', label: 'ai test' },
    { jobId: 'job-translate', type: 'translate_batch', status: 'queued', label: 'translate' },
    { jobId: 'job-empty', type: '', status: 'queued', label: 'empty' },
  ], '', 'outfit_batch')

  assert.deepEqual(Array.from(result).map((task) => task.jobId), ['job-outfit'])
})

test('ai test tasks are isolated in the aiTest job list', async () => {
  const harness = await createJobHarness()
  const result = harness.sanitizeStoredJobTasks([
    { jobId: 'job-outfit', type: 'outfit_batch', status: 'queued', label: 'outfit' },
    { jobId: 'job-ai-test', type: 'ai_test_batch', status: 'queued', label: 'ai test' },
    { jobId: 'job-style', type: 'style_transfer_batch', status: 'queued', label: 'style' },
  ], '', 'ai_test_batch')

  assert.deepEqual(Array.from(result).map((task) => task.jobId), ['job-ai-test'])
})

test('ai test job panel renders into ai test container only', async () => {
  const harness = await createJobHarness()
  harness.state.aiTest.jobs = [
    {
      jobId: 'job-ai-test',
      type: 'ai_test_batch',
      status: 'queued',
      label: 'AI 测图任务',
      loaded: true,
      thumbs: [],
    },
  ]

  harness.renderJobList('aiTest')

  assert.equal(harness.dom.aiTestJobList.children.length, 1)
  assert.equal(harness.dom.oJobList.children.length, 0)
  assert.equal(harness.dom.aiTestJobEmpty.classList.contains('hidden'), true)
  assert.equal(harness.dom.oJobEmpty.classList.contains('hidden'), false)
})

test('loading an ai test job hydrates the ai test workspace', async () => {
  const harness = await createJobHarness()
  const calls = []
  const job = {
    id: 'job-ai-test',
    type: 'ai_test_batch',
    status: 'completed',
    progressTotal: 1,
    progressDone: 1,
    createdAt: '2026-06-12T08:00:00.000Z',
  }
  const items = [{
    id: 'item-1',
    itemType: 'ai_test_cell',
    status: 'completed',
    inputJson: { imageAssetId: 'source-1', groupIndex: 1 },
    outputJson: { resultAssetId: 'result-1', finalPrompt: 'final prompt' },
  }]
  harness.fetchJobSnapshot = async (jobId) => {
    calls.push(['fetch', jobId])
    return { job, items }
  }
  harness.hydrateAiTestWorkspaceFromJob = async (hydratedJob, hydratedItems) => {
    calls.push(['hydrate', hydratedJob.id, hydratedItems.length])
    harness.state.aiTest.images = [{ id: 'source-1', assetId: 'source-1' }]
  }
  harness.applyAiTestJobSnapshot = (appliedJob, appliedItems) => {
    calls.push(['apply', appliedJob.id, appliedItems.length])
    harness.state.aiTest.results['source-1::1'] = { status: 'done', assetId: 'result-1' }
  }

  await harness.loadJobIntoWorkspace('aiTest', 'job-ai-test')

  assert.deepEqual(calls, [
    ['fetch', 'job-ai-test'],
    ['hydrate', 'job-ai-test', 1],
    ['apply', 'job-ai-test', 1],
  ])
  assert.equal(harness.state.aiTest.jobId, 'job-ai-test')
  assert.equal(harness.state.aiTest.jobs[0].loaded, true)
  assert.equal(harness.state.aiTest.results['source-1::1'].assetId, 'result-1')
})

test('resetting an ai test draft clears loaded job images and results', async () => {
  const harness = await createJobHarness()
  harness.state.aiTest.jobId = 'old-job'
  harness.state.aiTest.jobs = [
    { jobId: 'old-job', type: 'ai_test_batch', status: 'completed', loaded: true, holdInCurrent: true },
  ]
  harness.state.aiTest.images = [{ id: 'old-source', assetId: 'old-source' }]
  harness.state.aiTest.results = {
    'old-source::1': { status: 'done', assetId: 'old-result' },
  }
  harness.state.aiTest.progress = '完成 1 / 1'

  harness.resetLoadedWorkspaceForDraft('aiTest')

  assert.equal(harness.state.aiTest.jobId, '')
  assert.equal(harness.state.aiTest.jobs[0].loaded, false)
  assert.equal(harness.state.aiTest.images.length, 0)
  assert.equal(Object.keys(harness.state.aiTest.results).length, 0)
  assert.equal(harness.state.aiTest.progress, '')
})

test('sanitizeStoredJobTasks preserves loaded active outfit jobs after refresh', async () => {
  const harness = await createJobHarness()
  const result = harness.sanitizeStoredJobTasks([
    { jobId: 'job-active-outfit', type: 'outfit_batch', status: 'running', loaded: true, label: 'outfit' },
  ], '', 'outfit_batch')

  assert.equal(result[0].jobId, 'job-active-outfit')
  assert.equal(result[0].loaded, true)
})

test('getLoadedStoredJobId restores loaded active jobs after refresh', async () => {
  const harness = await createJobHarness()
  const tasks = [
    { jobId: 'job-active-outfit', type: 'outfit_batch', status: 'running', loaded: true },
  ]

  assert.equal(harness.getLoadedStoredJobId(tasks), 'job-active-outfit')
})

test('filterJobTasksForTab separates current work from generated history', async () => {
  const harness = await createJobHarness()
  const tasks = [
    { jobId: 'queued-job', status: 'queued' },
    { jobId: 'running-job', status: 'running' },
    { jobId: 'paused-job', status: 'paused' },
    { jobId: 'partial-job', status: 'partial_failed' },
    { jobId: 'failed-job', status: 'failed' },
    { jobId: 'completed-job', status: 'completed' },
    { jobId: 'cancelled-job', status: 'cancelled' },
  ]

  assert.deepEqual(
    harness.filterJobTasksForTab(tasks, 'current').map((task) => task.jobId),
    ['queued-job', 'running-job', 'paused-job', 'partial-job', 'failed-job'],
  )
  assert.deepEqual(
    harness.filterJobTasksForTab(tasks, 'history').map((task) => task.jobId),
    ['completed-job', 'cancelled-job'],
  )
})

test('loaded completed jobs remain current until the user leaves and returns', async () => {
  const harness = await createJobHarness()
  harness.state.translate.jobId = 'just-completed'
  harness.state.translate.jobs = [
    { jobId: 'just-completed', status: 'completed', loaded: true, holdInCurrent: true, createdAt: '2026-05-15T10:00:00.000Z' },
    { jobId: 'older-completed', status: 'completed', loaded: false, createdAt: '2026-05-15T09:00:00.000Z' },
  ]

  assert.deepEqual(
    harness.filterJobTasksForTab(harness.state.translate.jobs, 'current').map((task) => task.jobId),
    ['just-completed'],
  )
  assert.deepEqual(
    harness.filterJobTasksForTab(harness.state.translate.jobs, 'history').map((task) => task.jobId),
    ['older-completed'],
  )
  assert.equal(harness.shouldShowLoadedJobWorkspace('translate'), true)

  harness.releaseCompletedLoadedTasksForKind('translate')

  assert.equal(harness.state.translate.jobId, '')
  assert.deepEqual(
    harness.filterJobTasksForTab(harness.state.translate.jobs, 'current').map((task) => task.jobId),
    [],
  )
  assert.deepEqual(
    harness.filterJobTasksForTab(harness.state.translate.jobs, 'history').map((task) => task.jobId),
    ['just-completed', 'older-completed'],
  )
})

test('markJobTaskLoaded keeps a single current task per view', async () => {
  const harness = await createJobHarness()
  harness.state.outfit.jobs = [
    { jobId: 'job-a', loaded: false },
    { jobId: 'job-b', loaded: false },
    { jobId: 'job-c', loaded: false },
  ]

  harness.markJobTaskLoaded('outfit', 'job-b')
  assert.equal(harness.state.outfit.jobId, 'job-b')
  assert.deepEqual(
    harness.state.outfit.jobs.map((task) => ({ jobId: task.jobId, loaded: task.loaded })),
    [
      { jobId: 'job-a', loaded: false },
      { jobId: 'job-b', loaded: true },
      { jobId: 'job-c', loaded: false },
    ],
  )

  harness.markJobTaskLoaded('outfit', 'job-c')
  assert.equal(harness.state.outfit.jobId, 'job-c')
  assert.deepEqual(
    harness.state.outfit.jobs.map((task) => ({ jobId: task.jobId, loaded: task.loaded })),
    [
      { jobId: 'job-a', loaded: false },
      { jobId: 'job-b', loaded: false },
      { jobId: 'job-c', loaded: true },
    ],
  )
})

test('history tasks stay sorted by created time when viewing an older result', async () => {
  const harness = await createJobHarness()
  const tasks = [
    { jobId: 'older-completed', status: 'completed', createdAt: '2026-05-06T10:00:00.000Z', loaded: true },
    { jobId: 'newer-cancelled', status: 'cancelled', createdAt: '2026-05-06T12:00:00.000Z', loaded: false },
    { jobId: 'current-running', status: 'running', createdAt: '2026-05-06T13:00:00.000Z', loaded: false },
  ]

  assert.deepEqual(
    harness.getSortedJobTasksForTab(tasks, 'history').map((task) => task.jobId),
    ['newer-cancelled', 'older-completed'],
  )
})

test('loaded historical results are hidden while the current task tab is empty', async () => {
  const harness = await createJobHarness()
  harness.state.outfit.jobTab = 'current'
  harness.state.outfit.jobId = 'older-completed'
  harness.state.outfit.jobs = [
    { jobId: 'older-completed', status: 'completed', createdAt: '2026-05-06T10:00:00.000Z', loaded: true },
    { jobId: 'newer-cancelled', status: 'cancelled', createdAt: '2026-05-06T12:00:00.000Z', loaded: false },
  ]

  assert.equal(harness.shouldShowLoadedJobWorkspace('outfit'), false)

  harness.state.outfit.jobTab = 'history'
  assert.equal(harness.shouldShowLoadedJobWorkspace('outfit'), true)
})

test('translate job task thumbnails use source image asset ids', async () => {
  const harness = await createJobHarness()
  const thumbs = harness.getJobTaskThumbsFromItems('translate', [
    { inputJson: { assetId: 'asset-a', targetLanguage: 'ja' } },
    { inputJson: { assetId: 'asset-a', targetLanguage: 'ko' } },
    { inputJson: { assetId: 'asset-b', targetLanguage: 'ja' } },
  ])

  assert.deepEqual(JSON.parse(JSON.stringify(thumbs)), [
    { src: '/api/results/asset-a', label: '源图 1' },
    { src: '/api/results/asset-b', label: '源图 2' },
  ])
})

test('outfit job task thumbnails mix model and garment references without duplicates', async () => {
  const harness = await createJobHarness()
  const thumbs = harness.getJobTaskThumbsFromItems('outfit', [
    { inputJson: { modelAssetId: 'model-1', lookAssetIds: ['dress-1', 'shoe-1'] } },
    { inputJson: { modelAssetId: 'model-1', lookAssetIds: ['dress-1', 'bag-1'] } },
  ])

  assert.deepEqual(JSON.parse(JSON.stringify(thumbs)), [
    { src: '/api/results/model-1', label: '模特 1' },
    { src: '/api/results/dress-1', label: '服装 1' },
    { src: '/api/results/shoe-1', label: '服装 2' },
  ])
})

test('job task thumbnails reject cached non-image base64 garbage', async () => {
  const harness = await createJobHarness()
  const validPng = TINY_PNG_BASE64
  const internalBlob = 'iWEcAqNwbmcDAQTRAQ'.repeat(8)

  const thumbs = harness.sanitizeJobTaskThumbs([
    { src: internalBlob, label: 'bad cached blob' },
    { src: '/api/results/asset-ok', label: 'cloud asset' },
    { src: validPng, label: 'valid inline image' },
    { src: `data:image/png;base64,${internalBlob}`, label: 'bad data url' },
  ])

  assert.deepEqual(JSON.parse(JSON.stringify(thumbs)), [
    { src: '/api/results/asset-ok', label: 'cloud asset' },
    { src: `data:image/png;base64,${validPng}`, label: 'valid inline image' },
  ])
})

test('machine-generated image filenames use readable fallback labels', async () => {
  const harness = await createJobHarness()
  const machineName = 'iwEcAqNwbmcDAQTRAQIF0QECBrBZiTPXA8j-YwnuNgMpxEYAB9IiVEZmCAAJomltCgAL0gAArBU.png'

  assert.equal(harness.isMachineImageName(machineName), true)
  assert.equal(harness.readableAssetLabel({ name: machineName }, '整套 1'), '整套 1')
  assert.equal(harness.readableAssetLabel({ name: machineName, label: '白色T恤' }, '整套 1'), '白色T恤')
  assert.equal(harness.readableAssetLabel({ name: 'white-shirt.png' }, '整套 1'), 'white-shirt')
})

test('asset image sources prefer valid inline data and fall back to streamed asset URLs', async () => {
  const harness = await createJobHarness()
  const validPng = TINY_PNG_BASE64
  const garbageBlob = 'iwEcAqNwbmcDAQTRAQIF0QECBrBZiTPXA8j-YwnuNgMpxEYAB9IiVEZmCAAJomltCgAL0gAArBU'

  assert.equal(
    harness.assetImageSrc({ assetId: 'asset-streamed', dataUrl: garbageBlob, mime: 'image/png' }),
    '/api/results/asset-streamed',
  )
  assert.equal(
    harness.assetImageSrc({ assetId: 'asset-inline', dataUrl: validPng, mime: 'image/png' }),
    `data:image/png;base64,${validPng}`,
  )
  assert.equal(harness.readableAssetLabel({ label: garbageBlob, name: `${garbageBlob}.png` }, '整套 1'), '整套 1')
})

test('style job tasks are isolated and use source plus subject thumbnails', async () => {
  const harness = await createJobHarness()
  harness.state.style.jobs = [
    { jobId: 'style-a', loaded: false },
    { jobId: 'style-b', loaded: false },
  ]

  harness.markJobTaskLoaded('style', 'style-b')
  assert.equal(harness.state.style.jobId, 'style-b')
  assert.deepEqual(
    harness.state.style.jobs.map((task) => ({ jobId: task.jobId, loaded: task.loaded })),
    [
      { jobId: 'style-a', loaded: false },
      { jobId: 'style-b', loaded: true },
    ],
  )

  const thumbs = harness.getJobTaskThumbsFromItems('style', [
    { inputJson: { sourceAssetId: 'style-source', subjectAssetIds: ['subject-a'], subject: '手袋' } },
    { inputJson: { sourceAssetId: 'style-source', subjectAssetIds: ['subject-b'], subject: '鞋子' } },
  ])

  assert.deepEqual(JSON.parse(JSON.stringify(thumbs)), [
    { src: '/api/results/style-source', label: '风格源图' },
    { src: '/api/results/subject-a', label: '主体 1' },
    { src: '/api/results/subject-b', label: '主体 2' },
  ])
})

test('canvas generate result asset fetch retries transient empty reads', async () => {
  const source = await readFile(APP_PATH, 'utf8')
  const calls = []
  const context = {
    CANVAS_RESULT_FETCH_RETRIES: 3,
    CANVAS_RESULT_FETCH_RETRY_DELAY_MS: 1,
    wait: async () => {},
    getJson: async (url) => {
      calls.push(url)
      if (calls.length === 1) return { asset: { id: 'asset_retry' }, dataUrl: '' }
      return { asset: { id: 'asset_retry' }, dataUrl: 'data:image/png;base64,cmVzdWx0' }
    },
  }
  vm.createContext(context)
  vm.runInContext(extractFunction(source, 'fetchCanvasGenerateResultAsset'), context)

  const result = await context.fetchCanvasGenerateResultAsset('asset_retry', 'project_1')

  assert.equal(result.dataUrl, 'data:image/png;base64,cmVzdWx0')
  assert.deepEqual(calls, [
    '/api/assets/asset_retry?includeData=1&projectId=project_1',
    '/api/assets/asset_retry?includeData=1&projectId=project_1',
  ])
})

test('canvas generate result asset fetch retries transient 404 reads', async () => {
  const source = await readFile(APP_PATH, 'utf8')
  const calls = []
  const context = {
    CANVAS_RESULT_FETCH_RETRIES: 3,
    CANVAS_RESULT_FETCH_RETRY_DELAY_MS: 1,
    wait: async () => {},
    getJson: async (url) => {
      calls.push(url)
      if (calls.length === 1) {
        const error = new Error('not found')
        error.status = 404
        throw error
      }
      return { asset: { id: 'asset_retry_404' }, dataUrl: 'data:image/png;base64,cmVzdWx0' }
    },
  }
  vm.createContext(context)
  vm.runInContext(extractFunction(source, 'fetchCanvasGenerateResultAsset'), context)

  const result = await context.fetchCanvasGenerateResultAsset('asset_retry_404', '')

  assert.equal(result.dataUrl, 'data:image/png;base64,cmVzdWx0')
  assert.equal(calls.length, 2)
})

test('history job tasks are paged five per page', async () => {
  const harness = await createJobHarness()
  const tasks = Array.from({ length: 12 }, (_, index) => ({
    jobId: `job-${String(index + 1).padStart(2, '0')}`,
    status: 'completed',
    createdAt: new Date(Date.UTC(2026, 4, 6, 10, index)).toISOString(),
  }))

  assert.equal(harness.getJobTaskPageCount(tasks, 'history'), 3)
  assert.equal(harness.clampJobTaskPage(tasks, 'history', 99), 3)
  assert.deepEqual(
    harness.getPagedJobTasksForTab(tasks, 'history', 2).map((task) => task.jobId),
    ['job-07', 'job-06', 'job-05', 'job-04', 'job-03'],
  )
  assert.deepEqual(
    harness.getPagedJobTasksForTab(tasks, 'current', 2).map((task) => task.jobId),
    [],
  )
})

test('job task downloads include completed outputs from task items', async () => {
  const harness = await createJobHarness()
  const translateItems = [
    {
      status: 'completed',
      inputJson: { assetId: 'source-a', targetLanguage: 'en' },
      outputJson: { resultAssetId: 'translated-a' },
    },
    {
      status: 'failed',
      inputJson: { assetId: 'source-b', targetLanguage: 'ja' },
      outputJson: { resultAssetId: 'translated-b' },
    },
  ]
  const outfitItems = [
    {
      status: 'completed',
      inputJson: { modelAssetId: 'model-a', lookId: 'look-1' },
      outputJson: { resultAssetId: 'outfit-a' },
    },
  ]
  const styleItems = [
    {
      status: 'completed',
      inputJson: { subject: '红色手袋' },
      outputJson: { resultAssetId: 'style-a' },
    },
  ]
  const aiTestItems = [
    {
      status: 'completed',
      inputJson: { imageIndex: 2, groupIndex: 4 },
      outputJson: { resultAssetId: 'ai-test-a' },
    },
    {
      status: 'completed',
      inputJson: { imageIndex: 0, groupIndex: 1 },
      outputJson: { resultAssetId: 'ai-test-b', filename: 'backend-ai-test-name.png' },
    },
  ]

  assert.deepEqual(JSON.parse(JSON.stringify(harness.getJobTaskDownloadEntries('translate', translateItems))), [
    { href: '/api/results/translated-a', name: 'source-a.en.png' },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(harness.getJobTaskDownloadEntries('outfit', outfitItems))), [
    { href: '/api/results/outfit-a', name: 'model-a__look-1.png' },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(harness.getJobTaskDownloadEntries('style', styleItems))), [
    { href: '/api/results/style-a', name: 'style-transfer-红色手袋.png' },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(harness.getJobTaskDownloadEntries('aiTest', aiTestItems))), [
    { href: '/api/results/ai-test-a', name: 'ai-test-2-4.png' },
    { href: '/api/results/ai-test-b', name: 'backend-ai-test-name.png' },
  ])
})

test('job item failures are grouped into actionable user-facing reasons', async () => {
  const harness = await createJobHarness()
  const items = [
    {
      status: 'failed',
      errorCode: 'job_setup_failed',
      errorMessage: 'Missing API key for nano-banana-2',
      outputJson: {},
    },
    {
      status: 'failed',
      errorCode: 'outfit_failed',
      errorMessage: 'Image task failed: generation timed out',
      outputJson: {},
    },
    {
      status: 'failed',
      errorCode: 'job_item_timeout',
      errorMessage: 'Job item timed out after 3 attempts.',
      outputJson: {},
    },
  ]

  assert.equal(harness.classifyJobItemFailure(items[0]).label, 'Nano Banana 2 缺少 API Key')
  assert.equal(harness.formatJobItemFailureMessage(items[1]), '上游生成超时：Image task failed: generation timed out')
  assert.equal(
    harness.summarizeJobItemFailures(items),
    'Nano Banana 2 缺少 API Key 1 · 上游生成超时 1 · 队列恢复超时 1',
  )
})

test('downloadAll downloads with bounded concurrency and reports progress', async () => {
  const harness = await createJobHarness()
  let active = 0
  let peak = 0
  const calls = []
  const progress = []
  let releaseNext = null
  const releases = []
  harness.downloadAsset = async (href, name) => {
    calls.push({ href, name })
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => {
      releaseNext = () => {
        active -= 1
        resolve()
      }
      releases.push(releaseNext)
    })
  }

  const run = harness.downloadAll([
    { href: '/api/results/a', name: 'a.png' },
    { href: '/api/results/b', name: 'b.png' },
    { href: '/api/results/c', name: 'c.png' },
    { href: '/api/results/d', name: 'd.png' },
  ], {
    concurrency: 2,
    onProgress: (result) => progress.push({ ...result }),
  })

  await flushMicrotasks()
  assert.equal(calls.length, 2)
  assert.equal(peak, 2)
  releases.shift()()
  releases.shift()()
  await waitForCondition(() => calls.length === 4)
  assert.equal(calls.length, 4)
  releases.shift()()
  releases.shift()()

  const result = await run
  assert.equal(result.done, 4)
  assert.equal(result.failed, 0)
  assert.deepEqual(progress.map((item) => item.done), [1, 2, 3, 4])
})
