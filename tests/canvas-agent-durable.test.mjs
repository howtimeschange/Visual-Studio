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
