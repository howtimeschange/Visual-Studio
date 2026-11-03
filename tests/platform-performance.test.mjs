import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { createReadPool } from '../public/js/read-pool.js'
import { createCanvasAgentWatcher } from '../public/js/canvas-agent-client.js'

const source = await readFile(new URL('../public/app.js',import.meta.url),'utf8')
const section = (start,end) => source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)))
const turn = () => new Promise(resolve => setImmediate(resolve))

test('workspace asset reads deduplicate per scope, stay bounded and release failed reads for retry', async () => {
  const pool = createReadPool(2), releases = [], calls = []
  let active = 0, peak = 0
  const read = id => () => new Promise(resolve => { calls.push(id); active++; peak = Math.max(peak,active); releases.push(() => { active--; resolve(id) }) })
  const one = pool('a:one',read('one')), duplicate = pool('a:one',read('duplicate'))
  const two = pool('a:two',read('two')), other = pool('b:one',read('other account'))
  assert.equal(one,duplicate); assert.deepEqual(calls,['one','two'])
  releases.shift()(); await turn()
  assert.deepEqual(calls,['one','two','other account']); assert.equal(peak,2)
  releases.splice(0).forEach(resolve => resolve())
  assert.deepEqual(await Promise.all([one,two,other]),['one','two','other account'])
  await assert.rejects(pool('bad',async () => { throw new Error('offline') }),/offline/)
  assert.equal(await pool('bad',async () => 'recovered'),'recovered')
})

test('all batch workflows poll job and items in one request and retain terminal settlement checks', async () => {
  const calls = [], context = {
    TERMINAL_JOB_STATUSES:new Set(['completed']), JOB_SNAPSHOT_SETTLE_RETRIES:2, JOB_SNAPSHOT_SETTLE_DELAY_MS:1,
    wait:async()=>{}, isTerminalJobItemSnapshotReady:(_job,items)=>items[0]?.status === 'completed',
    getJson:async url => { calls.push(url); return url.endsWith('/items') ? {items:[{status:'completed'}]} : {job:{status:'completed'},items:[{status:'running'}]} },
  }
  vm.createContext(context)
  vm.runInContext(section('async function fetchJobSnapshot(', 'async function syncTranslateJob('),context)
  assert.equal((await context.fetchJobSnapshot('j')).items[0].status,'completed')
  assert.deepEqual(calls,['/api/jobs/j?includeItems=1','/api/jobs/j/items'])
  calls.length=0
  context.getJson=async url=>{ calls.push(url);return {job:{status:'running'},items:[]} }
  await context.fetchJobSnapshot('j'); assert.equal(calls.length,1)
})

for (const [kind,name,end] of [['translate','syncTranslateJob','function mapOutfitJobItem'],['style','syncStyleJob','async function syncAiTestJob'],['aiTest','syncAiTestJob','async function syncOutfitJob']]) {
  test(`${kind} unchanged job snapshots do not repaint or rewrite storage, final result still appears`,async()=>{
    let reads=0, paints=0, saves=0
    const tasks=[], type = {translate:'translate_batch',style:'style_transfer_batch',aiTest:'ai_test_batch'}[kind]
    const context = {
      [`${kind}WatcherToken`]:0,[`${kind}JobWatchers`]:new Map(),
      state:{[kind]:{}}, getLoadedJobId:()=>'', getJobTasks:()=>tasks,
      fetchJobSnapshot:async()=>({job:{id:'j',type,status:++reads === 3?'completed':'running'},items:[]}),
      createJobSnapshotSignature:job=>job.status, [`clear${kind === 'aiTest'?'AiTest':kind[0].toUpperCase()+kind.slice(1)}SubmitLock`]:()=>{},
      upsertJobTask:()=>{if(!tasks.length) tasks.push({jobId:'j'});return tasks[0]},
      [`render${kind === 'aiTest'?'AiTest':kind[0].toUpperCase()+kind.slice(1)}`]:()=>paints++,
      saveRuntimeState:()=>saves++,shouldStopPollingJobSnapshot:job=>job.status==='completed',getJobPollInterval:()=>0,wait:async()=>{},
    }
    vm.createContext(context); vm.runInContext(section(`async function ${name}(`,end),context)
    await context[name]('j')
    assert.equal(reads,3);assert.equal(paints,2);assert.equal(saves,2)
  })
}

test('unrelated canvas updates do not repeatedly serialize the multi-megabyte style/result cache',()=>{
  let reads=0,writes=0
  const context={state:{style:{history:[]}},canvasWorkspaceScope:()=> 'owner',serializeStyleHistoryEntries:v=>v,
    loadResultsStore:()=>{reads++; return {translate:{large:'x'.repeat(2000000)}}},saveResultsStore:()=>{writes++;return true}}
  vm.createContext(context)
  vm.runInContext(section("let styleHistorySavedSignature = ''",'async function hydrateStyleHistory('),context)
  for(let i=0;i<20;i++) context.saveStyleHistory()
  assert.equal(reads,1);assert.equal(writes,1)
  context.state.style.history.push({assetId:'new'});context.saveStyleHistory()
  assert.equal(writes,2)
})

test('Agent watcher skips unchanged element reads, slows down at idle, and pauses while hidden',async()=>{
  const timers=[],reads=[],seen=[]
  let visible=true, asset='a'
  const watcher=createCanvasAgentWatcher({
    getJson:async url=>{reads.push(url);return url.endsWith('/elements')?{elements:[{id:asset}]}:{runs:[{run:{phase:'completed',tasks:[{assetId:asset}]}}]}},
    onSnapshot:snapshot=>seen.push(snapshot),isVisible:()=>visible,
    schedule:(fn,delay)=>{timers.push({fn,delay});return fn},cancel:fn=>{const i=timers.findIndex(t=>t.fn===fn);if(i>=0)timers.splice(i,1)},
  })
  watcher.start('p','owner');await turn()
  assert.equal(reads.length,2);assert.equal(timers[0].delay,15000)
  timers.shift().fn();await turn();assert.equal(reads.length,3);assert.equal(seen[1].elements[0].id,'a')
  visible=false;timers.shift().fn();await turn();assert.equal(reads.length,3)
  visible=true;asset='b';watcher.refresh();await turn();assert.equal(reads.length,5);assert.equal(seen.at(-1).elements[0].id,'b')
  watcher.stop()
})

test('project list reads are shared, cache empty lists, and discard late account responses',async()=>{
  const requests=[], context={
    state:{runtime:{sessionId:'s'},account:{user:{id:'a'}},projects:{items:[],filterShared:false,loadedSessionId:''}},
    dom:{pList:{}},renderProjects(){},renderHome(){},trimError:e=>e.message,
    getJson:url=>new Promise(resolve=>requests.push({url,resolve})),
  }
  context.canvasWorkspaceScope=()=>context.state.account.user.id
  vm.createContext(context)
  vm.runInContext(section('let canvasProjectListInFlight = null','function scheduleCanvasProjectSave('),context)
  const first=context.loadCanvasProjects(), duplicate=context.loadCanvasProjects()
  assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/canvas/projects?summary=1')
  requests[0].resolve({projects:[]});await Promise.all([first,duplicate])
  await context.loadCanvasProjects();assert.equal(requests.length,1)
  const old=context.loadCanvasProjects({force:true})
  context.state.account.user={id:'b'}
  const current=context.loadCanvasProjects()
  requests[2].resolve({projects:[{id:'b-project'}]});await current
  requests[1].resolve({projects:[{id:'private-a'}]});await old
  assert.equal(context.state.projects.items[0].id,'b-project')
})
