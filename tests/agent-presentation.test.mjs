import test from 'node:test'
import assert from 'node:assert/strict'
import { agentMarkdownToHtml } from '../public/js/agent-markdown.js'
import { planAgentReferenceAddition } from '../public/js/agent-references.js'
import { getCanvasJobDisplayStatus } from '../public/js/canvas-job-progress.js'
import { createAgentRunRecord } from '../public/js/design-agent-view.js'
import { createDesignAgentRun } from '../public/js/design-agent-harness.js'

test('Agent Markdown renders the reported numbered plan with nested emphasis and lists', () => {
  const html = agentMarkdownToHtml('## 品牌海报\n\n1. **构图设计**：留白\n2. **标题层级**：\n   - **一级标题**：轻装入春\n   - *副标题*：步履从容\n\n下一步：`生成一张`。')
  assert.match(html, /<h2>品牌海报<\/h2>/)
  assert.match(html, /<ol><li><p><strong>构图设计<\/strong>/)
  assert.match(html, /<ul><li><p><strong>一级标题<\/strong>/)
  assert.match(html, /<em>副标题<\/em>/)
  assert.match(html, /<code>生成一张<\/code>/)
  assert.doesNotMatch(html, /\*\*/)
})

test('Markdown escapes raw HTML, blocks executable links and never loads remote images', () => {
  const html = agentMarkdownToHtml('<img src=x onerror=alert(1)>\n\n[bad](javascript:alert) [bad2](data:text/html,test) ![picture](https://tracker.invalid/image)\n\n[good](https://example.com/?q="test")')
  assert.doesNotMatch(html, /<img|<script|href="(?:javascript|data):/)
  assert.match(html, /&lt;img/)
  assert.match(html, /noopener noreferrer/)
  assert.match(html, /&quot;test&quot;/)
})

test('Markdown supports code blocks, quotes and scrollable tables without interpreting code', () => {
  const html = agentMarkdownToHtml('> 注意产品保真\n\n```html\n<script>**literal**</script>\n```\n\n| 方案 | 光线 |\n| --- | --- |\n| **A** | 侧光 |')
  assert.match(html, /<blockquote><p>注意产品保真/)
  assert.match(html, /<pre><code class="language-html">&lt;script&gt;\*\*literal\*\*&lt;\/script&gt;/)
  assert.match(html, /class="agent-md-table"><table>/)
  assert.match(html, /<td><strong>A<\/strong><\/td>/)
})

test('generated image references reuse the asset, deduplicate and respect busy and quantity limits', () => {
  const image = { assetId: 'result-asset', dataUrl: 'data:image/jpeg;base64,image', name: '生成作品', mime: 'image/jpeg' }
  const refs = []
  const first = planAgentReferenceAddition(refs, image)
  assert.equal(first.status, 'added')
  assert.equal(first.reference.assetId, 'result-asset')
  assert.equal(first.reference.role, 'subject')
  assert.equal(refs.length, 0)
  refs.push(first.reference)
  assert.equal(planAgentReferenceAddition(refs, { ...image, dataUrl: 'different' }).status, 'duplicate')
  assert.equal(planAgentReferenceAddition(refs, image, true).status, 'busy')
  assert.equal(planAgentReferenceAddition(Array(6).fill({ assetId: 'other' }), image).status, 'limit')
  assert.equal(planAgentReferenceAddition([], {}).status, 'invalid')
})

test('provider execution does not flicker back to queued during queue handoff or claim unsaved completion', () => {
  assert.equal(getCanvasJobDisplayStatus({ status: 'queued' }, { status: 'queued', outputJson: { imageTaskStatus: 'running' } }), 'running')
  assert.equal(getCanvasJobDisplayStatus({ status: 'queued' }, { status: 'queued', outputJson: { imageTaskStatus: 'succeeded' } }), 'running')
  assert.equal(getCanvasJobDisplayStatus({ status: 'completed' }, { status: 'completed', outputJson: { imageTaskStatus: 'running' } }), 'completed')
  assert.equal(getCanvasJobDisplayStatus({ status: 'failed' }), 'failed')
})

test('active run has one loading label inside a collapsible summary', () => {
  const original = globalThis.document
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {} }
    setAttribute(key, value) { this.attributes[key] = value }
    append(...nodes) { this.children.push(...nodes) }
    addEventListener() {}
  }
  globalThis.document = { createElement: tag => new Node(tag), createElementNS: (_ns, tag) => new Node(tag) }
  try {
    const run = createDesignAgentRun({ id: 'run', projectId: 'project', conversationId: 'chat' })
    run.phase = 'planning'; run.events = [{ type: 'phase', label: '理解与规划' }]
    const root = createAgentRunRecord(run, { loadingText: '理解与规划', renderLoading: text => { const node = new Node('div'); node.className = 'msg-loading'; node.textContent = text; return node } })
    const details = root.children[0], summary = details.children[0]
    const text = node => (node.textContent || '') + node.children.map(text).join('')
    assert.equal(details.tagName, 'details')
    assert.equal(summary.tagName, 'summary')
    assert.equal(summary.children[0].className, 'msg-loading')
    assert.equal(text(root).split('理解与规划').length - 1, 1)
    assert.equal(details.open, false)
  } finally { globalThis.document = original }
})
