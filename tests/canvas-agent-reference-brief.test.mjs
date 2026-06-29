import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importCanvasAgent() {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto
  }
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-canvas-agent-brief-'))
  await build({
    stdin: {
      contents: [
        "export { onRequestPost } from './functions/api/canvas/agent.ts'",
        "export { createAsset, ensureSession } from './functions/_lib/v2-store.ts'",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'canvas-agent-brief-test-entry.mjs',
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'entry.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'entry.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

function jsonPost(body = {}) {
  return new Request('https://example.com/api/canvas/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function chatResponse(content) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

test('canvas agent analyzes uploaded reference images before planning prompts', async () => {
  const { mod, cleanup } = await importCanvasAgent()
  const originalFetch = globalThis.fetch
  const upstreamPayloads = []
  try {
    const env = { VISION_API_KEY: 'vision-key' }
    const session = await mod.ensureSession(env, 'session_reference_brief', null)
    const asset = await mod.createAsset(env, {
      sessionId: session.id,
      userId: null,
      kind: 'upload',
      source: 'test',
      filename: 'tmall-detail.png',
      mime: 'image/png',
      dataUrl: 'data:image/png;base64,cmVmZXJlbmNlLWltYWdl',
    })

    globalThis.fetch = async (_input, init = {}) => {
      const payload = JSON.parse(String(init.body || '{}'))
      upstreamPayloads.push(payload)
      if (upstreamPayloads.length === 1) {
        return chatResponse({
          product: {
            type: '儿童防晒衣',
            audience: '儿童户外穿着',
          },
          sellingPoints: ['UPF50+ 防晒', '冰感透气', '连帽护颈'],
          copyHierarchy: {
            headline: '夏日轻薄防晒',
            subPoints: ['UPF50+', '冰感透气', '不闷汗'],
          },
          pageStructure: ['首屏大标题', '卖点 icon 组', '面料纹理特写'],
          visualStyle: {
            palette: ['清爽蓝', '阳光黄'],
            layout: '天猫详情页首屏卖点图',
          },
        })
      }
      return chatResponse({
        reply: '我会基于参考图卖点做详情页首屏。',
        shouldGenerate: true,
        prompt: '',
        mode: 'generate',
        steps: ['理解参考图卖点', '规划详情页首屏', '生成图片'],
        suggestions: [],
        needsClarification: false,
        styleIntent: {
          category: 'ecommerce_product',
          medium: 'mixed',
          visualLanguage: 'tmall pdp hero detail graphic',
          reason: '参考图包含详情页卖点信息',
        },
        actions: [{
          id: 'image_1',
          type: 'generate_image',
          title: '详情页首屏',
          prompt: '儿童防晒衣详情页首屏，标题“夏日轻薄防晒”，突出 UPF50+ 防晒、冰感透气、连帽护颈，包含卖点 icon 组和面料纹理特写。',
          aspectRatio: '3:4',
          resolution: '2k',
        }],
      })
    }

    const response = await mod.onRequestPost({
      request: jsonPost({
        sessionId: session.id,
        message: '根据这些天猫详情图生成一张详情页首屏卖点图',
        modelId: 'nano-banana-2',
        aspectRatio: '3:4',
        resolution: '2k',
        referenceImages: [{ assetId: asset.id, role: 'subject', label: '天猫详情图' }],
      }),
      env,
      params: {},
      waitUntil: () => {},
    })

    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(upstreamPayloads.length, 2)
    assert.equal(body.referenceAnalysisUsed, true)
    assert.deepEqual(body.referenceBrief.sellingPoints, ['UPF50+ 防晒', '冰感透气', '连帽护颈'])
    assert.match(body.prompt, /UPF50\+ 防晒/)

    const analysisContent = upstreamPayloads[0].messages[1].content
    assert.equal(analysisContent.some((part) => part.type === 'image_url'), true)
    assert.match(analysisContent.find((part) => part.type === 'text').text, /抽取商品、卖点、文案层级/)

    const planningInput = JSON.parse(upstreamPayloads[1].messages[1].content)
    assert.equal(planningInput.hasReferenceImages, true)
    assert.equal(planningInput.referenceImages[0].assetId, asset.id)
    assert.deepEqual(planningInput.referenceBrief.copyHierarchy.subPoints, ['UPF50+', '冰感透气', '不闷汗'])
  } finally {
    globalThis.fetch = originalFetch
    await cleanup()
  }
})
