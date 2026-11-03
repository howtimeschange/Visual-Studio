import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createProjectSnapshotCache, prepareProjectNavigation, presentCanvasElements } from '../public/js/project-navigation.js'

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('recent project reads deduplicate, expire and never fall back to expired data on access errors', async () => {
  let time = 0, reads = 0
  const cache = createProjectSnapshotCache({ now: () => time, ttl: 10 })
  const response = deferred()
  const read = () => { reads++; return response.promise }
  const one = cache.load('p','owner',read), two = cache.load('p','owner',read)
  response.resolve({elements:[{id:'original'}]})
  const first = await one, second = await two
  assert.equal(reads,1)
  first.elements[0].id = 'local edit'
  assert.equal(second.elements[0].id,'original')
  assert.equal((await cache.load('p','owner',read)).elements[0].id,'original')
  time = 11
  await assert.rejects(cache.load('p','owner',async () => { throw Object.assign(new Error('forbidden'),{status:403}) }), /forbidden/)
  assert.deepEqual(await cache.load('p','owner',async () => ({elements:[]})),{elements:[]})
})

test('account changes, invalidation and writes reject late cache repopulation; cache is bounded', async () => {
  const cache = createProjectSnapshotCache({ limit: 2 })
  const old = deferred(), invalidated = deferred()
  const pending = cache.load('p','a',() => old.promise)
  await cache.load('p','b',async () => 'b')
  old.resolve('old a'); await pending
  assert.equal(await cache.load('p','a',async () => 'new a'),'new a')
  const pendingInvalidated = cache.load('q','a',() => invalidated.promise)
  cache.invalidate('q'); cache.put('q','saved','a')
  invalidated.resolve('stale'); await pendingInvalidated
  assert.equal(await cache.load('q','a',async () => 'wrong'),'saved')
  cache.put('third',3,'a')
  assert.equal(await cache.load('p','a',async () => 'evicted'),'evicted')
})

test('destination reads overlap the source save, while refused saves never activate the destination', async () => {
  const saving = deferred(), reading = deferred(), events = []
  const move = prepareProjectNavigation(() => { events.push('save'); return saving.promise }, () => { events.push('read'); return reading.promise })
  await Promise.resolve()
  assert.deepEqual(events,['save','read'])
  reading.resolve({id:'target'})
  let finished = false; move.then(() => { finished = true })
  await Promise.resolve(); assert.equal(finished,false)
  saving.resolve(true); assert.deepEqual(await move,{id:'target'})
  assert.equal(await prepareProjectNavigation(async () => false, async () => { throw new Error('read failed') }),null)
  await assert.rejects(prepareProjectNavigation(async () => true, async () => { throw new Error('read failed') }),/read failed/)
})

test('canvas presentation uses authenticated image URLs without waiting for bytes or changing original pixels', () => {
  const elements = [{id:'image',type:'image',assetId:'a',content:'',width:300,height:200,originalWidth:1672,originalHeight:941}, {id:'text',type:'text',content:'Keep me'}]
  const visible = presentCanvasElements(elements,'p',(id,p) => `/api/results/${id}?projectId=${p}`)
  assert.equal(visible[0].content,'/api/results/a?projectId=p')
  assert.equal(visible[0].originalWidth,1672); assert.equal(visible[0].originalHeight,941)
  assert.equal(visible[1].content,'Keep me'); assert.equal(elements[0].content,'')
})

test('repeated session persistence stays clean, while a real content change advances its timestamp', async () => {
  const source = await readFile(new URL('../public/app.js',import.meta.url),'utf8')
  const context = {
    state:{generate:{aiSessionId:'s',aiMessages:[{id:'m',role:'user',content:'hello'}],aiSessions:[{id:'s',title:'hello',updatedAt:'saved',messages:[{id:'m',role:'user',content:'hello'}]}]}},
    sanitizeAiMessages: messages => structuredClone(messages),
    inferAiSessionTitle: messages => messages[0]?.content || 'New',
  }
  vm.createContext(context)
  vm.runInContext(source.slice(source.indexOf('function persistCurrentAiSession()'),source.indexOf('function activateAiSession(')),context)
  context.persistCurrentAiSession(); context.persistCurrentAiSession()
  assert.equal(context.state.generate.aiSessions[0].updatedAt,'saved')
  context.state.generate.aiMessages[0].content = 'edited'
  context.persistCurrentAiSession()
  assert.notEqual(context.state.generate.aiSessions[0].updatedAt,'saved')
  assert.equal(context.state.generate.aiSessions[0].title,'edited')
})
