import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { createDesignAgentRun } from '../public/js/design-agent-harness.js'
import { mergeAgentRunMessages } from '../public/js/canvas-agent-client.js'
import { createAgentUploadQueue, agentReferenceAssetBody, selectAgentImageFiles, isFileDrag } from '../public/js/agent-upload.js'

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve=yes; reject=no }); return {promise,resolve,reject} }
async function fixture() {
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('async function sendCanvasAiMessage() {'),end=source.indexOf('/* ═══════════════ RENDER GENERATE',start)
 const session={id:'conversation-1',skillId:'auto'},requests=[]
 const context={crypto:webcrypto,createDesignAgentRun,mergeAgentRunMessages,pendingAgentSubmission:null,
  state:{generate:{aiRunning:false,genRunning:false,projectId:'project-1',aiRefs:[],aiMessages:[],genModel:'nano-banana-2',genRatio:'1:1',genResolution:'1k'},account:{user:{id:'user-1'}},keys:{},runtime:{},notice:{}},
  dom:{gInput:{value:'请先规划',style:{}},gAiModel:{value:'nano-banana-2'},gAiRatio:{value:'1:1'},gAiResolution:{value:'1k'},gAiMessages:{scrollHeight:100}},
  $:()=>({textContent:''}),agentReferenceLimit:()=>6,syncCanvasImageOptions(){},canvasImagePixelOptions:()=>({}),imageOptionError:()=>'',normalizeAspectRatio:v=>v,normalizeCanvasResolution:v=>v,
  ensureCanvasProjectRecord:async()=> 'project-1',ensureAiSessionSelection:()=>session,getCanvasAgentContext:()=>({elementCount:0}),
  renderAiSessionControls(){},renderAiMessages(){},renderAiRefList(){},renderDesignAgentContext(){},renderAppNotice(){},saveRuntimeState(){},saveCanvasDraft(){},trimError:e=>e.message,
  canvasAgentWatcher:{start(){}},
  postJson:async(url,body)=>{requests.push({url,body});return {run:{id:body.runId,projectId:body.projectId,conversationId:body.conversationId,phase:'completed',mode:'auto',tasks:[],events:[]},plan:{reply:'分析完成'}}},
 }
 vm.createContext(context);vm.runInContext(source.slice(start,end),context)
 return {context,requests}
}

test('Send renders both messages before project creation and prevents a second execution',async()=>{
 const {context,requests}=await fixture(),creation=deferred();let creates=0
 context.ensureCanvasProjectRecord=()=>{creates++;return creation.promise}
 const first=context.sendCanvasAiMessage(),second=context.sendCanvasAiMessage()
 assert.equal(creates,1);assert.equal(context.state.generate.aiMessages.length,2)
 assert.equal(context.state.generate.aiMessages[1].run.clientStage,'preparing')
 assert.equal(context.state.generate.aiRunning,true)
 creation.reject(Error('fixture: creation failed'));await Promise.all([first,second])
 assert.equal(requests.length,0);assert.equal(context.state.generate.aiRunning,false)
 assert.equal(context.dom.gInput.value,'请先规划');assert.equal(context.dom.gInput.disabled,false)
 assert.equal(context.state.generate.aiMessages[1].run.phase,'failed')
})

test('Send waits for an existing upload; failure keeps the draft and never submits a model request',async()=>{
 const {context,requests}=await fixture(),upload=deferred(),started=deferred(),ref={id:'reference',dataUrl:'data:image/jpeg;base64,ZmFrZQ=='}
 context.state.generate.aiRefs=[ref];context.ensureAgentReferenceUpload=()=>{started.resolve();return upload.promise}
 const sending=context.sendCanvasAiMessage();await started.promise
 assert.equal(context.state.generate.aiMessages.length,2)
 assert.equal(context.state.generate.aiMessages[1].run.clientStage,'uploading')
 upload.reject(Error('fixture: network lost'));await sending
 assert.equal(requests.length,0);assert.equal(context.state.generate.aiRefs[0],ref)
 assert.equal(context.dom.gInput.value,'请先规划');assert.match(context.state.generate.aiMessages[1].content,/任务未提交/)
})

test('upload queue overlaps two files, reuses promises and waits for asset persistence at 100%',async()=>{
 const refs=[{},{},{}],slots=[],states=[]
 const queue=createAgentUploadQueue({prepare:async()=>({dataUrl:'data:image/png;base64,AA=='}),upload:async(ref,options,progress)=>{const slot=deferred();slots.push({slot,ref});progress({percent:100});return slot.promise},onChange:ref=>states.push(ref.uploadState)})
 const promises=refs.map(ref=>queue.ensure(ref));assert.equal(queue.ensure(refs[0]),promises[0])
 await Promise.resolve();await Promise.resolve();assert.equal(slots.length,2);assert.equal(refs[0].uploadState,'saving');assert.equal(refs[0].assetId,undefined)
 slots[0].slot.resolve({assetId:'a'});await promises[0];await Promise.resolve();assert.equal(slots.length,3)
 slots[1].slot.resolve({assetId:'b'});slots[2].slot.resolve({assetId:'c'});await Promise.all(promises)
 assert.ok(states.includes('queued'));assert.ok(refs.every(ref=>ref.uploadState==='ready'))
})

test('failed uploads require explicit retry and expired scopes cannot upload',async()=>{
 let uploads=0;const ref={}
 const queue=createAgentUploadQueue({prepare:async()=>({}),upload:async()=>{uploads++;if(uploads===1)throw Error('offline');return {assetId:'a'}}})
 await assert.rejects(queue.ensure(ref),/offline/);await assert.rejects(queue.ensure(ref),/offline/);assert.equal(uploads,1)
 await queue.retry(ref);assert.equal(uploads,2)
 await assert.rejects(queue.ensure({},{isCurrent:()=>false}),/已改变/);assert.equal(uploads,2)
})

test('actual data URL MIME wins over stale metadata; file drags filter and enforce the remaining limit',()=>{
 for(const mime of ['image/jpeg','image/webp','image/png'])assert.equal(agentReferenceAssetBody({mime:'image/png',dataUrl:`data:${mime};base64,ZmFrZQ==`}).mime,mime)
 const files=[{name:'a.png',type:'image/png'},{name:'note.txt',type:'text/plain'},{name:'b.jpg',type:'image/jpeg'}]
 const selected=selectAgentImageFiles(files,1);assert.equal(selected.files.length,1);assert.equal(selected.rejected,true);assert.equal(selected.overflow,true)
 assert.equal(isFileDrag({types:['text/plain']}),false);assert.equal(isFileDrag({types:['Files']}),true)
})

test('ready references send one durable request with prior history, then clear only the submitted draft',async()=>{
 const {context,requests}=await fixture()
 context.state.generate.aiMessages=[{id:'old',role:'assistant',content:'之前的回复'}]
 context.state.generate.aiRefs=[{id:'reference',assetId:'existing-asset',dataUrl:'data:image/png;base64,AA=='}]
 context.ensureAgentReferenceUpload=()=>{throw Error('must reuse asset')}
 await context.sendCanvasAiMessage()
 assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/canvas/agent-runs')
 assert.equal(requests[0].body.history.length,1);assert.equal(requests[0].body.referenceImages[0].assetId,'existing-asset')
 assert.equal(context.state.generate.aiMessages.length,3)
 assert.equal(context.dom.gInput.value,'');assert.equal(context.state.generate.aiRefs.length,0)
})

test('cancel during upload preserves the draft and produces a stopped record without submitting a task',async()=>{
 const {context,requests}=await fixture(),upload=deferred(),started=deferred(),ref={id:'reference'}
 context.state.generate.aiRefs=[ref];context.ensureAgentReferenceUpload=()=>{started.resolve();return upload.promise}
 const sending=context.sendCanvasAiMessage();await started.promise
 context.pendingAgentSubmission.run.stopRequested=true
 ref.assetId='uploaded';upload.resolve(ref);await sending
 assert.equal(requests.length,0);assert.equal(context.state.generate.aiMessages[1].run.phase,'stopped')
 assert.equal(context.state.generate.aiMessages[1].run.error,'');assert.equal(context.dom.gInput.value,'请先规划')
 assert.equal(context.state.generate.aiRefs[0],ref)
})
