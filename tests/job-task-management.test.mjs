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
    state: {
      translate: { jobs: [], jobId: '' },
      outfit: { jobs: [], jobId: '' },
    },
    translateJobWatchers: new Map(),
    outfitJobWatchers: new Map(),
  }
  const functionNames = [
    'serializeJobTask',
    'sanitizeStoredJobTasks',
    'getJobTasks',
    'setLoadedJobId',
    'markJobTaskLoaded',
    'clearJobTaskLoaded',
    'removeJobTask',
    'getJobTaskBucket',
    'filterJobTasksForTab',
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
