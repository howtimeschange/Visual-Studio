import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importAiTest() {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-ai-test-'))
  await build({
    entryPoints: ['packages/core/ai-test.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'ai-test.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'ai-test.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

function baseRequest(overrides = {}) {
  return {
    images: [{ assetId: 'asset-pants-1', label: '裤装主图' }],
    fields: {
      categoryKey: 'pants',
      modelProfile: ' 中大童男童，阳光元气 ',
      pose: '侧身跳跃抓拍',
      background: '纯白极简背景',
      productColor: '藏青色',
      sellingPoint: '弹力腰头 高腰护肚',
    },
    ...overrides,
  }
}

test('expandAiTestItems evenly cycles directions for count=8 over one image', async () => {
  const { mod, cleanup } = await importAiTest()
  try {
    const items = mod.expandAiTestItems(
      baseRequest({ count: 8, categoryKey: 'tshirt' }),
      mod.DEFAULT_AI_TEST_TEMPLATE,
      mod.DEFAULT_AI_TEST_CATEGORY_FACTORS.tshirt,
    )

    assert.equal(items.length, 8)
    assert.deepEqual(items.map((item) => item.direction.key), [
      'scene',
      'model',
      'selling_point',
      'pose',
      'color',
      'composition',
      'scene',
      'model',
    ])
    assert.deepEqual(items.map((item) => item.groupIndex), [1, 2, 3, 4, 5, 6, 7, 8])
    assert.equal(items[0].groupTotal, 8)
    assert.equal(items[0].direction.weightText.includes('场景'), true)
  } finally {
    await cleanup()
  }
})

test('pants render includes form strings, MD default sections, category factor, and negative prompt', async () => {
  const { mod, cleanup } = await importAiTest()
  try {
    const [item] = mod.expandAiTestItems(baseRequest({ count: 1 }))

    for (const section of [
      '【拍摄构图】',
      '【原图锁死】',
      '【模特锁定】',
      '【动作姿态】',
      '【背景环境】',
      '【衣服选色】',
      '【卖点文案】',
      '【全局光影】',
      '【画质规格】',
      '【加权倾斜】',
      '【品类高点击因子】',
      '【测图组别】',
    ]) {
      assert.match(item.prompt, new RegExp(section))
    }

    assert.match(item.prompt, /中大童男童，阳光元气/)
    assert.match(item.prompt, /侧身跳跃抓拍/)
    assert.match(item.prompt, /纯白极简背景/)
    assert.match(item.prompt, /藏青色/)
    assert.match(item.prompt, /弹力腰头/)
    assert.match(item.prompt, /高腰护肚/)
    assert.match(item.prompt, /当前测试方向：场景主导/)
    assert.match(item.prompt, /不要出现：畸形五官/)
  } finally {
    await cleanup()
  }
})

test('custom template version replaces default prompt text while still using direction/category variables', async () => {
  const { mod, cleanup } = await importAiTest()
  try {
    const customTemplate = {
      ...mod.DEFAULT_AI_TEST_TEMPLATE,
      templateId: 'custom_ai_test',
      versionId: 'custom_ai_test_v2',
      version: 2,
      title: '自定义模板版本 V2',
      promptBody: [
        '自定义模板版本 V2',
        '方向={{directionLabel}}',
        '方向加权={{directionWeightText}}',
        '品类={{categoryLabel}}',
        '模特={{modelProfile}}',
        '因子={{categoryFactor}}',
        '卖点={{sellingPoint}}',
      ].join('\n'),
      negativePrompt: '不要出现：测试负向词',
    }
    const [item] = mod.expandAiTestItems(baseRequest({ count: 3 }), customTemplate)

    assert.match(item.prompt, /自定义模板版本 V2/)
    assert.doesNotMatch(item.prompt, /资深童装电商主图视觉导演/)
    assert.match(item.prompt, /方向=场景主导/)
    assert.match(item.prompt, /方向加权=加权倾斜真实穿着场景/)
    assert.match(item.prompt, /品类=裤装/)
    assert.match(item.prompt, /模特=中大童男童，阳光元气/)
    assert.match(item.prompt, /弹力腰头/)
    assert.match(item.prompt, /不要出现：测试负向词/)
    assert.equal(item.templateVersionId, 'custom_ai_test_v2')
  } finally {
    await cleanup()
  }
})

test('normalizeAiTestRequest clamps defaults, normalizes text fields, and cleans images', async () => {
  const { mod, cleanup } = await importAiTest()
  try {
    const normalized = mod.normalizeAiTestRequest({
      count: 999,
      concurrency: -3,
      images: [
        { assetId: '   ', label: 'drop me' },
        { assetId: ' asset-1 ', label: '  第一张   图  ' },
        { assetId: 'asset-2' },
        { assetId: 'asset-3', index: 9, label: '' },
      ],
      fields: {
        categoryKey: ' pants ',
        modelProfile: ' 中大童男童   阳光元气 ',
        pose: ' 侧身   跳跃抓拍 ',
        background: ' 纯白   极简背景 ',
        productColor: ' 藏青色 ',
        sellingPoint: ' 弹力腰头   高腰护肚 ',
      },
    })

    assert.equal(normalized.count, 60)
    assert.equal(normalized.concurrency, 1)
    assert.equal(normalized.modelId, 'gpt-image-2')
    assert.equal(normalized.aspectRatio, '1:1')
    assert.equal(normalized.resolution, '1k')
    assert.deepEqual(normalized.fields, {
      categoryKey: 'pants',
      modelProfile: '中大童男童 阳光元气',
      pose: '侧身 跳跃抓拍',
      background: '纯白 极简背景',
      productColor: '藏青色',
      sellingPoint: '弹力腰头 高腰护肚',
    })
    assert.deepEqual(normalized.images, [
      { assetId: 'asset-1', label: '第一张 图', index: 1 },
      { assetId: 'asset-2', label: 'asset-2', index: 2 },
      { assetId: 'asset-3', label: 'asset-3', index: 9 },
    ])
  } finally {
    await cleanup()
  }
})

test('normalizeAiTestRequest limits images to backend work-size cap', async () => {
  const { mod, cleanup } = await importAiTest()
  try {
    const normalized = mod.normalizeAiTestRequest({
      images: Array.from({ length: 25 }, (_value, index) => ({ assetId: `asset-${index + 1}` })),
    })

    assert.equal(normalized.images.length, 20)
    assert.equal(normalized.images[0].assetId, 'asset-1')
    assert.equal(normalized.images[19].assetId, 'asset-20')
  } finally {
    await cleanup()
  }
})

test('expandAiTestItems caps total work while keeping balanced groups per image', async () => {
  const { mod, cleanup } = await importAiTest()
  try {
    const images = Array.from({ length: 20 }, (_value, index) => ({ assetId: `asset-${index + 1}` }))
    const items = mod.expandAiTestItems(baseRequest({ images, count: 60 }))

    assert.equal(items.length, 120)
    assert.equal(Math.max(...items.map((item) => item.groupIndex)), 6)
    assert.equal(Math.min(...items.map((item) => item.groupTotal)), 6)
    assert.equal(Math.max(...items.map((item) => item.groupTotal)), 6)
    assert.deepEqual(
      items.filter((item) => item.image.assetId === 'asset-1').map((item) => item.direction.key),
      ['scene', 'model', 'selling_point', 'pose', 'color', 'composition'],
    )
    assert.deepEqual(
      items.filter((item) => item.image.assetId === 'asset-20').map((item) => item.groupIndex),
      [1, 2, 3, 4, 5, 6],
    )
  } finally {
    await cleanup()
  }
})

test('expandAiTestItems throws a clear domain error when images are missing', async () => {
  const { mod, cleanup } = await importAiTest()
  try {
    assert.throws(() => mod.expandAiTestItems({ images: [] }), /images required/i)
    assert.throws(() => mod.expandAiTestItems({ images: [{ assetId: '   ' }] }), /images required/i)
  } finally {
    await cleanup()
  }
})

test('normalizeAiTestRequest accepts legacy aliases for future frontend compatibility', async () => {
  const { mod, cleanup } = await importAiTest()
  try {
    const normalized = mod.normalizeAiTestRequest({
      model: ' custom-model ',
      category: 'pants',
      modelFeature: '阳光男童',
      color: '藏青色',
      sellingPoint: '弹力腰头',
      images: [{ assetId: 'asset-1' }],
    })

    assert.equal(normalized.modelId, 'custom-model')
    assert.equal(normalized.fields.categoryKey, 'pants')
    assert.equal(normalized.fields.modelProfile, '阳光男童')
    assert.equal(normalized.fields.productColor, '藏青色')
    assert.equal(normalized.fields.sellingPoint, '弹力腰头')
  } finally {
    await cleanup()
  }
})

test('row-level workflow preserves custom prompts and chosen directions', async () => {
  const { mod, cleanup } = await importAiTest()
  try {
    const items = mod.expandAiTestItems(baseRequest({
      count: 6,
      images: [{ assetId: 'asset-pants-1', label: '裤装主图' }],
      rows: [
        {
          imageAssetId: 'asset-pants-1',
          directionKey: 'composition',
          prompt: '自由 Prompt：只测试干净构图和大主体，不要按默认场景顺序。',
        },
        {
          imageAssetId: 'asset-pants-1',
          directionKey: 'color',
        },
      ],
    }))

    assert.equal(items.length, 2)
    assert.equal(items[0].groupIndex, 1)
    assert.equal(items[0].groupTotal, 2)
    assert.equal(items[0].direction.key, 'composition')
    assert.equal(items[0].prompt, '自由 Prompt：只测试干净构图和大主体，不要按默认场景顺序。')
    assert.equal(items[1].groupIndex, 2)
    assert.equal(items[1].groupTotal, 2)
    assert.equal(items[1].direction.key, 'color')
    assert.match(items[1].prompt, /当前测试方向：产品颜色主导/)
    assert.match(items[1].prompt, /藏青色/)
  } finally {
    await cleanup()
  }
})

test('row-level workflow ignores rows for unknown images and caps total row work', async () => {
  const { mod, cleanup } = await importAiTest()
  try {
    const rows = Array.from({ length: 140 }, (_value, index) => ({
      imageAssetId: index === 0 ? 'missing-asset' : 'asset-pants-1',
      directionKey: index % 2 ? 'model' : 'scene',
      prompt: `custom prompt ${index}`,
    }))
    const normalized = mod.normalizeAiTestRequest(baseRequest({ rows }))
    const items = mod.expandAiTestItems(normalized)

    assert.equal(normalized.rows.length, 120)
    assert.equal(items.length, 120)
    assert.equal(items.every((item) => item.image.assetId === 'asset-pants-1'), true)
    assert.equal(items[0].prompt, 'custom prompt 1')
  } finally {
    await cleanup()
  }
})
