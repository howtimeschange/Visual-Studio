import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesignAgentRun, executeDesignAgentRun, requestDesignAgentStop, serializeDesignAgentRun, buildDesignAgentManifest, canShowAgentSuggestions } from '../public/js/design-agent-harness.js'

const run = (mode = 'auto') => createDesignAgentRun({ id: 'run-1', projectId: 'project-1', conversationId: 'conversation-1', mode, now: 1000 })
const plan = (count = 2) => ({ shouldGenerate: true, reply: '方案', actions: Array.from({ length: count }, (_, i) => ({ type: 'generate_image', id: 'duplicate-model-id', title: `图片 ${i + 1}`, prompt: `prompt ${i + 1}`, aspectRatio: '1:1', resolution: '1k' })) })

test('plan mode never executes image tools even when the model asks to generate', async () => {
  let calls = 0
  const current = run('plan')
  await executeDesignAgentRun(current, { plan: async () => plan(), execute: async () => { calls++ } })
  assert.equal(calls, 0)
  assert.equal(current.phase, 'completed')
  assert.equal(current.tasks.length, 0)
})

test('accepted receipts precede artifact completion and duplicate model IDs become distinct tasks', async () => {
  const current = run()
  const observed = []
  await executeDesignAgentRun(current, { plan: async () => plan(),
    execute: async (task, receipt) => { receipt.accepted(`job-${task.id}`, `element-${task.id}`); assert.equal(task.status, 'accepted'); return { assetId: `asset-${task.id}` } },
    onChange: (record, type) => observed.push({ type, snapshot: serializeDesignAgentRun(record) }),
  })
  assert.equal(current.phase, 'completed')
  assert.equal(new Set(current.tasks.map(task => task.id)).size, 2)
  assert.ok(current.tasks.every(task => task.status === 'completed' && task.assetId && task.jobId))
  assert.ok(observed.find(event => event.type === 'task_accepted').snapshot.tasks[0].jobId)
})

test('stop waits for the accepted task and never dispatches subsequent work', async () => {
  const current = run()
  let calls = 0
  await executeDesignAgentRun(current, { plan: async () => plan(3), execute: async (task, receipt) => {
    calls++; receipt.accepted('accepted-job', 'element-1'); requestDesignAgentStop(current)
    return { assetId: 'real-asset' }
  } })
  assert.equal(calls, 1)
  assert.equal(current.phase, 'stopped')
  assert.deepEqual(current.tasks.map(task => task.status), ['completed', 'skipped', 'skipped'])
})

test('unknown paid outcome retains the receipt and stops the run without a retry or new task', async () => {
  const current = run()
  let calls = 0
  await executeDesignAgentRun(current, { plan: async () => plan(3), execute: async (task, receipt) => {
    calls++; receipt.accepted('accepted-job', 'element-1'); throw new Error('connection reset while reading')
  } })
  assert.equal(calls, 1)
  assert.equal(current.phase, 'awaiting_result')
  assert.equal(current.tasks[0].jobId, 'accepted-job')
  assert.deepEqual(current.tasks.map(task => task.status), ['unknown', 'skipped', 'skipped'])
  assert.equal(canShowAgentSuggestions({ run: current }), false)
})

test('frequent status updates cannot evict the accepted task event', async () => {
  const current = run()
  await executeDesignAgentRun(current, { plan: async () => plan(1), execute: async (_task, receipt) => {
    receipt.accepted('accepted-job', 'existing-element')
    for (let index = 0; index < 100; index++) receipt.progress(`status ${index}`)
    return { assetId: 'saved-asset' }
  } })
  assert.ok(current.events.some(event => event.type === 'task_accepted'))
  assert.ok(current.events.some(event => event.type === 'phase' && event.label === '理解与规划'))
  assert.equal(current.events.filter(event => event.type === 'progress').length, 1)
})

test('a declared terminal failure preserves earlier successful artifacts', async () => {
  const current = run()
  let calls = 0
  await executeDesignAgentRun(current, { plan: async () => plan(3), execute: async () => {
    calls++
    if (calls === 2) throw Object.assign(new Error('job failed'), { operationState: 'failed' })
    return { assetId: 'first-artifact' }
  } })
  assert.equal(current.phase, 'partial_failed')
  assert.equal(current.tasks[0].assetId, 'first-artifact')
  assert.equal(current.tasks[2].status, 'skipped')
})

test('authorization loss while reading an accepted job does not declare that job failed', async () => {
  const current = run()
  await executeDesignAgentRun(current, { plan: async () => plan(), execute: async (_task, receipt) => {
    receipt.accepted('accepted-before-expiry', 'existing-element')
    throw Object.assign(new Error('reauthorize before reading'), { status: 401 })
  } })
  assert.equal(current.phase, 'awaiting_result')
  assert.equal(current.tasks[0].status, 'unknown')
  assert.equal(current.tasks[0].jobId, 'accepted-before-expiry')
})

test('a changed project or conversation blocks execution after planning', async () => {
  const current = run()
  let scope = true, calls = 0
  await executeDesignAgentRun(current, { isCurrent: () => scope, plan: async () => { scope = false; return plan() }, execute: async () => { calls++ } })
  assert.equal(calls, 0)
  assert.equal(current.phase, 'interrupted')
})

test('clarification requests and over-budget plans do not dispatch images', async () => {
  for (const response of [{ ...plan(), needsClarification: true }, plan(9)]) {
    const current = run()
    let calls = 0
    await executeDesignAgentRun(current, { plan: async () => response, execute: async () => { calls++ } })
    assert.equal(calls, 0)
    assert.ok(['waiting_input', 'failed'].includes(current.phase))
  }
})

test('restoring an active run marks interruption and does not claim semantic review or leak keys', () => {
  const current = run()
  current.phase = 'executing'
  current.clientKeys = { token: 'must-not-leak' }
  current.context.dataUrl = 'must-not-export'
  current.skill = { id: 'reference-product', label: '商品三图', qualityChecklist: ['产品保真'] }
  const restored = serializeDesignAgentRun(current, { restore: true })
  assert.equal(restored.phase, 'interrupted')
  const manifest = buildDesignAgentManifest(restored)
  assert.equal(manifest.semanticReview, 'not_performed')
  assert.equal(manifest.qualityChecklist[0].status, 'needs_review')
  assert.doesNotMatch(JSON.stringify(manifest), /must-not/)
})
