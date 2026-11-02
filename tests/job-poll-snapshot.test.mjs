import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

test('one owner-authorized poll returns the job and items; other users cannot read either', async () => {
  globalThis.crypto ||= webcrypto
  const directory = await mkdtemp(`${tmpdir()}/job-snapshot-`)
  try {
    const outfile = `${directory}/entry.mjs`
    await build({ stdin: { contents: `export { onRequestGet } from './functions/api/jobs/[jobId].ts'; export { createUser, ensureSession, createJob, createJobItems } from './functions/_lib/v2-store.ts'; export { createLoginResponse } from './functions/_lib/auth.ts'`, resolveDir: process.cwd(), loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
    const api = await import(pathToFileURL(outfile))
    const env = {}
    const owner = await api.createUser(env, { email: 'snapshot-owner@example.com', passwordHash: '', passwordSalt: '' })
    const other = await api.createUser(env, { email: 'snapshot-other@example.com', passwordHash: '', passwordSalt: '' })
    const cookie = async user => (await api.createLoginResponse(env, user, new Request('https://example.com'))).setCookie.split(';')[0]
    const session = await api.ensureSession(env, undefined, owner.id)
    const job = await api.createJob(env, { sessionId: session.id, userId: owner.id, type: 'generate_batch', status: 'queued', configJson: {}, summaryJson: {}, progressTotal: 1, progressDone: 0, progressFailed: 0 })
    await api.createJobItems(env, job.id, [{ jobId: job.id, itemType: 'generate_batch_item', status: 'queued', inputJson: {}, outputJson: { imageTaskStatus: 'running' }, attemptCount: 1 }])
    const get = async (user, query) => api.onRequestGet({ env, params: { jobId: job.id }, request: new Request(`https://example.com/api/jobs/${job.id}${query}`, { headers: { Cookie: await cookie(user) } }) })
    const result = await (await get(owner, '?includeItems=1')).json()
    assert.equal(result.job.id, job.id)
    assert.equal(result.items[0].outputJson.imageTaskStatus, 'running')
    assert.equal(Object.hasOwn(await (await get(owner, '')).json(), 'items'), false)
    const denied = await get(other, '?includeItems=1')
    assert.equal(denied.status, 403)
    assert.equal(Object.hasOwn(await denied.json(), 'items'), false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
