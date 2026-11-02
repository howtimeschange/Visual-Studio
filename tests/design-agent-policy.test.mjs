import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { webcrypto } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

test('server workflow gates missing references and independently enforces plan-only mode', async () => {
  globalThis.crypto ||= webcrypto
  const directory = await mkdtemp(path.join(os.tmpdir(), 'design-agent-policy-'))
  const previousFetch = globalThis.fetch
  try {
    const output = path.join(directory, 'entry.mjs')
    await build({ stdin: { contents: `export { onRequestPost } from './functions/api/canvas/agent.ts'; export { createUser } from './functions/_lib/v2-store.ts'; export { createLoginResponse } from './functions/_lib/auth.ts'; export { resolveDesignAgentSkill } from './functions/_lib/design-agent-skills.ts'`, resolveDir: process.cwd(), loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile: output, logLevel: 'silent' })
    const api = await import(pathToFileURL(output).href)
    const env = { VISION_API_KEY: 'fixture-key' }
    const owner = await api.createUser(env, { email: 'policy-owner@example.com', passwordHash: '', passwordSalt: '' })
    const cookie = (await api.createLoginResponse(env, owner, new Request('https://example.com'))).setCookie.split(';')[0]
    const request = body => new Request('https://example.com/api/canvas/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) })
    let calls = 0
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ shouldGenerate: true, reply: '已整理方案', mode: 'generate', actions: [{ type: 'generate_image', prompt: 'a real prompt', title: '第一张' }] }) } }] })) }
    const missing = await api.onRequestPost({ env, request: request({ message: '生成商品三图', skillId: 'reference-product' }) })
    assert.equal(missing.status, 200)
    const question = await missing.json()
    assert.equal(question.needsClarification, true)
    assert.equal(question.usedModel, false)
    assert.equal(calls, 0)
    const response = await api.onRequestPost({ env, request: request({ runId: 'run-policy-1234', message: '生成一张海报', executionPolicy: { mode: 'plan' }, skillId: 'brand-campaign' }) })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.shouldGenerate, false)
    assert.deepEqual(result.actions, [])
    assert.equal(result.prompt, '')
    assert.equal(result.agentRequestId, 'run-policy-1234-plan')
    assert.equal(result.skill.id, 'brand-campaign')
    assert.equal(calls, 1)
    assert.equal(api.resolveDesignAgentSkill('auto', '给我一张商品主图', 1).id, 'visual')
    assert.equal(api.resolveDesignAgentSkill('auto', '给我商品三图', 1).id, 'reference-product')
  } finally { globalThis.fetch = previousFetch; await rm(directory, { recursive: true, force: true }) }
})
