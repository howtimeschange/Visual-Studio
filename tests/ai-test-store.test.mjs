import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'

async function importStore() {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-ai-test-store-'))
  await build({
    stdin: {
      contents: `
        export {
          getActiveAiTestPromptTemplate,
          listAiTestPromptTemplates,
          listAiTestCategoryFactors,
          createAiTestPromptVersion,
          activateAiTestPromptVersion,
        } from './functions/_lib/v2-store.ts'
      `,
      resolveDir: process.cwd(),
      sourcefile: 'test-entry.mjs',
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: path.join(outdir, 'v2-store.mjs'),
    logLevel: 'silent',
  })
  const mod = await import(`${pathToFileURL(path.join(outdir, 'v2-store.mjs')).href}?t=${Date.now()}`)
  return { mod, cleanup: () => rm(outdir, { recursive: true, force: true }) }
}

function makeFakeDb() {
  const state = {
    templates: [{
      id: 'aittpl_children_main_image',
      key: 'children_main_image',
      title: '童装电商主图 AI 测图',
      description: 'D1 seeded template',
      active_version_id: 'aitver_children_main_image_v1',
      created_at: '2026-06-12T00:00:00.000Z',
      updated_at: '2026-06-12T00:00:00.000Z',
    }],
    versions: [{
      id: 'aitver_children_main_image_v1',
      template_id: 'aittpl_children_main_image',
      version: 1,
      status: 'active',
      title: '需求文档默认版本',
      prompt_body: 'D1 prompt {{directionLabel}}',
      negative_prompt: 'D1 negative prompt',
      direction_json: JSON.stringify([{ key: 'custom_scene', label: '自定义场景', weightText: 'D1 JSON parsed weight.' }]),
      variables_json: JSON.stringify(['directionLabel']),
      created_at: '2026-06-12T00:00:00.000Z',
      activated_at: '2026-06-12T00:00:00.000Z',
      notes: null,
    }],
    factors: [{
      id: 'aitcf_tshirt',
      category_key: 'tshirt',
      category_label: 'T恤',
      factor_text: 'D1 factor',
      enabled: 1,
      sort_order: 10,
    }],
    statements: [],
  }

  function activeTemplateRow(key) {
    const template = state.templates.find((item) => item.key === key)
    if (!template) return null
    const version = state.versions.find((item) => item.id === template.active_version_id)
    return {
      ...template,
      version_id: version?.id,
      template_id: version?.template_id,
      version: version?.version,
      version_title: version?.title,
      prompt_body: version?.prompt_body,
      negative_prompt: version?.negative_prompt,
      direction_json: version?.direction_json,
      variables_json: version?.variables_json,
    }
  }

  return {
    state,
    async batch(statements) {
      state.statements.push({ sql: '__batch__', params: statements.length, method: 'batch' })
      for (const statement of statements) {
        await statement.run()
      }
      return statements.map(() => ({ success: true }))
    },
    prepare(sql) {
      return {
        bind(...params) {
          return {
            first: async () => {
              state.statements.push({ sql, params, method: 'first' })
              if (/FROM ai_test_prompt_templates t\s+LEFT JOIN ai_test_prompt_versions/i.test(sql)) {
                return activeTemplateRow(params[0])
              }
              if (/SELECT \* FROM ai_test_prompt_templates/i.test(sql)) {
                return state.templates.find((item) => item.key === params[0] || item.id === params[1]) || null
              }
              if (/MAX\(version\)/i.test(sql)) {
                const templateId = params[0]
                return {
                  max_version: Math.max(0, ...state.versions
                    .filter((item) => item.template_id === templateId)
                    .map((item) => item.version)),
                }
              }
              if (/SELECT \* FROM ai_test_prompt_versions/i.test(sql)) {
                return state.versions.find((item) => item.template_id === params[0] && item.id === params[1]) || null
              }
              return null
            },
            all: async () => {
              state.statements.push({ sql, params, method: 'all' })
              if (/FROM ai_test_prompt_templates t\s+LEFT JOIN ai_test_prompt_versions/i.test(sql)) {
                return { results: state.templates.map((template) => activeTemplateRow(template.key)).filter(Boolean) }
              }
              if (/FROM ai_test_category_factors/i.test(sql)) {
                return { results: state.factors.filter((item) => item.enabled).sort((a, b) => a.sort_order - b.sort_order || a.category_label.localeCompare(b.category_label)) }
              }
              return { results: [] }
            },
            run: async () => {
              state.statements.push({ sql, params, method: 'run' })
              if (/INSERT INTO ai_test_prompt_versions/i.test(sql)) {
                state.versions.push({
                  id: params[0],
                  template_id: params[1],
                  version: params[2],
                  status: 'draft',
                  title: params[3],
                  prompt_body: params[4],
                  negative_prompt: params[5],
                  direction_json: params[6],
                  variables_json: params[7],
                  created_by_user_id: params[8],
                  created_at: params[9],
                  activated_at: null,
                  notes: params[10],
                })
              }
              if (/UPDATE ai_test_prompt_versions/i.test(sql)) {
                const [activeVersionId, activatedVersionId, activatedAt, templateId] = params
                for (const version of state.versions.filter((item) => item.template_id === templateId)) {
                  if (version.id === activeVersionId) {
                    version.status = 'active'
                    version.activated_at = activatedAt
                  } else if (version.status === 'active') {
                    version.status = 'archived'
                  }
                }
                assert.equal(activeVersionId, activatedVersionId)
              }
              if (/UPDATE ai_test_prompt_templates/i.test(sql)) {
                const [activeVersionId, updatedAt, templateId] = params
                const template = state.templates.find((item) => item.id === templateId)
                if (template) {
                  template.active_version_id = activeVersionId
                  template.updated_at = updatedAt
                }
              }
              return { success: true }
            },
          }
        },
        first: async () => null,
        all: async () => {
          state.statements.push({ sql, params: [], method: 'all' })
          if (/FROM ai_test_prompt_templates t\s+LEFT JOIN ai_test_prompt_versions/i.test(sql)) {
            return { results: state.templates.map((template) => activeTemplateRow(template.key)).filter(Boolean) }
          }
          if (/FROM ai_test_category_factors/i.test(sql)) {
            return { results: state.factors.filter((item) => item.enabled).sort((a, b) => a.sort_order - b.sort_order || a.category_label.localeCompare(b.category_label)) }
          }
          return { results: [] }
        },
        run: async () => ({ success: true }),
      }
    },
  }
}

test('memory fallback returns default prompt template and category factors', async () => {
  const { mod, cleanup } = await importStore()
  try {
    const template = await mod.getActiveAiTestPromptTemplate({}, 'children_main_image')
    const factors = await mod.listAiTestCategoryFactors({})

    assert.equal(template.id, 'aittpl_children_main_image')
    assert.equal(template.key, 'children_main_image')
    assert.equal(template.activeVersion.templateId, 'aittpl_children_main_image')
    assert.equal(template.activeVersion.versionId, 'aitver_children_main_image_v1')
    assert.equal(template.activeVersion.version, 1)
    assert.match(template.activeVersion.promptBody, /资深童装电商主图视觉导演/)
    assert.equal(factors.some((factor) => factor.categoryKey === 'tshirt'), true)
  } finally {
    await cleanup()
  }
})

test('AI test migration creates seed tables and default category rows', async () => {
  const sql = await readFile('migrations/0005_ai_test_prompts.sql', 'utf8')
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)')
    db.exec(sql)
    const template = db.prepare('SELECT key, active_version_id FROM ai_test_prompt_templates WHERE key = ?').get('children_main_image')
    const version = db.prepare('SELECT version, status, negative_prompt FROM ai_test_prompt_versions WHERE id = ?').get('aitver_children_main_image_v1')
    const categoryCount = db.prepare('SELECT COUNT(*) AS count FROM ai_test_category_factors WHERE enabled = 1').get()

    assert.equal(template.key, 'children_main_image')
    assert.equal(template.active_version_id, 'aitver_children_main_image_v1')
    assert.equal(version.version, 1)
    assert.equal(version.status, 'active')
    assert.match(version.negative_prompt, /^不要出现：畸形五官/)
    assert.equal(categoryCount.count, 11)
  } finally {
    db.close()
  }
})

test('D1 rows return active prompt template and parse direction JSON', async () => {
  const { mod, cleanup } = await importStore()
  const db = makeFakeDb()
  try {
    const env = { VS_DB: db }
    const template = await mod.getActiveAiTestPromptTemplate(env, 'children_main_image')
    const templates = await mod.listAiTestPromptTemplates(env)
    const factors = await mod.listAiTestCategoryFactors(env)

    assert.equal(template.id, 'aittpl_children_main_image')
    assert.equal(template.activeVersion.versionId, 'aitver_children_main_image_v1')
    assert.deepEqual(template.activeVersion.directions, [
      { key: 'custom_scene', label: '自定义场景', weightText: 'D1 JSON parsed weight.' },
    ])
    assert.equal(templates.length, 1)
    assert.equal(factors[0].factorText, 'D1 factor')
  } finally {
    await cleanup()
  }
})

test('D1 successful empty reads remain empty instead of falling back to defaults', async () => {
  const { mod, cleanup } = await importStore()
  const db = makeFakeDb()
  try {
    db.state.templates.length = 0
    db.state.factors.length = 0
    const env = { VS_DB: db }
    const templates = await mod.listAiTestPromptTemplates(env)
    const factors = await mod.listAiTestCategoryFactors(env)

    assert.deepEqual(templates, [])
    assert.deepEqual(factors, [])
  } finally {
    await cleanup()
  }
})

test('store preserves empty negative prompt defaults from D1 and writes', async () => {
  const { mod, cleanup } = await importStore()
  const db = makeFakeDb()
  try {
    db.state.versions[0].negative_prompt = ''
    const env = { VS_DB: db }
    const template = await mod.getActiveAiTestPromptTemplate(env, 'children_main_image')
    const created = await mod.createAiTestPromptVersion(env, {
      templateKey: 'children_main_image',
      title: '无负向词草稿',
      promptBody: 'Draft prompt',
    })
    const stored = db.state.versions.find((version) => version.id === created.versionId)

    assert.equal(template.activeVersion.negativePrompt, '')
    assert.equal(created.negativePrompt, '')
    assert.equal(stored.negative_prompt, '')
  } finally {
    await cleanup()
  }
})

test('memory fallback prompt versions are isolated from returned object mutation', async () => {
  const { mod, cleanup } = await importStore()
  try {
    const created = await mod.createAiTestPromptVersion({}, {
      templateKey: 'children_main_image',
      title: 'Memory isolated draft',
      promptBody: 'Memory draft',
      directions: [{ key: 'scene', label: '场景主导', weightText: 'Original weight.' }],
      variables: ['directionLabel'],
    })
    created.directions.push({ key: 'mutated', label: '污染方向', weightText: 'Should not persist.' })
    created.variables.push('mutatedVariable')

    const activeTemplate = await mod.activateAiTestPromptVersion({}, 'children_main_image', created.versionId)
    activeTemplate.activeVersion.directions[0].weightText = 'Changed after activate.'
    activeTemplate.activeVersion.variables.push('changedAfterActivate')

    const reread = await mod.getActiveAiTestPromptTemplate({}, 'children_main_image')
    assert.deepEqual(reread.activeVersion.directions, [
      { key: 'scene', label: '场景主导', weightText: 'Original weight.' },
    ])
    assert.deepEqual(reread.activeVersion.variables, ['directionLabel'])
  } finally {
    await cleanup()
  }
})

test('createAiTestPromptVersion creates incremented draft and activation switches active version', async () => {
  const { mod, cleanup } = await importStore()
  const db = makeFakeDb()
  try {
    const env = { VS_DB: db }
    const created = await mod.createAiTestPromptVersion(env, {
      templateKey: 'children_main_image',
      title: '测试草稿版本',
      promptBody: 'Draft prompt',
      negativePrompt: 'Draft negative',
      directions: [{ key: 'draft', label: '草稿方向', weightText: 'Draft weight.' }],
      variables: ['directionLabel'],
      notes: 'test note',
      createdByUserId: 'user_admin',
    })

    assert.equal(created.version, 2)
    assert.equal(created.title, '测试草稿版本')
    assert.equal(db.state.templates[0].active_version_id, 'aitver_children_main_image_v1')
    assert.equal(db.state.versions.find((version) => version.id === created.versionId)?.status, 'draft')

    const activeTemplate = await mod.activateAiTestPromptVersion(env, 'children_main_image', created.versionId)

    assert.equal(activeTemplate.activeVersion.versionId, created.versionId)
    assert.equal(db.state.templates[0].active_version_id, created.versionId)
    assert.equal(db.state.versions.find((version) => version.id === 'aitver_children_main_image_v1')?.status, 'archived')
    assert.equal(db.state.versions.find((version) => version.id === created.versionId)?.status, 'active')
    assert.equal(db.state.statements.some((statement) => statement.method === 'batch'), true)
  } finally {
    await cleanup()
  }
})
