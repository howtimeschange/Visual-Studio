import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { createDesignAgentRun, executeDesignAgentRun } from '../public/js/design-agent-harness.js'
import { mergeAgentRunMessages } from '../public/js/canvas-agent-client.js'
import { splitDataUrl } from '../public/js/shared.js'

test('two Send clicks during project creation acquire only one Agent execution lease', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  const start = source.indexOf('async function sendCanvasAiMessage() {')
  const end = source.indexOf('/* ═══════════════ RENDER GENERATE', start)
  let rejectCreation, creates = 0
  const context = {
    state: { generate: { aiRunning: false, genRunning: false, aiRefs: [] }, keys: {}, notice: {} },
    dom: { gInput: { value: '请先规划' }, gAiModel: { value: 'model' }, gAiRatio: { value: '1:1' }, gAiResolution: { value: '1k' } },
    normalizeAspectRatio: value => value, normalizeCanvasResolution: value => value,
    ensureCanvasProjectRecord: () => { creates++; return new Promise((_, reject) => { rejectCreation = reject }) },
    renderAiSessionControls() {}, renderAiMessages() {}, renderAiRefList() {}, renderDesignAgentContext() {}, renderAppNotice() {}, trimError: error => error.message,
  }
  vm.createContext(context)
  vm.runInContext(source.slice(start, end), context)
  const first = context.sendCanvasAiMessage()
  const second = context.sendCanvasAiMessage()
  assert.equal(creates, 1)
  assert.equal(context.state.generate.aiRunning, true)
  rejectCreation(new Error('fixture: no project created'))
  await Promise.all([first, second])
  assert.equal(context.state.generate.aiRunning, false)
  assert.equal(context.dom.gInput.value, '请先规划')
})

test('Agent reference uploads preserve the data URL format even when stale metadata says PNG', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  const start = source.indexOf('async function sendCanvasAiMessage() {')
  const end = source.indexOf('/* ═══════════════ RENDER GENERATE', start)
  for (const mime of ['image/jpeg', 'image/webp', 'image/png']) {
    const requests = []
    const session = { id: 'conversation-1', mode: 'plan', skillId: 'reference-edit' }
    const context = {
      crypto: webcrypto, splitDataUrl, createDesignAgentRun, executeDesignAgentRun, mergeAgentRunMessages,
      saveCanvasDraft() {}, canvasAgentWatcher: {start() {}},
      state: { generate: { aiRunning: false, genRunning: false, projectId: 'project-1', aiSessionId: session.id, aiMessages: [],
        aiRefs: [{ id: 'ref-1', mime: 'image/png', dataUrl: `data:${mime};base64,ZmFrZQ==` }] }, keys: {}, notice: {}, runtime: {}, account: { user: { id: 'user-1' } } },
      dom: { gInput: { value: '仅分析参考图' }, gAiModel: { value: 'nano-banana-2' }, gAiRatio: { value: '1:1' }, gAiResolution: { value: '1k' }, gAiMessages: {} },
      normalizeAspectRatio: value => value, normalizeCanvasResolution: value => value,
      ensureCanvasProjectRecord: async () => 'project-1', ensureAiSessionSelection: () => session,
      getCanvasAgentContext: () => ({ elementCount: 0, selectedIds: [] }),
      postJson: async (url, body) => { requests.push({ url, body }); return url === '/api/assets/upload'
        ? { asset: { id: 'reference-asset' } } : { run: { id: body.runId, projectId: body.projectId, conversationId: body.conversationId, mode:'auto', phase:'completed', tasks:[], events:[] }, plan: { reply:'分析完成', shouldGenerate:false } } },
      renderAiSessionControls() {}, renderAiMessages() {}, renderAiRefList() {}, renderDesignAgentContext() {}, saveRuntimeState() {}, renderAppNotice() {}, trimError: error => error.message,
    }
    vm.createContext(context)
    vm.runInContext(source.slice(start, end), context)
    await context.sendCanvasAiMessage()
    assert.equal(requests[0].body.mime, mime)
    assert.equal(requests[1].body.referenceImages[0].assetId, 'reference-asset')
    assert.equal(requests[1].body.executionPolicy.mode, 'auto')
    assert.equal(context.state.generate.aiMessages[1].run.mode, 'auto')
    assert.equal(context.state.generate.aiMessages[1].run.phase, 'completed')
  }
})
