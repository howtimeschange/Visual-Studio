import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

test('per-provider Agent defaults persist as public preferences and drive the next planner request', async () => {
  globalThis.crypto ||= webcrypto
  const directory = await mkdtemp(`${tmpdir()}/agent-settings-`)
  const previousFetch = globalThis.fetch
  try {
    const outfile = `${directory}/entry.mjs`
    await build({ stdin: { contents: `export { resolveAgentModel } from './functions/_lib/model-provider.ts'; export { saveUserClientKeys, getUserApiKeyStatus, sanitizeClientKeys } from './functions/_lib/user-api-keys.ts'; export { createUser } from './functions/_lib/v2-store.ts'; export { createLoginResponse } from './functions/_lib/auth.ts'; export { onRequestPost } from './functions/api/canvas/agent.ts'`, resolveDir: process.cwd(), loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
    const api = await import(pathToFileURL(outfile))
    const env = {}
    const owner = await api.createUser(env, { email: 'agent-settings@example.com', passwordHash: '', passwordSalt: '' })
    await api.saveUserClientKeys(env, owner.id, { provider: 'modeljetty', modeljettyApiKey: 'fixture-private-key', modeljettyAgentModel: 'gemini-3.8-flash-low', oneXmAgentModel: 'gemini-3-flash-preview' })
    const status = await api.getUserApiKeyStatus(env, owner.id)
    assert.equal(status.preferences.modeljettyAgentModel, 'gemini-3.8-flash-low')
    assert.equal(status.keys.modeljettyAgentModel, undefined)
    assert.doesNotMatch(JSON.stringify(status), /fixture-private-key/)
    assert.equal(api.sanitizeClientKeys({ modeljettyAgentModel: 'invalid model name' }).modeljettyAgentModel, undefined)
    assert.equal(api.resolveAgentModel(env, { provider: '1xm', modeljettyAgentModel: 'jetty-only', oneXmAgentModel: 'one-xm-model' }), 'one-xm-model')
    const cookie = (await api.createLoginResponse(env, owner, new Request('https://example.com'))).setCookie.split(';')[0]
    const payloads = []
    globalThis.fetch = async (_url, init) => { payloads.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: '规划完成', shouldGenerate: false, mode: 'plan', actions: [] }) } }] })) }
    const response = await api.onRequestPost({ env, request: new Request('https://example.com/api/canvas/agent', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '只做方案', executionPolicy: { mode: 'plan' } }) }) })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).agentModel, 'gemini-3.8-flash-low')
    assert.equal(payloads[0].model, 'gemini-3.8-flash-low')
  } finally { globalThis.fetch = previousFetch; await rm(directory, { recursive: true, force: true }) }
})
