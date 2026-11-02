import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto) globalThis.crypto = webcrypto

async function fixture() {
  const dir = await mkdtemp(`${tmpdir()}/agent-durable-`)
  await build({ stdin: { contents: `export * from './functions/_lib/canvas-agent-runner.ts';export * from './functions/_lib/v2-store.ts'; export {runQueuedJob} from './functions/_lib/v2-runner.ts';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: `${dir}/test.mjs`, logLevel: 'silent', plugins: [{ name: 'bounded-provider-fixture', setup(b) {
    b.onLoad({ filter: /functions\/api\/canvas\/agent.ts$/ }, () => ({ contents: 'export async function executeCanvasAgentPlan(env, body) { return env.plan(body) }', loader: 'js' }))
    b.onLoad({ filter: /functions\/_lib\/image-quality.ts$/ }, () => ({ contents: 'export async function reviewGeneratedImage(env, body) { return env.review(body) }', loader: 'js' }))
  } }] })
  const mod = await import(pathToFileURL(`${dir}/test.mjs`))
  let plans = 0, reviews = 0
  const messages = []
  const env = { VS_JOBS_QUEUE: { send: async m => messages.push(m) }, plan: async () => { plans++; return Response.json({ shouldGenerate: true, actions: [1,2].map(i => ({ type: 'generate_image', title: `图${i}`, prompt: `make ${i}` })) }) }, review: async () => { reviews++; return { status: 'passed', issues: [] } } }
  const project = await mod.createCanvasProject(env, { sessionId: 's', ownerUserId: 'owner' })
  const input = { runId: crypto.randomUUID(), conversationId: 'conv', projectId: project.id, message: 'make two images', modelId: 'nano-banana-2', resolution: '1k', aspectRatio: '1:1', clientKeys: { banana2ApiKey: 'secret-fixture' } }
  return { mod, env, project, input, messages, counts: () => ({ plans, reviews }), cleanup: () => rm(dir, { recursive: true, force: true }) }
}

test('server run survives client absence and duplicate delivery; produces every planned image exactly once', async () => {
  const f = await fixture(); const { mod, env, input } = f
  try {
    const submitted = await mod.submitCanvasAgentRun(env, input, 'owner')
    const duplicate = await mod.submitCanvasAgentRun(env, input, 'owner')
    assert.equal(submitted.jobId, duplicate.jobId)
    assert.doesNotMatch(JSON.stringify(submitted), /secret-fixture/)
    await mod.runCanvasAgentJob(env, submitted.jobId)
    assert.equal(f.counts().plans, 1)
    for (let i=0; i<2; i++) {
      let parent = await mod.getJob(env, submitted.jobId)
      const task = parent.summaryJson.run.tasks[i]
      const child = await mod.getJob(env, task.jobId)
      assert.ok(child)
      const asset = await mod.createAsset(env, { sessionId: 's', userId: 'owner', kind: 'result', dataUrl: 'data:image/png;base64,aW1hZ2U=', width: i ? 1024 : 512, height: i ? 1024 : 512 })
      await mod.updateJob(env, child.id, { status: 'completed', summaryJson: { resultAssetId: asset.id } })
      await mod.runCanvasAgentJob(env, submitted.jobId)
      // The next queue delivery accepts the next planned image, without a browser.
      await mod.runCanvasAgentJob(env, submitted.jobId)
    }
    const parent = await mod.getJob(env, submitted.jobId)
    assert.equal(parent.status, 'completed')
    assert.deepEqual(f.counts(), { plans: 1, reviews: 2 })
    assert.equal(parent.summaryJson.run.tasks[0].delivery.status, 'mismatch')
    assert.equal(parent.summaryJson.run.tasks[1].delivery.status, 'passed')
    assert.equal((await mod.listCanvasProjectElements(env, input.projectId)).length, 2)
    await mod.runCanvasAgentJob(env, submitted.jobId)
    assert.deepEqual(f.counts(), { plans: 1, reviews: 2 })
    assert.ok(f.messages.every(m => !m.clientKeys))
    await assert.rejects(mod.submitCanvasAgentRun(env, { ...input, message: 'different' }, 'owner'), { status: 409 })
    await assert.rejects(mod.submitCanvasAgentRun(env, { ...input, runId: crypto.randomUUID() }, 'other'), { status: 403 })
  } finally { await f.cleanup() }
})

test('unknown planning is paused without replay; stop preserves accepted child and prevents further dispatch', async () => {
  const f = await fixture(); const { mod, env, input } = f
  try {
    env.plan = async () => { throw new Error('lost response') }
    const { jobId } = await mod.submitCanvasAgentRun(env, input, 'owner')
    await mod.runCanvasAgentJob(env, jobId)
    assert.equal((await mod.getJob(env, jobId)).status, 'paused')
    env.plan = () => { throw new Error('must not call again') }
    await mod.runCanvasAgentJob(env, jobId)
    const other = await mod.submitCanvasAgentRun(env, { ...input, runId: crypto.randomUUID() }, 'owner')
    env.plan = async () => Response.json({ shouldGenerate: true, actions: [1,2].map(i => ({ type: 'generate_image', prompt: `${i}` })) })
    await mod.runCanvasAgentJob(env, other.jobId)
    const parent = await mod.getJob(env, other.jobId)
    const child = await mod.getJob(env, parent.summaryJson.run.tasks[0].jobId)
    await mod.stopCanvasAgentJob(env, parent)
    const asset = await mod.createAsset(env, { sessionId:'s', userId:'owner', kind:'result', dataUrl:'data:image/png;base64,aW1hZ2U=', width:1024, height:1024 })
    await mod.updateJob(env, child.id, { status:'completed', summaryJson:{ resultAssetId:asset.id } })
    await mod.runCanvasAgentJob(env, parent.id)
    const stopped = await mod.getJob(env, parent.id)
    assert.equal(stopped.summaryJson.run.phase, 'stopped')
    assert.equal(stopped.summaryJson.run.tasks[0].status, 'completed')
    assert.equal(stopped.summaryJson.run.tasks[1].status, 'skipped')
    assert.equal(await mod.getJob(env, stopped.summaryJson.run.tasks[1].jobId), null)
  } finally { await f.cleanup() }
})

test('stale canvas save preserves unseen server artwork and quality; known artwork remains deletable', async () => {
  const f = await fixture(); const { mod, env, input } = f
  try {
    await mod.replaceCanvasProjectElements(env, input.projectId, [{ id:'text',type:'text',content:'original' }], [])
    await mod.insertCanvasAgentElement(env, input.projectId, { id:'result',type:'image',agentRunId:'run',x:0 })
    await mod.replaceCanvasProjectElements(env, input.projectId, [{ id:'text',type:'text',content:'edit' }], ['text'])
    assert.equal((await mod.listCanvasProjectElements(env, input.projectId)).length, 2)
    await mod.patchCanvasAgentReview(env, input.projectId, 'result','run',{ status:'passed' })
    await mod.replaceCanvasProjectElements(env, input.projectId, [{ id:'result',type:'image',agentRunId:'run',x:200 }], ['text','result'])
    const [result] = await mod.listCanvasProjectElements(env, input.projectId)
    assert.equal(result.dataJson.x, 200)
    assert.equal(result.dataJson.qualityReview.status, 'passed')
    await mod.replaceCanvasProjectElements(env, input.projectId, [], ['result'])
    assert.equal((await mod.listCanvasProjectElements(env, input.projectId)).length, 0)
  } finally { await f.cleanup() }
})

test('new run is placed beyond existing artwork; interrupted independent review is not repeated', async () => {
  const f=await fixture();const {mod,env,input}=f
  try {
    env.plan=async()=>Response.json({shouldGenerate:true,actions:[{type:'generate_image',prompt:'one image'}]})
    await mod.replaceCanvasProjectElements(env,input.projectId,[{id:'existing',type:'image',x:300,y:0,width:900,height:500}],[])
    const {jobId}=await mod.submitCanvasAgentRun(env,input,'owner')
    await mod.runCanvasAgentJob(env,jobId)
    const parent=await mod.getJob(env,jobId),task=parent.summaryJson.run.tasks[0]
    const asset=await mod.createAsset(env,{sessionId:'s',userId:'owner',kind:'result',dataUrl:'data:image/png;base64,aW1hZ2U=',width:1024,height:1024})
    await mod.updateJob(env,task.jobId,{status:'completed',summaryJson:{resultAssetId:asset.id}})
    const [item]=await mod.listJobItems(env,jobId)
    await mod.updateJobItem(env,jobId,item.id,{outputJson:{...item.outputJson,reviewIntent:{taskId:task.id,requestId:'interrupted-review'}}})
    await mod.runCanvasAgentJob(env,jobId)
    const generated=(await mod.listCanvasProjectElements(env,input.projectId)).find(e=>e.dataJson.agentRunId)
    assert.ok(generated.dataJson.x>=1264)
    assert.equal(generated.dataJson.qualityReview.status,'unknown')
    assert.equal(f.counts().reviews,0)
    assert.equal((await mod.getJob(env,jobId)).status,'completed')
  }finally{await f.cleanup()}
})

test('missing run credential pauses safely and public state no longer spins as active', async () => {
  const f=await fixture();const {mod,env,input}=f
  try {
    const {jobId}=await mod.submitCanvasAgentRun(env,input,'owner')
    const job=await mod.getJob(env,jobId)
    await mod.deleteSealedCredential(env,job.configJson.sealedCredentialId)
    await mod.runQueuedJob(env,jobId)
    const paused=await mod.getJob(env,jobId)
    assert.equal(paused.status,'paused')
    assert.equal(mod.publicCanvasAgentJob(paused).run.phase,'awaiting_result')
    assert.equal(f.counts().plans,0)
    assert.equal((await mod.listJobItems(env,jobId))[0].status,'queued')
  }finally{await f.cleanup()}
})

test('pending child monitoring is read-only and completed artwork is visible before review finishes', async () => {
  const f = await fixture(); const { mod, env, input } = f
  try {
    env.plan = async () => Response.json({ shouldGenerate: true, actions: [{ type: 'generate_image', prompt: 'one' }] })
    const { jobId } = await mod.submitCanvasAgentRun(env, input, 'owner')
    await mod.runCanvasAgentJob(env, jobId)
    const parent = await mod.getJob(env, jobId), task = parent.summaryJson.run.tasks[0]
    const child = await mod.getJob(env, task.jobId)
    assert.equal(child.configJson.parentAgentJobId, jobId)
    const [before] = await mod.listJobItems(env, jobId)
    await mod.runCanvasAgentJob(env, jobId)
    const [after] = await mod.listJobItems(env, jobId)
    assert.equal(after.attemptCount, before.attemptCount)
    assert.equal((await mod.getJob(env, jobId)).updatedAt, parent.updatedAt)
    const asset = await mod.createAsset(env, { sessionId: 's', userId: 'owner', kind: 'result', dataUrl: 'data:image/png;base64,aW1hZ2U=', width: 1024, height: 1024 })
    await mod.updateJob(env, child.id, { status: 'completed', summaryJson: { resultAssetId: asset.id } })
    env.review = async () => {
      const visible = await mod.getJob(env, jobId)
      assert.equal(visible.summaryJson.run.tasks[0].assetId, asset.id)
      assert.ok(visible.summaryJson.run.timings.firstImageMs >= 0)
      assert.equal((await mod.listCanvasProjectElements(env, input.projectId)).length, 1)
      return { status: 'passed', issues: [] }
    }
    await mod.runCanvasAgentJob(env, jobId)
    const finished = await mod.getJob(env, jobId)
    assert.equal(finished.status, 'completed')
    assert.ok(finished.summaryJson.run.tasks[0].timings.reviewMs >= 0)
  } finally { await f.cleanup() }
})

test('image completion wakes its parent without delay; duplicate delivery never regenerates', async () => {
  const f = await fixture(); const { mod, env, input } = f
  const originalFetch = globalThis.fetch
  try {
    env.plan = async () => Response.json({ shouldGenerate: true, actions: [{ type: 'generate_image', prompt: 'one' }] })
    const { jobId } = await mod.submitCanvasAgentRun(env, input, 'owner')
    await mod.runCanvasAgentJob(env, jobId)
    const task = (await mod.getJob(env, jobId)).summaryJson.run.tasks[0]
    let calls = 0
    globalThis.fetch = async () => { calls++; return Response.json({ status: 'succeeded', data: [{ b64_json: 'aW1hZ2U=' }], delivery:{requested:{model:'gpt-image-2.5-flare',quality:'high'},upstream:{quality:'low'},secret:'never-store'} }) }
    const before = f.messages.length
    await mod.runQueuedJob(env, task.jobId)
    assert.equal((await mod.getJob(env, task.jobId)).status, 'completed')
    const summary = (await mod.getJob(env, task.jobId)).summaryJson
    assert.equal(summary.providerDelivery.reportedQuality, 'low')
    assert.equal(JSON.stringify(summary).includes('never-store'), false)
    const wakes = f.messages.slice(before).filter(m => m.jobId === jobId)
    assert.equal(wakes.length, 1)
    assert.equal(wakes[0].delaySeconds, undefined)
    await mod.runQueuedJob(env, task.jobId)
    assert.equal(calls, 1)
  } finally { globalThis.fetch = originalFetch; await f.cleanup() }
})

test('GPT quality selection does not skip visual review; delivery mismatches keep the original paid result', async () => {
  const f = await fixture(); const { mod,env,input }=f
  try {
    env.plan=async()=>Response.json({shouldGenerate:true,actions:[{type:'generate_image',prompt:'one'}]})
    const {jobId}=await mod.submitCanvasAgentRun(env,{...input,modelId:'gpt-image-2.5-flare',size:'3840x2160',quality:'high',aspectRatio:'16:9',resolution:'4k',clientKeys:{provider:'modeljetty'}},'owner')
    await mod.runCanvasAgentJob(env,jobId)
    const task=(await mod.getJob(env,jobId)).summaryJson.run.tasks[0]
    assert.equal(task.generationQuality,'high'); assert.equal(task.quality,undefined)
    const asset=await mod.createAsset(env,{sessionId:'s',userId:'owner',kind:'result',dataUrl:'data:image/png;base64,aW1hZ2U=',width:1672,height:941})
    await mod.updateJob(env,task.jobId,{status:'completed',summaryJson:{resultAssetId:asset.id,providerDelivery:{requestedModel:'gpt-image-2.5-flare',requestedQuality:'high',reportedQuality:'low'}}})
    await mod.runCanvasAgentJob(env,jobId)
    const final=await mod.getJob(env,jobId)
    assert.equal(final.status,'completed'); assert.equal(f.counts().reviews,1)
    assert.equal(final.summaryJson.run.tasks[0].delivery.status,'mismatch')
    assert.equal(final.summaryJson.run.tasks[0].delivery.provider.reportedQuality,'low')
    assert.equal((await mod.listCanvasProjectElements(env,input.projectId))[0].dataJson.assetId,asset.id)
    await mod.runCanvasAgentJob(env,jobId); assert.equal(f.counts().reviews,1)
  } finally { await f.cleanup() }
})

test('unsupported ModelJetty aspect ratios and excess references fail before a paid plan or queue dispatch', async () => {
  const f = await fixture()
  try {
    const base = { ...f.input, modelId: 'gpt-image-2.5-flare', clientKeys: { provider: 'modeljetty' } }
    await assert.rejects(f.mod.submitCanvasAgentRun(f.env, { ...base, aspectRatio: '1:4', resolution: '4k' }, 'owner'), { status: 400 })
    await assert.rejects(f.mod.submitCanvasAgentRun(f.env, { ...base, referenceImages: Array.from({ length: 5 }, (_, i) => ({ assetId: `reference-${i}` })) }, 'owner'), { status: 400 })
    assert.equal(f.counts().plans, 0)
    assert.equal(f.messages.length, 0)
  } finally { await f.cleanup() }
})
