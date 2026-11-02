import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

async function harness() {
  const directory = await mkdtemp(path.join(tmpdir(), 'vs-review-security-'))
  await build({ stdin: { contents: `
    export * from './functions/_lib/v2-store.ts'
    export * from './functions/_lib/auth.ts'
    export * from './functions/_lib/permissions.ts'
    export * from './functions/_lib/admin.ts'
    export * from './functions/_lib/v2-runner.ts'
    export { onRequestGet as projects } from './functions/api/canvas/projects.ts'
    export { onRequestPost as direct } from './functions/api/generate-direct.ts'
    export { onRequestPost as agent } from './functions/api/canvas/agent.ts'
    export { onRequestPost as ocr } from './functions/api/canvas/psd-ocr.ts'
    export { onRequestPost as style } from './functions/api/style-transfer.ts'
    export { onRequestGet as asset } from './functions/api/assets/[id].ts'
    export { onRequestPut as elements } from './functions/api/canvas/projects/[id]/elements.ts'
    export { onRequestPost as register } from './functions/api/auth/register.ts'
    export { callImageModelTaskStep } from './functions/_shared.ts'
  `, resolveDir: process.cwd(), loader: 'js' }, bundle: true, format: 'esm', platform: 'node', outfile: path.join(directory, 'entry.mjs'), logLevel: 'silent' })
  const mod = await import(pathToFileURL(path.join(directory, 'entry.mjs')).href)
  const env = {}
  async function user(name) {
    const user = await mod.createUser(env, { email: `${name}@example.com`, passwordHash: '', passwordSalt: '' })
    const login = await mod.createLoginResponse(env, user, new Request('http://localhost/'))
    return { ...user, cookie: login.setCookie.split(';')[0] }
  }
  return { mod, env, owner: await user('owner'), other: await user('other'), cleanup: () => rm(directory, { recursive: true, force: true }) }
}
const request = (method, cookie = '', body, query = '') => new Request(`http://localhost/api/test${query}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

async function ownedAsset(h, user) {
  const session = await h.mod.ensureSession(h.env, undefined, user.id)
  return h.mod.createAsset(h.env, { sessionId: session.id, userId: user.id, kind: 'upload', dataUrl: 'data:image/png;base64,aW1hZ2U=' })
}

test('anonymous and unrelated account cannot enumerate private project metadata using session IDs', async () => {
  const h = await harness()
  try {
    const session = await h.mod.ensureSession(h.env, undefined, h.owner.id)
    const privateProject = await h.mod.createCanvasProject(h.env, { sessionId: session.id, ownerUserId: h.owner.id, metadataJson: { privatePrompt: 'owner secret' } })
    assert.equal((await h.mod.projects({ env: h.env, request: request('GET', '', undefined, `?sessionId=${session.id}`) })).status, 401)
    const foreign = await h.mod.projects({ env: h.env, request: request('GET', h.other.cookie, undefined, `?sessionId=${session.id}`) })
    assert.deepEqual((await foreign.json()).projects, [])
    const own = await h.mod.projects({ env: h.env, request: request('GET', h.owner.cookie) })
    assert.equal((await own.json()).projects[0].id, privateProject.id)
  } finally { await h.cleanup() }
})

test('unverified email whitelist cannot grant admin; explicitly configured user IDs can', async () => {
  const h = await harness()
  try {
    assert.equal(h.mod.isAdminUser({ ADMIN_EMAILS: h.owner.email, VS_ADMIN_EMAILS: h.owner.email }, h.owner), false)
    assert.equal(h.mod.isAdminUser({ ADMIN_USER_IDS: h.owner.id }, h.owner), true)
    assert.equal(h.mod.isAdminUser({ ADMIN_USER_IDS: h.owner.id }, h.other), false)
  } finally { await h.cleanup() }
})

test('session ownership is immutable and anonymous sessions cannot be claimed from a supplied ID', async () => {
  const h = await harness()
  try {
    const session = await h.mod.ensureSession(h.env, undefined, h.owner.id)
    const second = await h.mod.ensureSession(h.env, session.id, h.other.id)
    assert.notEqual(second.id, session.id)
    assert.equal((await h.mod.ensureSession(h.env, session.id, h.owner.id)).userId, h.owner.id)
    const anonymous = await h.mod.ensureSession(h.env)
    const oldProject = await h.mod.createCanvasProject(h.env, { sessionId: anonymous.id })
    const result = await h.mod.register({ env: h.env, request: request('POST', '', { email: 'new@example.com', password: 'local-test-password', sessionId: anonymous.id }) })
    assert.equal(result.status, 200)
    assert.equal((await h.mod.getCanvasProject(h.env, oldProject.id)).ownerUserId, null)
    await assert.rejects(h.mod.assertCanReadProject(h.env, oldProject.id, h.other.id), /No access/)
  } finally { await h.cleanup() }
})

test('private model input IDs are rejected before any paid call, regardless of endpoint', async () => {
  const h = await harness()
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('must not reach provider') }
  try {
    const asset = await ownedAsset(h, h.owner)
    for (const route of ['direct', 'ocr', 'agent', 'style']) {
      const body = { assetId: asset.id, referenceImages: [{ assetId: asset.id }], prompt: 'test', message: 'test', width: 1, height: 1, action: 'analyze' }
      const result = await h.mod[route]({ env: h.env, request: request('POST', h.other.cookie, body) })
      assert.equal(result.status, 403, route)
    }
    assert.equal(calls, 0)
    assert.equal((await h.mod.agent({ env: { VISION_API_KEY: 'server-key' }, request: request('POST', '', { message: 'cost money' }) })).status, 401)
  } finally { globalThis.fetch = original; await h.cleanup() }
})

test('shared asset access requires a real element field and cannot be forged with a metadata substring', async () => {
  const h = await harness()
  try {
    const asset = await ownedAsset(h, h.owner)
    const project = await h.mod.createCanvasProject(h.env, { sessionId: asset.sessionId, ownerUserId: h.owner.id })
    await h.mod.upsertProjectMember(h.env, { projectId: project.id, userId: h.other.id, role: 'viewer', invitedBy: h.owner.id })
    await h.mod.replaceCanvasProjectElements(h.env, project.id, [{ id: 'el', type: 'text', content: `pretend ${asset.id}` }])
    await assert.rejects(h.mod.assertCanReadAsset(h.env, asset.id, h.other.id, project.id), /No access/)
    await h.mod.replaceCanvasProjectElements(h.env, project.id, [{ id: 'el', type: 'image', assetId: asset.id }])
    assert.equal((await h.mod.assertCanReadAsset(h.env, asset.id, h.other.id, project.id)).id, asset.id)
    await h.mod.removeProjectMember(h.env, project.id, h.other.id)
    await assert.rejects(h.mod.assertCanReadAsset(h.env, asset.id, h.other.id, project.id), /No access/)
  } finally { await h.cleanup() }
})

test('editing a project cannot plant another account asset to grant yourself access', async () => {
  const h = await harness()
  try {
    const privateAsset = await ownedAsset(h, h.owner)
    const session = await h.mod.ensureSession(h.env, undefined, h.other.id)
    const maliciousProject = await h.mod.createCanvasProject(h.env, { sessionId: session.id, ownerUserId: h.other.id })
    const result = await h.mod.elements({ env: h.env, params: { id: maliciousProject.id }, request: request('PUT', h.other.cookie, { elements: [{ id: 'el', type: 'image', assetId: privateAsset.id }] }) })
    assert.equal(result.status, 403)
    assert.deepEqual(await h.mod.listCanvasProjectElements(h.env, maliciousProject.id), [])
  } finally { await h.cleanup() }
})

test('a running request without a receipt is never resent by crash recovery, even with retry budget left', async () => {
  const h = await harness()
  const sent = []
  h.env.VS_JOBS_QUEUE = { send: async message => sent.push(message) }
  try {
    const job = await h.mod.createJob(h.env, { sessionId: 'fixture', userId: h.owner.id, type: 'generate_batch', status: 'running', configJson: {}, summaryJson: {}, progressTotal: 1, progressDone: 0, progressFailed: 0 })
    const [item] = await h.mod.createJobItems(h.env, job.id, [{ jobId: job.id, itemType: 'generate_batch_item', status: 'running', inputJson: {}, outputJson: { submitIntent: { requestId: 'stable-request-id' } }, attemptCount: 1, startedAt: new Date(0).toISOString() }])
    await h.mod.recoverJobs(h.env)
    assert.equal(sent.length, 0)
    const [saved] = await h.mod.listJobItems(h.env, job.id)
    assert.equal(saved.id, item.id)
    assert.match(saved.errorMessage, /UNKNOWN_SUBMIT_RESULT/)
    await assert.rejects(h.mod.retryJob(h.env, job.id), /提交结果未知/)
  } finally { await h.cleanup() }
})

test('submit intent is durable before dispatch, accepted task ID is saved before later work', async () => {
  const h = await harness()
  const original = globalThis.fetch
  h.env.VS_JOBS_QUEUE = { send: async () => {} }
  try {
    const submitted = await h.mod.submitGenerateDirectJob(h.env, { _authUserId: h.owner.id, prompt: 'one image', modelId: 'gpt-image-2', clientKeys: { gptImageApiKey: 'fixture' } })
    globalThis.fetch = async (_url, init) => {
      const [item] = await h.mod.listJobItems(h.env, submitted.jobId)
      assert.equal(item.outputJson.submitIntent.requestId, item.id)
      assert.equal(init.headers['X-Request-Id'], item.id)
      return Response.json({ id: 'upstream-accepted', status: 'queued' })
    }
    await h.mod.runQueuedJob(h.env, submitted.jobId)
    const [item] = await h.mod.listJobItems(h.env, submitted.jobId)
    assert.equal(item.outputJson.imageTask.id, 'upstream-accepted')
    assert.equal(item.status, 'queued')
  } finally { globalThis.fetch = original; await h.cleanup() }
})

test('image create deadline covers a hung HTTP response body and does not replay', async () => {
  const h = await harness()
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response(new ReadableStream({ start() {} })) }
  try {
    const start = Date.now()
    const result = await h.mod.callImageModelTaskStep('https://relay.example/v1', 'fixture', 'gpt-image-2', [], 'prompt', { timeoutMs: 1000 })
    assert.equal(result.status, 504)
    assert.equal(calls, 1)
    assert.match(result.error, /UNKNOWN_SUBMIT_RESULT/)
    assert.ok(Date.now() - start < 2000)
  } finally { globalThis.fetch = original; await h.cleanup() }
})
