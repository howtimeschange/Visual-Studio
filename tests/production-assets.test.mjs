import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { buildPublic } from '../scripts/build-public.mjs'

test('production entry fingerprints include imported JS and CSS changes without modifying source files', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'vs-assets-fixture-'))
  const outputs = []
  try {
    await mkdir(path.join(source, 'admin')); await mkdir(path.join(source, 'js')); await mkdir(path.join(source, 'css'))
    const html = '<link href="/styles.css?v=old"><link rel="stylesheet" href="/css/workspace-layout.css"><script type="module" src="/app.js?v=old"></script>'
    await writeFile(path.join(source, 'index.html'), html)
    await writeFile(path.join(source, 'admin/index.html'), '<link href="/admin.css"><script src="/admin.js"></script>')
    await writeFile(path.join(source, 'app.js'), "import { value } from './js/value.js'; document.body.textContent = value")
    await writeFile(path.join(source, 'js/value.js'), "export const value = 'first'")
    await writeFile(path.join(source, 'styles.css'), '@import "./child.css"; body { margin: 0; }')
    await writeFile(path.join(source, 'child.css'), 'body { color: red; }')
    await writeFile(path.join(source, 'css/workspace-layout.css'), 'body { color: green; }')
    await writeFile(path.join(source, 'admin.js'), 'document.title = "Admin"')
    await writeFile(path.join(source, 'admin.css'), 'body { color: black; }')
    const first = await buildPublic(source); outputs.push(first.directory)
    for (const entry of Object.values(first.entries)) assert.ok((await readFile(path.join(first.directory, entry.url))).length)
    assert.ok((await readFile(path.join(first.directory, 'index.html'), 'utf8')).includes(first.entries.app.url))
    assert.ok(!(await readFile(path.join(first.directory, 'index.html'), 'utf8')).includes('/css/workspace-layout.css'))
    const css = await readFile(path.join(first.directory, first.entries.styles.url), 'utf8')
    assert.ok(css.lastIndexOf('green') > css.lastIndexOf('red'), 'workspace overrides retain their original cascade order')
    await writeFile(path.join(source, 'js/value.js'), "export const value = 'second'")
    await writeFile(path.join(source, 'child.css'), 'body { color: blue; }')
    const next = await buildPublic(source); outputs.push(next.directory)
    assert.notEqual(first.entries.app.url, next.entries.app.url)
    assert.notEqual(first.entries.styles.url, next.entries.styles.url)
    assert.equal(first.entries.admin.url, next.entries.admin.url)
    await writeFile(path.join(source, 'css/workspace-layout.css'), '.canvas-image-retry { display: none; }')
    const workspaceOnly = await buildPublic(source); outputs.push(workspaceOnly.directory)
    assert.notEqual(next.entries.styles.url, workspaceOnly.entries.styles.url)
    assert.equal(next.entries.app.url, workspaceOnly.entries.app.url)
    assert.match(await readFile(path.join(workspaceOnly.directory, workspaceOnly.entries.styles.url), 'utf8'), /canvas-image-retry\{display:none\}/)
    assert.equal(await readFile(path.join(source, 'index.html'), 'utf8'), html)
  } finally { await Promise.all([source, ...outputs].map(directory => rm(directory, { recursive: true, force: true }))) }
})
