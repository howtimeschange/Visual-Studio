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

async function createNoticeHarness() {
  const source = await readFile(APP_PATH, 'utf8')
  const timers = []
  const clearedTimers = []
  let nextTimerId = 0
  const noticeClassList = new Set(['hidden'])
  const context = {
    RUNTIME_MIGRATION_NOTICE_MS: 5200,
    state: {
      notice: {
        message: '',
        tone: '',
      },
    },
    dom: {
      notice: {
        classList: {
          toggle(name, force) {
            if (force) {
              noticeClassList.add(name)
            } else {
              noticeClassList.delete(name)
            }
          },
          contains(name) {
            return noticeClassList.has(name)
          },
        },
      },
      noticeText: {
        textContent: '',
      },
    },
    window: {
      setTimeout(callback, ms) {
        const id = ++nextTimerId
        timers.push({ id, callback, ms })
        return id
      },
      clearTimeout(id) {
        if (id) clearedTimers.push(id)
      },
    },
  }
  vm.createContext(context)
  vm.runInContext(extractFunction(source, 'renderAppNotice'), context)
  return { ...context, timers, clearedTimers, noticeClassList }
}

test('renderAppNotice does not keep extending the cleanup notice timeout', async () => {
  const harness = await createNoticeHarness()
  harness.state.notice.message = '已清理旧版本地缓存，释放浏览器存储空间。'
  harness.state.notice.tone = 'ok'

  harness.renderAppNotice()
  harness.renderAppNotice()

  assert.equal(harness.timers.length, 1)
  assert.deepEqual(harness.clearedTimers, [])
  assert.equal(harness.dom.noticeText.textContent, '已清理旧版本地缓存，释放浏览器存储空间。')
  assert.equal(harness.dom.notice.classList.contains('hidden'), false)
  assert.equal(harness.dom.notice.classList.contains('ok'), true)

  harness.state.notice.message = ''
  harness.renderAppNotice()

  assert.deepEqual(harness.clearedTimers, [1])
  assert.equal(harness.dom.notice.classList.contains('hidden'), true)
})
