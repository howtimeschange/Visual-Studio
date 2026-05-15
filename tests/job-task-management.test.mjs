import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const APP_PATH = new URL('../public/app.js', import.meta.url)

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) return ''
  const paramsEnd = source.indexOf(')', start)
  const bodyStart = source.indexOf('{', paramsEnd)
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
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
    sanitizeFileName: (value) => String(value || '').replace(/[^\w.-]+/g, '_'),
    state: {
      translate: { jobs: [], jobId: '', jobTab: 'current' },
      outfit: { jobs: [], jobId: '', jobTab: 'current' },
    },
    translateJobWatchers: new Map(),
    outfitJobWatchers: new Map(),
  }
  const functionNames = [
    'sanitizeJobTaskThumbs',
    'serializeJobTask',
    'sanitizeStoredJobTasks',
    'getJobTasks',
    'getLoadedJobId',
    'getJobTab',
    'setJobTab',
    'setLoadedJobId',
    'markJobTaskLoaded',
    'clearJobTaskLoaded',
    'removeJobTask',
    'getJobTaskBucket',
    'filterJobTasksForTab',
    'releaseCompletedLoadedTasksForKind',
    'getTaskSortTime',
    'getSortedJobTasksForTab',
    'getPagedJobTasksForTab',
    'getJobTaskPageCount',
    'clampJobTaskPage',
    'getJobTaskDownloadEntries',
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

test('sanitizeStoredJobTasks keeps only tasks matching the current view type', async () => {
  const harness = await createJobHarness()
  const result = harness.sanitizeStoredJobTasks([
    { jobId: 'job-outfit', type: 'outfit_batch', status: 'queued', label: 'outfit' },
    { jobId: 'job-translate', type: 'translate_batch', status: 'queued', label: 'translate' },
    { jobId: 'job-empty', type: '', status: 'queued', label: 'empty' },
  ], '', 'outfit_batch')

  assert.deepEqual(Array.from(result).map((task) => task.jobId), ['job-outfit'])
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

  assert.deepEqual(JSON.parse(JSON.stringify(harness.getJobTaskDownloadEntries('translate', translateItems))), [
    { href: '/api/results/translated-a', name: 'source-a.en.png' },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(harness.getJobTaskDownloadEntries('outfit', outfitItems))), [
    { href: '/api/results/outfit-a', name: 'model-a__look-1.png' },
  ])
})
