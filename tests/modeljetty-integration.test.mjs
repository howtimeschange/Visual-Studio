import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { webcrypto } from 'node:crypto'
import { build } from 'esbuild'

if (!globalThis.crypto) globalThis.crypto = webcrypto
const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })

async function harness() {
  const directory = await mkdtemp(path.join(tmpdir(), 'vs-modeljetty-'))
  await build({ stdin: { contents: `
    export * from './functions/_shared.ts'
    export * from './functions/_lib/modeljetty-auth.ts'
    export {assertManagedImageModelAvailable} from './functions/_lib/model-provider.ts'
    export * from './functions/_lib/user-api-keys.ts'
    export * from './functions/_lib/auth.ts'
    export * from './functions/_lib/v2-store.ts'
    export * from './functions/_lib/v2-runner.ts'
    export { analyzeCanvasPsdOcr } from './functions/api/canvas/psd-ocr.ts'
    export { onRequestPost as canvasAgent, executeCanvasAgentPlan } from './functions/api/canvas/agent.ts'
    export { buildGenerateExecutionContext } from './functions/api/generate.ts'
    export { executeDirectGenerateTaskStep, normalizeDirectGenerateRequest } from './functions/api/generate-direct.ts'
    export { sealJson, unsealJson } from './packages/core/crypto.ts'
  `, resolveDir: process.cwd(), loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile: path.join(directory, 'module.mjs'), logLevel: 'silent' })
  const mod = await import(pathToFileURL(path.join(directory, 'module.mjs')).href)
  return { mod, cleanup: () => rm(directory, { recursive: true, force: true }) }
}
const environment = () => ({ CREDENTIAL_KEK: 'test-credential-encryption-secret', MODELJETTY_CLIENT_ID: 'visual-studio', MODELJETTY_REDIRECT_URI: 'http://localhost/api/auth/modeljetty/callback' })
const flowRequest = (suffix, cookie = '') => new Request(`http://localhost/api/auth/modeljetty/${suffix}`, { headers: { Cookie: cookie } })

async function signing() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'fixture', use: 'sig' }
  return { jwk, async token(nonce, overrides = {}) {
    const now = Math.floor(Date.now() / 1000)
    const content = `${b64({ alg: 'RS256', kid: 'fixture' })}.${b64({ iss: 'https://modeljetty.com/oidc', sub: 'newapi:42', aud: 'visual-studio', iat: now, exp: now + 600, nonce, ...overrides })}`
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(content))
    return `${content}.${Buffer.from(signature).toString('base64url')}`
  } }
}

async function begin(mod, env, cookies = '') {
  const start = await mod.startModeljettyLogin(env, flowRequest('start?returnTo=%2Flovart%2Fprojects', cookies))
  const url = new URL(start.headers.get('Location'))
  const cookie = start.headers.get('Set-Cookie').split(';')[0]
  return { url, cookie: [cookies, cookie].filter(Boolean).join('; '), callback: `callback?code=fixture-code&state=${url.searchParams.get('state')}&iss=${encodeURIComponent('https://modeljetty.com/oidc')}` }
}

async function withFetch(fn) {
  const original = globalThis.fetch
  try { await fn() } finally { globalThis.fetch = original }
}

test('provider selection isolates keys, base URLs and text models', async () => {
  const { mod, cleanup } = await harness()
  try {
    const env = { VISION_API_KEY: '1xm-vision', GPT_IMAGE_API_KEY: '1xm-image', MODELJETTY_API_KEY: 'jetty-key' }
    assert.deepEqual(mod.resolveKeys('gpt-image-2', env, { provider: 'modeljetty', gptImageApiKey: 'wrong-provider' }), { visionKey: 'jetty-key', genKey: 'jetty-key' })
    assert.equal(mod.resolveRelayBaseUrl(env, { provider: 'modeljetty' }), 'https://modeljetty.com/v1')
    assert.equal(mod.resolveRelayBaseUrl(env, { provider: 'modeljetty', modeljettyManaged: 'true' }), 'https://modeljetty.com/account/inference/v1')
    assert.equal(mod.resolveVisionModel(env, { provider: 'modeljetty' }), 'gemini-3.8-flash-medium')
    assert.equal(mod.resolveVisionModel({ MODELJETTY_VISION_MODEL: 'configured-vision' }, { provider: 'modeljetty' }), 'configured-vision')
    assert.equal(mod.resolveAgentModel(env, { provider: 'modeljetty' }), 'gemini-3.8-flash-medium')
    assert.equal(mod.resolveAgentModel({ MODELJETTY_AGENT_MODEL: 'gemini-3.8-flash-high' }, { provider: 'modeljetty' }), 'gemini-3.8-flash-high')
    assert.equal(mod.resolveAgentModel({ MODELJETTY_AGENT_MODEL: 'jetty-only' }, { provider: '1xm' }), 'gemini-3-flash-preview')
    const context = mod.buildGenerateExecutionContext({ modelId: 'gpt-image-2.5-flare', userMessage: 'plan a product image', clientKeys: { provider: 'modeljetty', modeljettyApiKey: 'jetty-key' } }, { MODELJETTY_IMAGE_TASKS_ENABLED: 'true' })
    assert.equal(context.agentConfig.model, 'gemini-3.8-flash-medium')
    assert.equal(context.imageModelOptions.modelName, 'gpt-image-2.5-flare')
    assert.deepEqual(mod.resolveKeys('gpt-image-2', {}, { provider: 'modeljetty', gptImageApiKey: 'wrong-provider' }), { visionKey: '', genKey: '' })
    assert.throws(() => mod.resolveRelayBaseUrl({}, { provider: 'untrusted' }), /Unknown model provider/)
    assert.equal(mod.sanitizeClientKeys({ provider: 'modeljetty', modeljettyManaged: 'true', modeljettyApiKey: ' key ' }).modeljettyManaged, undefined)
  } finally { await cleanup() }
})

test('ModelJetty image requests fail closed until async capability and model mapping are configured', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  let calls = 0
  globalThis.fetch = async () => { calls++; return response({ status: 'succeeded', data: [{ b64_json: 'aW1hZ2U=' }] }) }
  try {
    assert.throws(() => mod.resolveImageModelOptions('nano-banana-2', {}, { provider: 'modeljetty' }), /暂未开放/)
    const options = { provider: 'modeljetty' }
    const blocked = await mod.callImageModelTaskStep('https://modeljetty.com/v1', 'key', 'unused', [], 'prompt', options)
    assert.equal(blocked.status, 503)
    assert.equal(calls, 0)
    let payload
    globalThis.fetch = async (_url, init) => { calls++; payload = JSON.parse(init.body); return response({ id: 'image-1', status: 'queued' }) }
    const configured = mod.resolveImageModelOptions('nano-banana-2', { MODELJETTY_IMAGE_TASKS_ENABLED: 'true', MODELJETTY_IMAGE_MODEL_MAP: '{"nano-banana-2":"gemini-3.1-flash-image"}' }, { provider: 'modeljetty' })
    const pending = await mod.callImageModelTaskStep('https://modeljetty.com/v1', 'key', 'unused', [], 'prompt', { ...configured, returnAfterCreate: true, maxPollAttempts: 1 })
    assert.equal(pending.pending, true)
    assert.equal(payload.model, 'gemini-3.1-flash-image')
    assert.equal(calls, 1)
    globalThis.fetch = async (_url, init) => { assert.equal(init.method, 'GET'); return response({ status: 'succeeded', data: [{ b64_json: 'aW1hZ2U=' }] }) }
    const final = await mod.callImageModelTaskStep('https://modeljetty.com/v1', 'key', 'unused', [], 'prompt', { ...configured, existingTask: pending.task, skipInitialPollDelay: true })
    assert.equal(final.ok, true)
  } finally { await cleanup() }
}))

test('paid submission network failures are not replayed by either HTTP retry or job retry', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  let calls = 0
  const env = { VS_JOBS_QUEUE: { send: async () => {} } }
  globalThis.fetch = async () => { calls++; throw new Error('connection reset') }
  try {
    const submitted = await mod.submitGenerateDirectJob(env, { prompt: 'test', modelId: 'gpt-image-2', clientKeys: { gptImageApiKey: 'key' } })
    await mod.runQueuedJob(env, submitted.jobId)
    assert.equal(calls, 1)
    const [item] = await mod.listJobItems(env, submitted.jobId)
    assert.match(item.errorMessage, /UNKNOWN_SUBMIT_RESULT/)
    await assert.rejects(mod.retryJob(env, submitted.jobId), /提交结果未知/)
    assert.equal(calls, 1)
  } finally { await cleanup() }
}))

test('poll URLs cannot exfiltrate bearer tokens to another origin or endpoint', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('must not fetch') }
  try {
    for (const poll_url of ['https://attacker.example/v1/images/tasks/1', 'https://modeljetty.com/api/delete', 'https://name:password@modeljetty.com/v1/images/tasks/1', '//attacker.example/v1/images/tasks/1']) {
      const result = await mod.callImageModelTaskStep('https://modeljetty.com/v1', 'secret', 'model', [], 'prompt', { existingTask: { id: '1', status: 'running', poll_url }, skipInitialPollDelay: true })
      assert.equal(result.ok, false)
      assert.match(result.error, /Unsafe/)
    }
    assert.equal(calls, 0)
  } finally { await cleanup() }
}))

test('authenticated provider requests use Workers-compatible manual redirects without following them', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  const requests = []
  globalThis.fetch = async (url, init) => {
    assert.equal(init.redirect, 'manual', 'Workers rejects redirect:error; credentials must never follow redirects')
    requests.push(String(url))
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/collect' } })
  }
  try {
    const created = await mod.callImageModelTaskStep('https://modeljetty.com/v1', 'secret', 'model', [], 'prompt')
    assert.equal(created.ok, false)
    const polled = await mod.callImageModelTaskStep('https://modeljetty.com/v1', 'secret', 'model', [], 'prompt', {
      existingTask: { id: 'task', status: 'running' }, skipInitialPollDelay: true,
    })
    assert.equal(polled.ok, false)
    await assert.rejects(mod.callTextModel('https://modeljetty.com/v1', 'secret', 'text-model', []), /302/)
    assert.equal(requests.length, 3)
    assert.ok(requests.every(url => url.startsWith('https://modeljetty.com/')))
  } finally { await cleanup() }
}))

test('a durable unknown provider task stops polling and cannot become a replayable failed job', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  let calls = 0
  globalThis.fetch = async () => { calls++; return response({ id: 'unknown-task', status: 'unknown', retryable: false }) }
  try {
    const result = await mod.callImageModelTaskStep('https://modeljetty.com/v1', 'secret', 'model', [], 'prompt', { returnAfterCreate: true, maxPollAttempts: 1 })
    assert.equal(result.status, 409)
    assert.match(result.error, /UNKNOWN_SUBMIT_RESULT/)
    assert.equal(calls, 1)
  } finally { await cleanup() }
}))

test('reauthorization restores an old managed receipt and only polls the original task', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  const env = { CREDENTIAL_KEK: 'fixture', VS_JOBS_QUEUE: { send: async () => {} }, MODELJETTY_IMAGE_TASKS_ENABLED: 'true' }
  const methods = []
  try {
    const user = await mod.createUser(env, { email: 'receipt@example.test', passwordHash: '', passwordSalt: '' })
    await mod.saveExternalIdentity(env, { issuer: 'https://modeljetty.com/oidc', subject: 'newapi:test', userId: user.id,
      ciphertext: await mod.sealJson({ accessToken: 'reconnected-owner', refreshToken: 'refresh', expiresAt: Date.now() + 600000 }, env.CREDENTIAL_KEK), expiresAt: Date.now() + 600000 })
    const { jobId } = await mod.submitGenerateDirectJob(env, { _authUserId: user.id, modelId: 'gpt-image-2.5-sunburst', prompt: 'test', clientKeys: { provider: 'modeljetty', modeljettyManaged: 'true' } })
    const job = await mod.getJob(env, jobId), [item] = await mod.listJobItems(env, jobId)
    await mod.deleteSealedCredential(env, job.configJson.sealedCredentialId)
    await mod.updateJobItem(env, jobId, item.id, { status: 'failed', outputJson: { imageTask: { id: 'original-task', status: 'running', poll_url: 'https://modeljetty.com/account/inference/v1/images/tasks/original-task' } } })
    await mod.updateJob(env, jobId, { status: 'failed' })
    globalThis.fetch = async (url, init) => {
      methods.push(init.method)
      assert.equal(init.headers.Authorization, 'Bearer reconnected-owner')
      assert.ok(new URL(url).pathname.endsWith('/original-task'))
      assert.equal(new URL(url).searchParams.get('result_format'), 'url')
      return response({ id: 'original-task', status: 'succeeded', data: [{ b64_json: 'aW1hZ2U=' }] })
    }
    await mod.retryJob(env, jobId)
    await mod.runQueuedJob(env, jobId)
    assert.deepEqual(methods, ['GET'])
    assert.equal((await mod.getJob(env, jobId)).status, 'completed')
  } finally { await cleanup() }
}))

test('JPEG model output keeps its MIME and dimensions when returned in b64_json', async () => {
  const { mod, cleanup } = await harness()
  try {
    // JPEG SOI + an APP segment + baseline SOF for a 1024x768 image.
    const bytes = Buffer.from([255,216,255,224,0,4,0,0,255,192,0,11,8,3,0,4,0,1,1,17,0,255,217])
    const base64 = bytes.toString('base64')
    assert.equal(mod.extractImageFromResponse({ data: [{ b64_json: base64 }] }), `data:image/jpeg;base64,${base64}`)
    assert.deepEqual(mod.readImageDimensions(base64), { width: 1024, height: 768 })
    assert.equal(mod.readImageDimensions(Buffer.from([255,216,255,224,0,1]).toString('base64')), null)
  } finally { await cleanup() }
})

test('OIDC start uses PKCE S256, nonce, server-side single-use state and safe return URLs', async () => {
  const { mod, cleanup } = await harness()
  try {
    const env = environment()
    const { url, cookie } = await begin(mod, env)
    assert.equal(url.origin, 'https://modeljetty.com')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.get('scope'), 'openid offline_access models:invoke')
    assert.equal(url.searchParams.get('prompt'), 'consent')
    assert.ok(url.searchParams.get('nonce'))
    assert.match(cookie, /^vs_modeljetty_flow=/)
    assert.equal(url.searchParams.has('code_verifier'), false)
    for (const input of ['//evil.example', '/\\evil', '/api/auth/logout', 'https://evil.example']) assert.equal(mod.safeReturnTo(input), '/lovart')
    await assert.rejects(mod.startModeljettyLogin({}, flowRequest('start')), /尚未配置/)
    await assert.rejects(mod.finishModeljettyLogin(env, flowRequest('callback?code=x&state=wrong', cookie)), /state mismatch/)
  } finally { await cleanup() }
})

test('OIDC callback verifies signature and subject, creates a separate local identity and never returns credentials', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  const signer = await signing()
  const env = { ...environment(), CREDENTIAL_KEK: undefined, VS_JOB_CREDENTIAL_KEK: 'shared-flow-and-token-key' }
  try {
    const existing = await mod.createUser(env, { email: 'same@example.com', name: 'Existing', passwordHash: 'hash', passwordSalt: 'salt' })
    const flow = await begin(mod, env)
    let calls = 0
    globalThis.fetch = async (url, init = {}) => {
      assert.equal(init.redirect, 'manual')
      calls++
      if (url.endsWith('/token')) {
        const body = new URLSearchParams(init.body)
        assert.equal(body.get('grant_type'), 'authorization_code')
        const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier')))).toString('base64url')
        assert.equal(challenge, flow.url.searchParams.get('code_challenge'))
        return response({ access_token: 'server-only-access', refresh_token: 'server-only-refresh', token_type: 'Bearer', expires_in: 600, id_token: await signer.token(flow.url.searchParams.get('nonce')) })
      }
      if (url.endsWith('/jwks')) return response({ keys: [signer.jwk] })
      if (url.endsWith('/account/me')) return response({ user: { id: 'newapi:42', email: existing.email, name: 'Jetty User' } })
      if (url.endsWith('/account/allowance')) return response({ available: 12.5, currency: 'CNY' })
      throw new Error(`Unexpected ${url}`)
    }
    const result = await mod.finishModeljettyLogin(env, flowRequest(flow.callback, flow.cookie))
    assert.equal(result.status, 303)
    assert.equal(result.headers.get('Location'), '/lovart/projects')
    assert.doesNotMatch([...result.headers].flat().join(' '), /server-only-/)
    const identity = await mod.getExternalIdentity(env, 'https://modeljetty.com/oidc', { subject: 'newapi:42' })
    assert.notEqual(identity.userId, existing.id, 'Email similarity cannot link accounts')
    assert.doesNotMatch(identity.ciphertext, /server-only-/)
    const cookie = result.headers.get('Set-Cookie').match(/vs_auth=([^;]+)/)[0]
    const payload = await mod.getAuthPayload(env, new Request('http://localhost/api/auth/me', { headers: { Cookie: cookie } }))
    assert.equal(payload.modeljetty.connected, true)
    assert.equal(payload.modeljetty.loginEnabled, true, 'The shared Queue key supports login without rotating account encryption')
    assert.doesNotMatch(JSON.stringify(payload), /server-only-/)
    const keys = await mod.mergeUserClientKeys(env, identity.userId, {})
    assert.equal(keys.modeljettyApiKey, 'server-only-access')
    assert.equal(keys.modeljettyManaged, 'true')
    const connection = await mod.getModeljettyConnection(env, identity.userId)
    assert.equal(connection.balance, 12.5)
    assert.equal(connection.currency, 'CNY')
    const beforeReplay = calls
    await assert.rejects(mod.finishModeljettyLogin(env, flowRequest(flow.callback, flow.cookie)), /已过期或已使用/)
    assert.equal(calls, beforeReplay)
  } finally { await cleanup() }
}))

test('ID token validation rejects wrong issuer, audience, expiry, nonce and tampered signature', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  const signer = await signing()
  globalThis.fetch = async () => response({ keys: [signer.jwk] })
  try {
    for (const overrides of [{ iss: 'https://evil.example' }, { aud: 'other-client' }, { exp: 0 }, { nonce: 'wrong' }, { sub: '' }, { azp: 'other-client' }, { at_hash: 'wrong' }]) {
      await assert.rejects(mod.verifyModeljettyIdToken(environment(), await signer.token('nonce', overrides), 'nonce', 'access'), /Invalid|mismatch/)
    }
    const signed = await signer.token('nonce')
    const parts = signed.split('.')
    parts[1] = b64({ sub: 'attacker' })
    await assert.rejects(mod.verifyModeljettyIdToken(environment(), parts.join('.'), 'nonce', 'access'), /Invalid/)
  } finally { await cleanup() }
}))

test('refresh rotation is single-flight and unknown outcomes require reauthorization', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  const env = environment()
  try {
    const user = await mod.createUser(env, { email: 'rotate@example.com', passwordHash: '', passwordSalt: '' })
    const old = { accessToken: 'expired', refreshToken: 'old-refresh', expiresAt: 1 }
    await mod.saveExternalIdentity(env, { issuer: 'https://modeljetty.com/oidc', subject: 'newapi:99', userId: user.id, ciphertext: await mod.sealJson(old, env.CREDENTIAL_KEK), expiresAt: 1 })
    let calls = 0, release
    const barrier = new Promise(resolve => { release = resolve })
    globalThis.fetch = async () => { calls++; await barrier; return response({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 600 }) }
    const first = mod.loadModeljettyTokens(env, user.id)
    // Give the first request time to claim its durable refresh lock.
    await new Promise(resolve => setTimeout(resolve, 25))
    const second = mod.loadModeljettyTokens(env, user.id)
    const rejected = assert.rejects(second, /正在刷新/)
    release()
    const next = await first
    await rejected
    assert.equal(calls, 1)
    assert.equal(next.accessToken, 'new-access')
    await mod.saveExternalIdentity(env, { issuer: 'https://modeljetty.com/oidc', subject: 'newapi:99', userId: user.id, ciphertext: await mod.sealJson(old, env.CREDENTIAL_KEK), expiresAt: 1 })
    globalThis.fetch = async () => { calls++; throw new Error('unknown token exchange outcome') }
    await assert.rejects(mod.loadModeljettyTokens(env, user.id), /unknown token/)
    await assert.rejects(mod.loadModeljettyTokens(env, user.id), /重新授权/)
    assert.equal(calls, 2, 'Consumed refresh tokens are never replayed')
  } finally { await cleanup() }
}))

test('queue messages omit secrets and managed tokens are refreshed from the linked account', async () => {
  const { mod, cleanup } = await harness()
  const sent = []
  const env = { ...environment(), VS_JOBS_QUEUE: { send: async message => sent.push(message) } }
  try {
    const user = await mod.createUser(env, { email: 'queue@example.com', passwordHash: '', passwordSalt: '' })
    const tokens = { accessToken: 'managed-secret', refreshToken: 'refresh-secret', expiresAt: Date.now() + 600_000 }
    await mod.saveExternalIdentity(env, { issuer: 'https://modeljetty.com/oidc', subject: 'newapi:100', userId: user.id, ciphertext: await mod.sealJson(tokens, env.CREDENTIAL_KEK), expiresAt: tokens.expiresAt })
    const keys = await mod.mergeUserClientKeys(env, user.id, {})
    const submitted = await mod.submitGenerateDirectJob(env, { _authUserId: user.id, prompt: 'queued prompt', clientKeys: keys })
    assert.doesNotMatch(JSON.stringify(sent), /managed-secret|refresh-secret|modeljettyApiKey/)
    const job = await mod.getJob(env, submitted.jobId)
    const sealed = await mod.getSealedCredential(env, job.configJson.sealedCredentialId)
    const stored = await mod.unsealJson(sealed.ciphertext, env.CREDENTIAL_KEK)
    assert.equal(stored.provider, 'modeljetty')
    assert.equal(stored.modeljettyManaged, 'true')
    assert.equal(stored.modeljettyApiKey, undefined)
    assert.doesNotMatch(JSON.stringify(job), /managed-secret|refresh-secret/)
  } finally { await cleanup() }
})

test('PSD vision and direct image planning both route through ModelJetty with its own model and credentials', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  const calls = []
  const env = { VISION_API_KEY: 'must-not-use-1xm', MODELJETTY_IMAGE_TASKS_ENABLED: 'true', MODELJETTY_IMAGE_MODEL_MAP: '{"gpt-image-2":"gpt-image-2.5-flare"}' }
  const keys = { provider: 'modeljetty', modeljettyApiKey: 'own-jetty-key' }
  globalThis.fetch = async (url, init) => {
    calls.push({ url, payload: JSON.parse(init.body), authorization: init.headers.Authorization })
    if (url.endsWith('/chat/completions')) return response({ choices: [{ message: { content: calls.length === 1 ? '{"texts":[]}' : 'refined image prompt' } }] })
    return response({ id: 'jetty-task', status: 'queued' })
  }
  try {
    await mod.analyzeCanvasPsdOcr(env, { dataUrl: 'data:image/png;base64,aW1hZ2U=', width: 512, height: 512, clientKeys: keys })
    const request = mod.normalizeDirectGenerateRequest({ modelId: 'gpt-image-2', prompt: 'a product', useDesignAgent: true, aspectRatio: '1:1', resolution: '1k' })
    const result = await mod.executeDirectGenerateTaskStep(env, request, keys, { returnAfterCreate: true, maxPollAttempts: 1 })
    assert.equal(result.pending, true)
    assert.equal(calls.length, 3)
    assert.ok(calls.every(call => call.url.startsWith('https://modeljetty.com/v1/') && call.authorization === 'Bearer own-jetty-key'))
    assert.equal(calls[0].payload.model, 'gemini-3.8-flash-medium')
    assert.equal(calls[1].payload.model, 'gemini-3.8-flash-medium')
    assert.equal(calls[2].payload.model, 'gpt-image-2.5-flare')
    assert.equal(calls[2].payload.size, '1024x1024', 'Logical model sizing survives provider aliases')
  } finally { await cleanup() }
}))

test('managed Canvas Agent uses the configured LLM and a traceable request ID while the image model stays separate', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  const env = { CREDENTIAL_KEK: 'fixture', VISION_API_KEY: 'never-use-1xm' }
  const calls = []
  try {
    const user = await mod.createUser(env, { email: 'agent@example.test', passwordHash: '', passwordSalt: '' })
    const cookie = (await mod.createLoginResponse(env, user, new Request('https://example.com'))).setCookie.split(';')[0]
    const tokens = { accessToken: 'managed-owner-token', refreshToken: 'refresh', expiresAt: Date.now() + 600000 }
    await mod.saveExternalIdentity(env, { issuer: 'https://modeljetty.com/oidc', subject: 'newapi:agent', userId: user.id, ciphertext: await mod.sealJson(tokens, env.CREDENTIAL_KEK), expiresAt: tokens.expiresAt })
    const request = (overrides = {}) => new Request('https://example.com/api/canvas/agent', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId: 'gpt-image-2.5-flare', message: '先分析蓝色茶壶，不要生图。', clientKeys: { provider: 'modeljetty' }, ...overrides }) })
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) })
      return response({ choices: [{ message: { content: JSON.stringify({ reply: '采用暖灰背景，突出蓝釉色彩。', shouldGenerate: false, mode: 'analyze', actions: [] }) } }] })
    }
    let result = await mod.canvasAgent({ env, request: request() })
    const data = await result.json()
    assert.equal(result.status, 200)
    assert.equal(data.agentModel, 'gemini-3.8-flash-medium')
    assert.equal(data.usedModel, true)
    assert.equal(data.agentPassthrough, false)
    assert.equal(data.shouldGenerate, false)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://modeljetty.com/account/inference/v1/chat/completions')
    assert.equal(calls[0].init.headers.Authorization, 'Bearer managed-owner-token')
    assert.equal(calls[0].body.model, data.agentModel)
    assert.equal(calls[0].init.headers['X-Request-Id'], data.agentRequestId)
    assert.match(data.agentRequestId, /^[A-Za-z0-9_-]{16,100}$/)
    assert.equal(calls[0].init.redirect, 'manual')
    globalThis.fetch = async () => response({ choices: [{ message: { content: '' } }] })
    result = await mod.canvasAgent({ env, request: request() })
    assert.equal(result.status, 502, 'An empty provider response must not masquerade as a model-driven plan')
    globalThis.fetch = async () => new Response('{"error":"model_permission_denied"}', { status: 403 })
    result = await mod.canvasAgent({ env, request: request() })
    assert.equal(result.status, 403)
    assert.equal((await result.json()).usedModel, undefined)
    const session = await mod.ensureSession(env, undefined, user.id)
    const asset = await mod.createAsset(env, { sessionId: session.id, userId: user.id, kind: 'upload', dataUrl: 'data:image/png;base64,aW1hZ2U=' })
    for (const modelId of ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']) {
      const planningCalls = []
      globalThis.fetch = async (url, init) => {
        planningCalls.push({ url, body: JSON.parse(init.body) })
        return response({ choices: [{ message: { content: JSON.stringify({ reply: '沿用参考主体生成新构图', shouldGenerate: true, mode: 'generate', actions: [{ type: 'generate_image', prompt: 'Preserve the referenced teapot in a new composition' }] }) } }] })
      }
      result = await mod.canvasAgent({ env, request: request({ modelId, message: '保持茶壶主体生成一张新构图', skillId: 'reference-edit', referenceStrategy: 'combined', referenceImages: [{ assetId: asset.id }], executionPolicy: { mode: 'auto' } }) })
      const planned = await result.json()
      assert.equal(result.status, 200)
      assert.equal(planned.shouldGenerate, true)
      assert.equal(planningCalls.length, 1)
      assert.match(JSON.stringify(planningCalls[0].body), /data:image\/png;base64,aW1hZ2U=/)
      let taskPayload
      globalThis.fetch = async (_url, init) => { taskPayload = JSON.parse(init.body); return response({ id: 'reference-edit-task', status: 'queued' }) }
      const imageRequest = mod.normalizeDirectGenerateRequest({ _authUserId: user.id, modelId, prompt: planned.actions[0].prompt, referenceImages: [{ assetId: asset.id }], useDesignAgent: false })
      const imageResult = await mod.executeDirectGenerateTaskStep({ ...env, MODELJETTY_IMAGE_TASKS_ENABLED: 'true' }, imageRequest, { provider: 'modeljetty', modeljettyApiKey: 'fixture-key' }, { returnAfterCreate: true, maxPollAttempts: 1 })
      assert.equal(imageResult.pending, true)
      assert.equal(taskPayload.model, modelId)
      assert.deepEqual(taskPayload.image, ['data:image/png;base64,aW1hZ2U='])
    }
    let referenceCalls = 0
    globalThis.fetch = async () => { referenceCalls++; return new Response(new ReadableStream({ start() {} })) }
    result = await mod.canvasAgent({ env: { ...env, VS_TEXT_REQUEST_TIMEOUT_MS: '1000' }, request: request({ referenceImages: [{ assetId: asset.id }] }) })
    assert.equal(result.status, 504)
    assert.equal(referenceCalls, 1, 'Do not start another paid planning request after a reference analysis timeout')
    assert.match((await result.json()).referenceRequestId, /^[A-Za-z0-9_-]{16,100}$/)
  } finally { await cleanup() }
}))

test('text model POSTs keep an explicit request identity and are never automatically replayed', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    calls++
    assert.equal(init.headers['X-Request-Id'], 'stable-agent-request-1234')
    throw new Error('connection reset after dispatch')
  }
  try {
    assert.equal(await mod.callTextModel('https://modeljetty.com/v1', 'key', 'gemini-3.8-flash-medium', [], { requestId: 'stable-agent-request-1234' }), null)
    assert.equal(calls, 1)
  } finally { await cleanup() }
}))

test('external identity binding cannot be reassigned to another local user', async () => {
  const { mod, cleanup } = await harness()
  const env = environment()
  try {
    const first = await mod.createUser(env, { email: 'first@example.com', passwordHash: '', passwordSalt: '' })
    const second = await mod.createUser(env, { email: 'second@example.com', passwordHash: '', passwordSalt: '' })
    const record = { issuer: 'https://modeljetty.com/oidc', subject: 'newapi:55', userId: first.id, ciphertext: 'sealed-fixture', expiresAt: 1 }
    await mod.saveExternalIdentity(env, record)
    await assert.rejects(mod.saveExternalIdentity(env, { ...record, userId: second.id }), /already linked/)
    assert.equal((await mod.getExternalIdentity(env, record.issuer, { subject: record.subject })).userId, first.id)
    await assert.rejects(mod.saveExternalIdentity(env, { ...record, subject: 'newapi:56' }), /already linked/)
  } finally { await cleanup() }
})

test('local registration cannot squat on the reserved external identity namespace', async () => {
  const { mod, cleanup } = await harness()
  try { await assert.rejects(mod.registerUser({}, { email: 'guessed-subject-hash@modeljetty.invalid', password: 'fixture-password' }), /保留/) }
  finally { await cleanup() }
})

test('OIDC linking rejects an account switch before exchanging the code', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  const env = environment()
  globalThis.fetch = async () => { throw new Error('code must not be exchanged') }
  try {
    const first = await mod.createUser(env, { email: 'link-first@example.com', passwordHash: '', passwordSalt: '' })
    const second = await mod.createUser(env, { email: 'link-second@example.com', passwordHash: '', passwordSalt: '' })
    const firstLogin = await mod.createLoginResponse(env, first, flowRequest('start'))
    const secondLogin = await mod.createLoginResponse(env, second, flowRequest('start'))
    const flow = await begin(mod, env, firstLogin.setCookie.split(';')[0])
    const flowCookie = flow.cookie.split('; ').find(cookie => cookie.startsWith('vs_modeljetty_flow='))
    await assert.rejects(mod.finishModeljettyLogin(env, flowRequest(flow.callback, `${secondLogin.setCookie.split(';')[0]}; ${flowCookie}`)), /账号发生变化/)
  } finally { await cleanup() }
}))

test('managed queue jobs retain credentials and retry later while another job refreshes the account', async () => {
  const { mod, cleanup } = await harness()
  const env = { ...environment(), VS_JOBS_QUEUE: { send: async () => {} } }
  try {
    const user = await mod.createUser(env, { email: 'refresh-busy@example.com', passwordHash: '', passwordSalt: '' })
    const expired = { accessToken: 'expired', refreshToken: 'one-use-refresh', expiresAt: 1 }
    const record = await mod.saveExternalIdentity(env, { issuer: 'https://modeljetty.com/oidc', subject: 'newapi:101', userId: user.id, ciphertext: await mod.sealJson(expired, env.CREDENTIAL_KEK), expiresAt: 1 })
    assert.equal(await mod.claimIdentityRefresh(env, record), true)
    const job = await mod.submitGenerateDirectJob(env, { _authUserId: user.id, prompt: 'test', clientKeys: { provider: 'modeljetty', modeljettyManaged: 'true' } })
    const result = await mod.runQueuedJob(env, job.jobId)
    assert.equal(result.retryAfterMs, 5000)
    assert.equal((await mod.getJob(env, job.jobId)).status, 'queued')
    const [item] = await mod.listJobItems(env, job.jobId)
    assert.equal(item.status, 'queued')
    const stored = await mod.getJob(env, job.jobId)
    assert.ok(await mod.getSealedCredential(env, stored.configJson.sealedCredentialId))
  } finally { await cleanup() }
})

test('ModelJetty task metadata uses short result URLs, validates origin and stores measured transfer time', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')
  const calls = []
  const options = { ...mod.resolveImageModelOptions('nano-banana-2', { MODELJETTY_IMAGE_TASKS_ENABLED:'true', MODELJETTY_IMAGE_MODEL_MAP:'{"nano-banana-2":"gemini-3.1-flash-image"}' }, { provider:'modeljetty' }), existingTask:{id:'task-1',status:'running'}, skipInitialPollDelay:true }
  globalThis.fetch = async (url, init) => {
    calls.push({url:String(url),init})
    if (String(url).includes('/result?')) return new Response(png, {headers:{'content-type':'image/png'}})
    assert.equal(new URL(url).searchParams.get('result_format'), 'url')
    return response({id:'task-1',status:'succeeded',data:[{url:'https://modeljetty.com/account/inference/v1/images/tasks/task-1/result?ticket=fixture'}]})
  }
  try {
    const result = await mod.callImageModelTaskStep('https://modeljetty.com/account/inference/v1','bearer','unused',[],'prompt',options)
    assert.equal(result.ok,true)
    assert.equal(calls.length,2)
    assert.equal(calls[1].init.redirect,'manual')
    assert.equal(calls[1].init.headers,undefined)
    assert.ok(result.timings.resultTransferMs >= 0)
    assert.ok(result.dataUrl.startsWith('data:image/png;base64,'))
    globalThis.fetch = async () => response({id:'task-1',status:'succeeded',data:[{url:'https://other.invalid/result?ticket=wrong'}]})
    const rejected = await mod.callImageModelTaskStep('https://modeljetty.com/account/inference/v1','bearer','unused',[],'prompt',options)
    assert.equal(rejected.ok,false)
    assert.match(rejected.error,/非预期/)
  } finally { await cleanup() }
}))

test('disconnect revokes only the current client and retains identity ownership for reconnect', async () => withFetch(async () => {
  const { mod, cleanup } = await harness()
  const env=environment()
  const user=await mod.createUser(env,{email:'disconnect@example.invalid',passwordHash:'',passwordSalt:''})
  const ciphertext=await mod.sealJson({accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:Date.now()+600000},env.CREDENTIAL_KEK)
  await mod.saveExternalIdentity(env,{issuer:'https://modeljetty.com/oidc',subject:'disconnect-sub',userId:user.id,ciphertext,expiresAt:Date.now()+600000})
  let calls=0
  globalThis.fetch=async(url,init)=>{ calls++;assert.equal(url,'https://modeljetty.com/account/authorization');assert.equal(init.method,'DELETE');assert.equal(init.headers.Authorization,'Bearer fixture-access');return response({revoked:true,scope:'current_client',client_id:'visual-studio'}) }
  try {
    assert.equal((await mod.disconnectModeljetty(env,user.id)).revoked,true)
    assert.equal(await mod.loadModeljettyTokens(env,user.id),null)
    assert.equal((await mod.getExternalIdentity(env,'https://modeljetty.com/oidc',{subject:'disconnect-sub'})).userId,user.id)
    assert.equal((await mod.disconnectModeljetty(env,user.id)).revoked,true)
    assert.equal(calls,1)
  } finally { await cleanup() }
}))

test('queued Agent planning preserves the trusted account-inference authentication route', async () => withFetch(async () => {
  const { mod,cleanup }=await harness()
  const env=environment()
  const user=await mod.createUser(env,{email:'queued-planning@example.test',passwordHash:'',passwordSalt:''})
  const calls=[]
  globalThis.fetch=async(url,init)=>{calls.push(String(url));assert.equal(init.headers.Authorization,'Bearer fixture-managed-access');return response({choices:[{message:{content:JSON.stringify({reply:'两图已规划',shouldGenerate:true,actions:[{type:'generate_image',prompt:'make product image'}]})}}]})}
  try {
    const result=await mod.executeCanvasAgentPlan(env,{runId:'trusted-queue-plan',message:'立即生成一张明确的商品图',modelId:'gpt-image-2.5-sunburst',executionPolicy:{mode:'auto'}},user.id,{provider:'modeljetty',modeljettyManaged:'true',modeljettyApiKey:'fixture-managed-access',modeljettyAgentModel:'gemini-3.8-flash-low'})
    assert.equal(result.status,200)
    assert.deepEqual(calls,['https://modeljetty.com/account/inference/v1/chat/completions'])
  } finally {await cleanup()}
}))

test('managed connection refresh migrates to the shared Queue key without rotating existing account encryption', async () => withFetch(async () => {
  const {mod,cleanup}=await harness()
  const env={...environment(),VS_JOB_CREDENTIAL_KEK:'existing-shared-queue-key'}
  const user=await mod.createUser(env,{email:'shared-managed-key@example.test',passwordHash:'',passwordSalt:''})
  await mod.saveUserClientKeys(env,user.id,{visionApiKey:'legacy-account-key-stays-readable'})
  const legacy=await mod.sealJson({accessToken:'expired',refreshToken:'original-refresh',expiresAt:Date.now()-1000},env.CREDENTIAL_KEK)
  await mod.saveExternalIdentity(env,{issuer:'https://modeljetty.com/oidc',subject:'shared-connection',userId:user.id,ciphertext:legacy,expiresAt:Date.now()-1000})
  let calls=0
  globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'https://modeljetty.com/oidc/token');assert.equal(new URLSearchParams(init.body).get('refresh_token'),'original-refresh');return response({access_token:'rotated-access',refresh_token:'rotated-refresh',expires_in:900,token_type:'Bearer',scope:'openid models:invoke offline_access'})}
  try {
    assert.equal((await mod.loadModeljettyTokens(env,user.id)).accessToken,'rotated-access')
    const queueEnv={MODELJETTY_CLIENT_ID:'visual-studio',VS_JOB_CREDENTIAL_KEK:env.VS_JOB_CREDENTIAL_KEK}
    assert.equal((await mod.loadModeljettyTokens(queueEnv,user.id)).accessToken,'rotated-access')
    assert.equal(calls,1)
    assert.equal((await mod.loadUserClientKeys(env,user.id)).visionApiKey,'legacy-account-key-stays-readable')
    await assert.rejects(mod.loadModeljettyTokens({...queueEnv,VS_JOB_CREDENTIAL_KEK:'wrong-key'},user.id),/密钥不匹配/)
  }finally{await cleanup()}
}))


test('unavailable managed image model is rejected by read-only catalog before paid planning', async () => withFetch(async () => {
  const {mod,cleanup}=await harness()
  const calls=[]
  globalThis.fetch=async(url,init)=>{calls.push({url,method:init.method || 'GET'});return response({models:[{id:'gpt-image-2.5-flare',available:false,unavailableReason:'paid_model_access_required'}]})}
  try {
    const keys={provider:'modeljetty',modeljettyManaged:'true',modeljettyApiKey:'fixture-account'}
    await assert.rejects(mod.assertManagedImageModelAvailable({},keys,'gpt-image-2.5-flare'),{status:403})
    assert.deepEqual(calls,[{url:'https://modeljetty.com/account/model-catalog',method:'GET'}])
    await mod.assertManagedImageModelAvailable({},{provider:'modeljetty',modeljettyApiKey:'manual-key'},'gpt-image-2.5-flare')
    assert.equal(calls.length,1)
  }finally{await cleanup()}
}))
