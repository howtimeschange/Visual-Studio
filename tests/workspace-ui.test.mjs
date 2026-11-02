import test from 'node:test'
import assert from 'node:assert/strict'
import { filterProjects, getCanvasFit, mergeWorkspaceSections } from '../public/js/workspace-ui.js'

test('parallel workspaces preserve newer inactive drafts and persist a background task completion', () => {
  const tab = { generate: { model: 'flare' }, aiTest: { images: [] } }
  const signatures = {}
  const first = mergeWorkspaceSections(tab, tab, signatures, 'generate')
  const newer = { ...first, aiTest: { images: ['uploaded-in-another-tab'] } }
  const canvasChange = { ...tab, generate: { model: 'sunburst' } }
  const saved = mergeWorkspaceSections(canvasChange, newer, signatures, 'generate')
  assert.deepEqual(saved.aiTest, newer.aiTest)
  assert.equal(saved.generate.model, 'sunburst')
  const batchTabSignatures = {}
  const batchTab = { generate: { model: 'flare' }, aiTest: { images: [] } }
  const restored = mergeWorkspaceSections(batchTab, saved, batchTabSignatures, 'aiTest')
  assert.equal(restored.generate.model, 'sunburst')
  const completed = { ...canvasChange, aiTest: { images: ['result-from-own-background-task'] } }
  const background = mergeWorkspaceSections(completed, saved, signatures, 'generate')
  assert.deepEqual(background.aiTest, completed.aiTest)
})

test('project search supports Chinese, word matching and full-width titles', () => {
  const projects = [{ title: '春季新品 方案' }, { title: 'ＭＯＤＥＬＪＥＴＴＹ 茶壶' }, { title: '茶壶 生活方式' }]
  assert.deepEqual(filterProjects(projects, '  茶壶 modeljetty '), [projects[1]])
  assert.deepEqual(filterProjects(projects, '春季'), [projects[0]])
  assert.deepEqual(filterProjects(projects, ''), projects)
  assert.deepEqual(filterProjects(projects, '不存在'), [])
})

test('fit-to-content centers artwork with negative coordinates within visible canvas', () => {
  const elements = [{ type: 'image', x: -500, y: -100, width: 400, height: 300 }, { type: 'image', x: 100, y: 300, width: 700, height: 500 }]
  const fit = getCanvasFit(elements, 1100, 800)
  for (const el of elements) {
    assert.ok(el.x * fit.scale + fit.panX >= 96 - .01)
    assert.ok(el.y * fit.scale + fit.panY >= 64 - .01)
    assert.ok((el.x + el.width) * fit.scale + fit.panX <= 1100 - 96 + .01)
    assert.ok((el.y + el.height) * fit.scale + fit.panY <= 800 - 64 + .01)
  }
})

test('compact fit reserves room for tools without enlarging a small image', () => {
  const el = { type: 'image', x: 0, y: 0, width: 240, height: 240 }
  const fit = getCanvasFit([el], 390, 700, true)
  assert.equal(fit.scale, 1)
  assert.equal(fit.panX, 75)
  assert.equal(fit.panY, 230)
})

test('fit ignores connectors and invalid geometry and handles empty workspaces', () => {
  const ignored = [{ type: 'connector', x: -10000, y: 0, width: 100, height: 100 }, { type: 'image', x: NaN, y: 0, width: 10, height: 10 }]
  assert.equal(getCanvasFit(ignored, 1000, 800), null)
  assert.equal(getCanvasFit([{ type: 'image', x: 0, y: 0, width: 400, height: 300 }], 0, 800), null)
})
