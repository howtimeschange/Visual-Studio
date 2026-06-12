import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importApi() {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto
  }
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-ai-test-api-'))
  await build({
    stdin: {
      contents: `
        export { onRequestOptions, onRequestGet, onRequestPost, onRequestPatch } from './functions/api/ai-test/templates.ts'
        export {
          createAuthSession,
          createUser,
          getActiveAiTestPromptTemplate,
          listAiTestPromptTemplates,
        } from './functions/_lib/v2-store.ts'
      `,
      resolveDir: process.cwd(),
      sourcefile: 'test-entry.mjs',
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'ai-test-api.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'ai-test-api.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

function jsonRequest(method, body, headers = {}) {
  return new Request('https://example.com/api/ai-test/templates', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function createAuthedUser(mod, env, email = `tester-${Date.now()}-${Math.random()}@example.com`) {
  const token = `token-${Date.now()}-${Math.random()}`
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const user = await mod.createUser(env, {
    email,
    name: email.split('@')[0],
    passwordHash: 'hash',
    passwordSalt: 'salt',
  })
  await mod.createAuthSession(env, {
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  })
  return {
    user,
    headers: {
      Cookie: `vs_auth=${encodeURIComponent(token)}`,
      'Content-Type': 'application/json',
    },
  }
}

test('GET /api/ai-test/templates requires auth', async () => {
  const { mod, cleanup } = await importApi()
  try {
    const response = await mod.onRequestGet({
      request: new Request('https://example.com/api/ai-test/templates'),
      env: {},
      params: {},
    })
    const body = await response.json()

    assert.equal(response.status, 401)
    assert.equal(body.error, 'Login required')
  } finally {
    await cleanup()
  }
})

test('OPTIONS /api/ai-test/templates allows PATCH preflight', async () => {
  const { mod, cleanup } = await importApi()
  try {
    const response = await mod.onRequestOptions({
      request: new Request('https://example.com/api/ai-test/templates', { method: 'OPTIONS' }),
      env: {},
      params: {},
    })

    assert.equal(response.status, 200)
    assert.match(response.headers.get('Access-Control-Allow-Methods') || '', /PATCH/)
  } finally {
    await cleanup()
  }
})

test('GET /api/ai-test/templates returns active template and category factors for valid auth', async () => {
  const { mod, cleanup } = await importApi()
  try {
    const env = {}
    const auth = await createAuthedUser(mod, env)
    const response = await mod.onRequestGet({
      request: new Request('https://example.com/api/ai-test/templates', { headers: auth.headers }),
      env,
      params: {},
    })
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.activeTemplate.key, 'children_main_image')
    assert.equal(body.activeTemplate.activeVersion.versionId, 'aitver_children_main_image_v1')
    assert.equal(Array.isArray(body.templates), true)
    assert.equal(body.templates.length >= 1, true)
    assert.equal(Array.isArray(body.categoryFactors), true)
    assert.equal(body.categoryFactors.some((factor) => factor.categoryKey === 'tshirt'), true)
    assert.deepEqual(body.directions, body.activeTemplate.activeVersion.directions)
  } finally {
    await cleanup()
  }
})

test('POST /api/ai-test/templates requires admin', async () => {
  const { mod, cleanup } = await importApi()
  try {
    const env = {}
    const auth = await createAuthedUser(mod, env)
    const response = await mod.onRequestPost({
      request: jsonRequest('POST', {
        title: 'Normal user draft',
        promptBody: 'Draft prompt',
      }, auth.headers),
      env,
      params: {},
    })
    const body = await response.json()

    assert.equal(response.status, 403)
    assert.equal(body.error, 'Admin access required')
  } finally {
    await cleanup()
  }
})

test('POST /api/ai-test/templates lets admin create a draft version', async () => {
  const { mod, cleanup } = await importApi()
  try {
    const env = {}
    const auth = await createAuthedUser(mod, env, 'admin-create@example.com')
    env.VS_ADMIN_EMAILS = auth.user.email

    const response = await mod.onRequestPost({
      request: jsonRequest('POST', {
        templateKey: 'children_main_image',
        title: 'API draft version',
        promptBody: 'API prompt {{directionLabel}}',
        negativePrompt: 'API negative',
        directions: [{ key: 'api_scene', label: 'API 场景', weightText: 'API scene weight.' }],
        variables: ['directionLabel'],
        notes: 'created by api test',
      }, auth.headers),
      env,
      params: {},
    })
    const body = await response.json()
    const templates = await mod.listAiTestPromptTemplates(env)

    assert.equal(response.status, 201)
    assert.equal(body.createdVersion.title, 'API draft version')
    assert.equal(body.createdVersion.version, 2)
    assert.match(body.createdVersion.versionId, /^aitver_/)
    assert.equal(body.activeTemplate.activeVersion.versionId, 'aitver_children_main_image_v1')
    assert.equal(templates[0].activeVersion.versionId, 'aitver_children_main_image_v1')
  } finally {
    await cleanup()
  }
})

test('template API write routes validate JSON and activation action fields', async () => {
  const { mod, cleanup } = await importApi()
  try {
    const env = {}
    const auth = await createAuthedUser(mod, env, 'admin-invalid@example.com')
    env.VS_ADMIN_EMAILS = auth.user.email

    const invalidJson = await mod.onRequestPost({
      request: new Request('https://example.com/api/ai-test/templates', {
        method: 'POST',
        headers: auth.headers,
        body: '{',
      }),
      env,
      params: {},
    })
    const invalidBody = await invalidJson.json()
    assert.equal(invalidJson.status, 400)
    assert.equal(invalidBody.error, 'Invalid JSON')

    const unsupportedAction = await mod.onRequestPatch({
      request: jsonRequest('PATCH', { action: 'archive', versionId: 'aitver_x' }, auth.headers),
      env,
      params: {},
    })
    assert.equal(unsupportedAction.status, 400)
    assert.equal((await unsupportedAction.json()).error, 'Unsupported action')

    const missingVersion = await mod.onRequestPatch({
      request: jsonRequest('PATCH', { action: 'activate' }, auth.headers),
      env,
      params: {},
    })
    assert.equal(missingVersion.status, 400)
    assert.equal((await missingVersion.json()).error, 'versionId required')

    const missingPrompt = await mod.onRequestPost({
      request: jsonRequest('POST', { title: 'Missing prompt' }, auth.headers),
      env,
      params: {},
    })
    assert.equal(missingPrompt.status, 400)
    assert.equal((await missingPrompt.json()).error, 'promptBody required')

    const invalidTemplateKey = await mod.onRequestGet({
      request: new Request('https://example.com/api/ai-test/templates?templateKey=../bad', { headers: auth.headers }),
      env,
      params: {},
    })
    assert.equal(invalidTemplateKey.status, 400)
    assert.equal((await invalidTemplateKey.json()).error, 'Invalid templateKey')

    const missingTemplateKey = await mod.onRequestGet({
      request: new Request('https://example.com/api/ai-test/templates?templateKey=valid_but_missing', { headers: auth.headers }),
      env,
      params: {},
    })
    assert.equal(missingTemplateKey.status, 404)
    assert.match((await missingTemplateKey.json()).error, /not found/i)
  } finally {
    await cleanup()
  }
})

test('template API write routes check admin before parsing invalid JSON', async () => {
  const { mod, cleanup } = await importApi()
  try {
    const env = {}
    const auth = await createAuthedUser(mod, env, 'normal-invalid@example.com')
    const badPost = new Request('https://example.com/api/ai-test/templates', {
      method: 'POST',
      headers: auth.headers,
      body: '{',
    })
    const badPatch = new Request('https://example.com/api/ai-test/templates', {
      method: 'PATCH',
      headers: auth.headers,
      body: '{',
    })
    const anonymousPost = await mod.onRequestPost({
      request: new Request('https://example.com/api/ai-test/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
      env,
      params: {},
    })
    const normalPost = await mod.onRequestPost({ request: badPost, env, params: {} })
    const normalPatch = await mod.onRequestPatch({ request: badPatch, env, params: {} })

    assert.equal(anonymousPost.status, 401)
    assert.equal((await anonymousPost.json()).error, 'Login required')
    assert.equal(normalPost.status, 403)
    assert.equal((await normalPost.json()).error, 'Admin access required')
    assert.equal(normalPatch.status, 403)
    assert.equal((await normalPatch.json()).error, 'Admin access required')
  } finally {
    await cleanup()
  }
})

test('PATCH /api/ai-test/templates lets admin activate a version', async () => {
  const { mod, cleanup } = await importApi()
  try {
    const env = {}
    const auth = await createAuthedUser(mod, env, 'admin-activate@example.com')
    env.ADMIN_EMAILS = auth.user.email

    const createResponse = await mod.onRequestPost({
      request: jsonRequest('POST', {
        title: 'API activation draft',
        promptBody: 'Activation prompt {{directionLabel}}',
        directions: [{ key: 'activation', label: '激活方向', weightText: 'Activation weight.' }],
        variables: ['directionLabel'],
      }, auth.headers),
      env,
      params: {},
    })
    const createdBody = await createResponse.json()

    const response = await mod.onRequestPatch({
      request: jsonRequest('PATCH', {
        action: 'activate',
        versionId: createdBody.createdVersion.versionId,
      }, auth.headers),
      env,
      params: {},
    })
    const body = await response.json()
    const active = await mod.getActiveAiTestPromptTemplate(env, 'children_main_image')

    assert.equal(response.status, 200)
    assert.equal(body.activeTemplate.activeVersion.versionId, createdBody.createdVersion.versionId)
    assert.equal(body.activeTemplate.activeVersion.title, 'API activation draft')
    assert.equal(active.activeVersion.versionId, createdBody.createdVersion.versionId)
    assert.deepEqual(body.directions, body.activeTemplate.activeVersion.directions)
  } finally {
    await cleanup()
  }
})

test('template API maps unknown template/version store errors to 404', async () => {
  const { mod, cleanup } = await importApi()
  try {
    const env = {}
    const auth = await createAuthedUser(mod, env, 'admin-notfound@example.com')
    env.VS_ADMIN_EMAILS = auth.user.email

    const postUnknownTemplate = await mod.onRequestPost({
      request: jsonRequest('POST', {
        templateKey: 'missing_template',
        title: 'Missing template',
        promptBody: 'Prompt body',
      }, auth.headers),
      env,
      params: {},
    })
    const patchUnknownVersion = await mod.onRequestPatch({
      request: jsonRequest('PATCH', {
        action: 'activate',
        versionId: 'aitver_missing',
      }, auth.headers),
      env,
      params: {},
    })

    assert.equal(postUnknownTemplate.status, 404)
    assert.match((await postUnknownTemplate.json()).error, /not found/i)
    assert.equal(patchUnknownVersion.status, 404)
    assert.match((await patchUnknownVersion.json()).error, /not found/i)
  } finally {
    await cleanup()
  }
})
