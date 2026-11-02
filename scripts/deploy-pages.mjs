import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildPublic } from './build-public.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifact = await buildPublic()
console.log('Production assets:', JSON.stringify(artifact))
const child = spawn(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'pages', 'deploy', artifact.directory, '--project-name=image-translator', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
