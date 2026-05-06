import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

async function importStore() {
  const outdir = await mkdtemp(path.join(tmpdir(), 'visual-studio-store-writes-'))
  await build({
    stdin: {
      contents: `
        export {
          replaceCanvasProjectElements,
          touchAuthSession,
          updateCanvasProject,
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

test('touchAuthSession skips D1 writes when last_seen_at was recently refreshed', async () => {
  const { mod, cleanup } = await importStore()
  const updates = []
  const env = {
    VS_DB: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              run: async () => {
                updates.push({ sql, params })
              },
            }
          },
        }
      },
    },
  }

  try {
    await mod.touchAuthSession(env, 'authsess_recent', {
      lastSeenAt: '2026-05-06T10:00:00.000Z',
      now: '2026-05-06T10:02:00.000Z',
      minIntervalMs: 5 * 60_000,
    })

    assert.equal(updates.length, 0)
  } finally {
    await cleanup()
  }
})

test('updateCanvasProject skips the D1 UPDATE when the project payload is unchanged', async () => {
  const { mod, cleanup } = await importStore()
  const updates = []
  const projectRow = {
    id: 'canvas_same',
    session_id: 'session_1',
    owner_user_id: 'user_1',
    title: 'Same title',
    metadata_json: JSON.stringify({ aiSessionId: 'session-a' }),
    created_at: '2026-05-06T10:00:00.000Z',
    updated_at: '2026-05-06T10:01:00.000Z',
  }
  const env = {
    VS_DB: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              first: async () => projectRow,
              run: async () => {
                updates.push({ sql, params })
              },
            }
          },
        }
      },
    },
  }

  try {
    const project = await mod.updateCanvasProject(env, 'canvas_same', {
      sessionId: 'session_1',
      ownerUserId: 'user_1',
      title: 'Same title',
      metadataJson: { aiSessionId: 'session-a' },
    })

    assert.equal(updates.length, 0)
    assert.equal(project.updatedAt, '2026-05-06T10:01:00.000Z')
  } finally {
    await cleanup()
  }
})

test('replaceCanvasProjectElements skips delete and insert when serialized elements are unchanged', async () => {
  const { mod, cleanup } = await importStore()
  const batches = []
  const element = { id: 'el-1', type: 'image', assetId: 'asset-1', x: 10, y: 20 }
  const projectRow = {
    id: 'canvas_elements_same',
    session_id: 'session_1',
    owner_user_id: 'user_1',
    title: 'Same title',
    metadata_json: '{}',
    created_at: '2026-05-06T10:00:00.000Z',
    updated_at: '2026-05-06T10:01:00.000Z',
  }
  const elementRow = {
    id: 'cel_existing',
    project_id: 'canvas_elements_same',
    element_type: 'image',
    z_index: 0,
    data_json: JSON.stringify(element),
    created_at: '2026-05-06T10:00:00.000Z',
    updated_at: '2026-05-06T10:01:00.000Z',
  }
  const env = {
    VS_DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              first: async () => projectRow,
              all: async () => ({ results: [elementRow] }),
              run: async () => {},
            }
          },
        }
      },
      batch: async (statements) => {
        batches.push(statements)
      },
    },
  }

  try {
    const records = await mod.replaceCanvasProjectElements(env, 'canvas_elements_same', [element])

    assert.equal(batches.length, 0)
    assert.deepEqual(records.map((record) => record.dataJson), [element])
  } finally {
    await cleanup()
  }
})
