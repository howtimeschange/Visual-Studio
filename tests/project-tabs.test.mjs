import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createProjectTabStore, normalizeProjectTabs } from '../public/js/project-tabs.js'

test('project tabs append to the right, keep stable order and isolate account storage', () => {
  const values = new Map(), storage = { getItem:k => values.get(k), setItem:(k,v) => values.set(k,v) }
  const tabs = createProjectTabStore(storage)
  tabs.scope('a'); tabs.open({id:'one',title:'One'}); tabs.open({id:'two',title:'Two'}); tabs.open({id:'one',title:'Renamed'})
  assert.deepEqual(tabs.list().map(t => t.id), ['one','two'])
  tabs.scope('b'); assert.deepEqual(tabs.list(), [])
  tabs.open({id:'other',title:'Other'}); tabs.scope('a')
  assert.equal(tabs.list()[0].title, 'Renamed')
  assert.equal(tabs.close('one'), 'two'); assert.equal(tabs.close('two'), '')
  assert.deepEqual(normalizeProjectTabs([{id:'../bad'}, {id:'ok',title:'A',secret:'never'}, {id:'ok'}]), [{id:'ok',title:'A'}])
  for (let i=0;i<25;i++) tabs.open({id:`p-${i}`})
  assert.equal(tabs.list().length,20)
  assert.equal(JSON.stringify([...values.values()]).includes('never'),false)
})

async function navigationFixture() {
  const source = await readFile(new URL('../public/app.js',import.meta.url),'utf8')
  const events = [], context = {
    pendingAgentSubmission:null, canvasProjectCreateInFlight:null, canvasSaveInFlight:null, canvasSaveTimer:0,
    state:{generate:{projectId:'one',projectSaveStatus:'saved',aiRefs:[]},notice:{}},
    dom:{gInput:{value:'draft'},gAiMessages:{scrollTop:12}}, canvasProjectViews:new Map(),
    window:{clearTimeout(){}}, syncCanvasProjectTabScope(){}, persistCurrentAiSession(){}, canvasWorkspaceScope:()=> 'owner',
    saveCanvasDraft:async()=>events.push('draft'), persistCanvasProject:async()=>events.push('save'),renderAppNotice(){},
    setCanvasNavigationStage(){},
  }
  vm.createContext(context)
  vm.runInContext(source.slice(source.indexOf('async function prepareCanvasProjectNavigation()'),source.indexOf('async function closeCanvasProjectTab(')),context)
  return {context,events}
}
test('project switching waits for pending creation and save, while failed saves retain the current project', async () => {
  const {context,events} = await navigationFixture()
  let release
  context.state.generate.projectId = ''
  context.canvasProjectCreateInFlight = new Promise(resolve => { release = () => { context.state.generate.projectId='created'; resolve() } })
  const prepare = context.prepareCanvasProjectNavigation()
  assert.deepEqual(events,[])
  release(); assert.equal(await prepare,true)
  assert.deepEqual(events,['draft','save'])
  assert.equal(context.canvasProjectViews.get('owner:created').draft,'draft')
  context.persistCanvasProject = async()=>{ context.state.generate.projectSaveStatus='local' }
  assert.equal(await context.prepareCanvasProjectNavigation(),false)
  assert.equal(context.state.generate.projectId,'created')
  context.pendingAgentSubmission = {}; events.length=0
  assert.equal(await context.prepareCanvasProjectNavigation(),false)
  assert.deepEqual(events,[])
})
