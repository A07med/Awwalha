import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

export const statePrerender = { expiration: 1, allowQuery: [], passQuery: false }
export const outputConfig = {
  version: 3,
  routes: [
    { src: '/assets/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { handle: 'filesystem' },
    { src: '/api/(.*)', status: 404 },
    { src: '/(.*)', dest: '/index.html' },
  ],
}

export async function buildVercelOutput(root = process.cwd()) {
  const output = resolve(root, '.vercel/output')
  await mkdir(output, { recursive: true })
  await cp(resolve(root, 'dist'), resolve(output, 'static'), { recursive: true })
  await writeFile(resolve(output, 'config.json'), JSON.stringify(outputConfig))
  for (const name of ['state', 'time']) {
    const directory = resolve(output, `functions/api/${name}.func`)
    await mkdir(directory, { recursive: true })
    const files = name === 'state' ? ['state', 'public-snapshot'] : ['time']
    for (const file of files) {
      const source = await readFile(resolve(root, `api/${file}.ts`), 'utf8')
      const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace("'./public-snapshot'", "'./public-snapshot.js'")
      await writeFile(resolve(directory, `${file}.js`), js)
    }
    if (name === 'state') {
      // Native ISR is a prerendered Node function; ordinary Edge functions do
      // not activate the shared prerender layer/request collapsing.
      await writeFile(resolve(directory, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.cjs', launcherType: 'Nodejs', shouldAddHelpers: true }))
      await writeFile(resolve(directory, 'package.json'), JSON.stringify({ type: 'module' }))
      await writeFile(resolve(directory, 'index.cjs'), `module.exports = async function (_req, res) {
  const { default: generate } = await import('./state.js');
  const response = await generate();
  res.statusCode = response.status;
  for (const [key, value] of response.headers) res.setHeader(key, value);
  res.end(await response.text());
};\n`)
      await writeFile(resolve(dirname(directory), 'state.prerender-config.json'), JSON.stringify(statePrerender))
    } else {
      await writeFile(resolve(directory, '.vc-config.json'), JSON.stringify({ runtime: 'edge', entrypoint: `${name}.js`, envVarsInUse: [] }))
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) await buildVercelOutput()
