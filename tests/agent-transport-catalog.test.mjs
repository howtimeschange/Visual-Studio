import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { groupModelCatalog, agentModelUnavailableReason, imageModelChoices } from '../public/js/model-catalog.js'

test('catalog groups the whole platform by vendor and explains unselectable image and unauthorized models', () => {
  const models = [
    { id: 'gpt-6-sol', name: 'GPT 6 Sol', vendor: 'openai', kind: 'text', protocol: 'openai-responses', available: true },
    { id: 'gemini-3-flash', name: 'Gemini', vendor: 'google', kind: 'text', protocol: 'openai', available: false },
    { id: 'gpt-image-2.5-flare', vendor: 'openai', kind: 'image', protocol: 'openai', available: true },
    { id: 'deepseek-flash', vendor: 'deepseek', kind: 'text', protocol: 'openai', available: true },
  ]
  const groups = groupModelCatalog(models)
  assert.equal(groups.reduce((count, group) => count + group.models.length, 0), 4)
  assert.deepEqual(groups.map(group => group.vendor).sort(), ['DeepSeek', 'Google', 'OpenAI'])
  assert.equal(groupModelCatalog(models, 'GOOGLE')[0].models[0].id, 'gemini-3-flash')
  assert.equal(groupModelCatalog(models, 'nonexistent').length, 0)
  assert.equal(agentModelUnavailableReason(models[0]), '')
  assert.match(agentModelUnavailableReason(models[1]), /账号/)
  assert.match(agentModelUnavailableReason(models[2]), /生图模型/)
})

test('Responses Agent transport sends multimodal input once and rejects incomplete output without replay', async () => {
  const directory = await mkdtemp(`${tmpdir()}/agent-transport-`)
  const originalFetch = globalThis.fetch
  try {
    const outfile = `${directory}/entry.mjs`
    await build({ stdin: { contents: `export { callTextModel } from './functions/_shared.ts'; export { normalizeModelCatalog } from './functions/api/account/modeljetty/models.ts'`, resolveDir: process.cwd(), loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
    const api = await import(pathToFileURL(outfile))
    const requests = []
    globalThis.fetch = async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"reply":"done"}' }] }] })) }
    const text = await api.callTextModel('https://example.com/v1', 'fixture-key', 'gpt-6-sol', [{ role: 'system', content: 'plan' }, { role: 'user', content: [{ type: 'text', text: 'reference' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } }] }], { protocol: 'responses', requestId: 'fixture-request', strict: true })
    assert.equal(text, '{"reply":"done"}')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, 'https://example.com/v1/responses')
    assert.equal(requests[0].body.input[1].content[1].type, 'input_image')
    assert.equal(Object.hasOwn(requests[0].body, 'temperature'), false)
    let calls = 0
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ status: 'incomplete', output_text: 'partial' })) }
    await assert.rejects(api.callTextModel('https://example.com/v1', 'fixture-key', 'gpt-6-sol', [], { protocol: 'responses', strict: true }), /incomplete/)
    assert.equal(calls, 1)
    const catalog = api.normalizeModelCatalog({ version: 1, models: [{ id: 'gemini-3-flash', name: 'Gemini', vendor: 'google', protocol: 'openai', available: true, secret: 'not-exported', capabilities: { imageInput: true } }, { id: '<script>' }] })
    assert.equal(catalog.models.length, 1)
    assert.equal(catalog.models[0].capabilities.imageInput, true)
    assert.doesNotMatch(JSON.stringify(catalog), /not-exported|script/)
  } finally { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }) }
})


test('image choices explain account membership restrictions while manual keys keep their own capabilities', () => {
  const options=[{id:'gemini',label:'Nano Banana 2'},{id:'gpt-fast',label:'GPT Image 快速'}]
  const catalog=[{id:'gemini',available:true},{id:'gpt-fast',available:false,unavailableReason:'paid_model_access_required'}]
  const choices=imageModelChoices(options,catalog)
  assert.equal(choices[0].disabled,false)
  assert.equal(choices[1].disabled,true)
  assert.equal(choices[1].unavailableReason,'需要付费模型权限')
  assert.equal(imageModelChoices(options,[{id:'gpt-fast',available:false,unavailableReason:'membership_or_paid_access_required'}])[1].unavailableReason,'需要会员或付费模型权限')
  assert.ok(imageModelChoices(options,null).every(m=>!m.disabled))
  assert.ok(imageModelChoices(options,[]).every(m=>m.disabled))
})
