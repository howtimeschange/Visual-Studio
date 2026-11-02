import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8')
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))

test('language selection opens with arrows, wraps options and returns focus on Escape', () => {
  const handlers = {}, attributes = {}, focused = []
  const state = { openDropdown: null }
  const trigger = { setAttribute: (k, v) => { attributes[k] = v }, focus: () => focused.push('trigger') }
  const options = ['first', 'second', 'third'].map(name => ({ focus: () => focused.push(name) }))
  const context = { state, toggleDropdown: name => { state.openDropdown = name }, closeDropdowns: () => { state.openDropdown = null } }
  vm.createContext(context)
  vm.runInContext(section('function bindLanguageDropdownKeyboard(', 'function bindSettings('), context)
  context.bindLanguageDropdownKeyboard({ addEventListener: (type, fn) => { handlers[type] = fn } }, trigger, { id: 'languages', querySelectorAll: () => options }, 'target', '目标语言')
  assert.equal(attributes['aria-label'], '目标语言')
  assert.equal(attributes['aria-controls'], 'languages')
  const key = (name, target) => handlers.keydown({ key: name, target, preventDefault() {} })
  key('ArrowDown', trigger)
  assert.equal(state.openDropdown, 'target')
  assert.equal(focused.at(-1), 'first')
  key('ArrowUp', options[0])
  assert.equal(focused.at(-1), 'third')
  key('Home', options[2])
  assert.equal(focused.at(-1), 'first')
  key('Escape', options[0])
  assert.equal(state.openDropdown, null)
  assert.equal(focused.at(-1), 'trigger')
})

test('upload dropzone keyboard activates once and respects its busy guard', () => {
  const handlers = {}, attrs = {}
  let clicks = 0, allowed = true
  const surface = {
    querySelector: selector => selector === '.dz-text' ? { textContent: ' 上传商品图 ' } : null,
    setAttribute: (k, v) => { attrs[k] = v },
    addEventListener: (name, fn) => { handlers[name] = fn },
    click: () => handlers.click(),
  }
  const context = {}
  vm.createContext(context)
  vm.runInContext(section('function bindDropSurface(', 'async function readImageFiles('), context)
  context.bindDropSurface({ surface, input: { click: () => clicks++, addEventListener() {} }, onFiles() {}, onClick: () => allowed })
  assert.equal(surface.tabIndex, 0)
  assert.equal(attrs.role, 'button')
  assert.equal(attrs['aria-label'], '上传商品图')
  const key = (name, target = surface) => handlers.keydown({ key: name, target, preventDefault() {} })
  key('Enter')
  assert.equal(clicks, 1)
  key(' ')
  assert.equal(clicks, 2)
  key('Enter', {})
  assert.equal(clicks, 2)
  allowed = false
  key('Enter')
  assert.equal(clicks, 2)
})
