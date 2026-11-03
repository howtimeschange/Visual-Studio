import { build } from 'esbuild'
import { cp, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('../', import.meta.url))

export async function buildPublic(publicDir = path.join(root, 'public')) {
  publicDir = await realpath(publicDir)
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'visual-studio-pages-')))
  await cp(publicDir, directory, { recursive: true })
  const inputs = { app: 'app.js', styles: 'styles.css', admin: 'admin.js', 'admin-styles': 'admin.css' }
  const entryPoints = Object.fromEntries(Object.entries(inputs).map(([name, file]) => [name, path.join(publicDir, file)]))
  const workspaceLink = /<link\b[^>]*\bhref=["']\/css\/workspace-layout\.css(?:\?[^"']*)?["'][^>]*>\s*/i
  const bundleWorkspace = workspaceLink.test(await readFile(path.join(publicDir, 'index.html'), 'utf8'))
  const stylesEntry = path.join(directory, '.production-styles.css')
  if (bundleWorkspace) {
    // Preserve the local cascade (base first, workspace overrides last), while
    // giving both stylesheets one immutable production identity.
    await writeFile(stylesEntry, [inputs.styles, 'css/workspace-layout.css'].map(file => `@import ${JSON.stringify(path.join(publicDir, file))};`).join('\n'))
    entryPoints.styles = stylesEntry
  }
  const result = await build({
    entryPoints,
    outdir: path.join(directory, '_runtime'), entryNames: '[name]-[hash]',
    bundle: true, format: 'esm', target: 'es2022', minify: true,
    metafile: true, legalComments: 'eof', logLevel: 'silent',
  })
  if (bundleWorkspace) await rm(stylesEntry)
  const entries = {}
  for (const [name, file] of Object.entries(inputs)) {
    const output = Object.entries(result.metafile.outputs).find(([, meta]) => meta.entryPoint && path.resolve(meta.entryPoint) === entryPoints[name])
    if (!output) throw new Error(`Missing production entry: ${name}`)
    const filename = path.resolve(output[0])
    const bytes = await readFile(filename)
    entries[name] = { url: '/' + path.relative(directory, filename).split(path.sep).join('/'), bytes: (await stat(filename)).size, gzipBytes: gzipSync(bytes).length }
  }
  for (const [htmlFile, refs] of [['index.html', { '/app.js': 'app', '/styles.css': 'styles' }], ['admin/index.html', { '/admin.js': 'admin', '/admin.css': 'admin-styles' }]]) {
    const filename = path.join(directory, htmlFile)
    let html = await readFile(filename, 'utf8')
    if (htmlFile === 'index.html' && bundleWorkspace) html = html.replace(workspaceLink, '')
    for (const [source, name] of Object.entries(refs)) {
      const expression = new RegExp(`(["'])${source.replaceAll('.', '\\.')}([?][^"']*)?\\1`, 'g')
      let matched = 0
      html = html.replace(expression, (_all, quote) => { matched++; return `${quote}${entries[name].url}${quote}` })
      if (matched !== 1) throw new Error(`Expected one ${source} entry in ${htmlFile}, found ${matched}`)
    }
    await writeFile(filename, html)
  }
  return { directory, entries }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await buildPublic(), null, 2))
}
