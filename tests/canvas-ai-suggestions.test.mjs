import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const APP_PATH = new URL('../public/app.js', import.meta.url)

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) return ''
  const asyncPrefix = source.slice(Math.max(0, start - 6), start) === 'async '
    ? start - 6
    : start

  const paramsEnd = source.indexOf(')', start)
  const bodyStart = source.indexOf('{', paramsEnd)
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(asyncPrefix, index + 1)
  }

  throw new Error(`Could not extract function ${name}`)
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName
    this.ownerDocument = ownerDocument
    this.children = []
    this.attributes = {}
    this.dataset = {}
    this.className = ''
    this.textContent = ''
    this.type = ''
    this.disabled = false
    this.value = ''
    this.eventListeners = new Map()
  }

  append(...nodes) {
    this.children.push(...nodes)
  }

  replaceChildren(...nodes) {
    this.children = nodes
  }

  addEventListener(type, listener) {
    this.eventListeners.set(type, listener)
  }

  click() {
    this.eventListeners.get('click')?.({ target: this })
  }

  focus() {
    this.focused = true
  }

  querySelectorAll(className) {
    const target = className.replace(/^\./, '')
    const matches = []
    const visit = (node) => {
      if (!node || typeof node !== 'object') return
      if (String(node.className || '').split(/\s+/).includes(target)) matches.push(node)
      for (const child of node.children || []) visit(child)
    }
    visit(this)
    return matches
  }

  closest(selector) {
    if (selector === '[data-ai-prompt]' && this.dataset.aiPrompt) return this
    return null
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this)
  }

  createTextNode(text) {
    return { nodeType: 3, textContent: String(text) }
  }
}

async function createHarness() {
  const source = await readFile(APP_PATH, 'utf8')
  const document = new FakeDocument()
  const context = {
    document,
    state: {
      generate: {
        aiRunning: false,
        aiMessages: [],
        aiSessions: [],
      },
    },
    dom: {
      gAiMessages: document.createElement('div'),
      gSend: document.createElement('button'),
      gAiSession: document.createElement('select'),
      gAiNewSession: document.createElement('button'),
      gAiClearSession: document.createElement('button'),
      gInput: document.createElement('textarea'),
    },
    renderAiSessionControls: () => {},
    createAiWelcomeNode: () => document.createElement('div'),
    createAiLoadingNode: (text) => {
      const node = document.createElement('div')
      node.textContent = text
      return node
    },
    openLightbox: () => {},
  }
  const harnessSource = [
    extractFunction(source, 'createAiSuggestionNodes'),
    extractFunction(source, 'renderAiMessages'),
  ].join('\n')
  vm.createContext(context)
  vm.runInContext(harnessSource, context)
  return context
}

test('clarification messages render numbered style option cards', async () => {
  const harness = await createHarness()
  harness.state.generate.aiMessages = [{
    id: 'assistant-1',
    role: 'assistant',
    content: '你想走哪种视觉风格？',
    needsClarification: true,
    suggestions: ['做成杂志摄影风格的咖啡海报', '做成扁平插画风格的咖啡海报'],
  }]

  harness.renderAiMessages()

  const buttons = harness.dom.gAiMessages.querySelectorAll('ai-suggestion')
  assert.equal(buttons.length, 2)
  assert.equal(harness.dom.gAiMessages.querySelectorAll('ai-suggestion-chip').length, 0)
  assert.equal(buttons[0].dataset.aiPrompt, '做成杂志摄影风格的咖啡海报')
  assert.equal(buttons[0].children[0].textContent, '风格选项 1')
  assert.equal(buttons[0].children[1].textContent, '做成杂志摄影风格的咖啡海报')

  buttons[0].click()
  assert.equal(harness.dom.gInput.value, '做成杂志摄影风格的咖啡海报')
  assert.equal(harness.dom.gInput.focused, true)
})

test('follow-up suggestions render compact prompt chips without numbered style labels', async () => {
  const harness = await createHarness()
  harness.state.generate.aiMessages = [{
    id: 'assistant-1',
    role: 'assistant',
    content: '图片已添加到画布。',
    needsClarification: false,
    suggestions: ['添加50年代科幻海报文字', '再生成一个近景构图'],
  }]

  harness.renderAiMessages()

  const chips = harness.dom.gAiMessages.querySelectorAll('ai-suggestion-chip')
  assert.equal(harness.dom.gAiMessages.querySelectorAll('ai-suggestion').length, 0)
  assert.equal(chips.length, 2)
  assert.equal(chips[0].dataset.aiPrompt, '添加50年代科幻海报文字')
  assert.equal(chips[0].textContent, '添加50年代科幻海报文字')

  chips[0].click()
  assert.equal(harness.dom.gInput.value, '添加50年代科幻海报文字')
  assert.equal(harness.dom.gInput.focused, true)
})

test('assistant messages without suggestions keep the old quiet rendering', async () => {
  const harness = await createHarness()
  harness.state.generate.aiMessages = [{
    id: 'assistant-1',
    role: 'assistant',
    content: '我已经整理好设计方向。',
  }]

  harness.renderAiMessages()

  assert.equal(harness.dom.gAiMessages.querySelectorAll('ai-suggestion').length, 0)
})
