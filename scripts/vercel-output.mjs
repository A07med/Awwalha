import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { randomBytes } from 'node:crypto'

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
  const bypassToken = randomBytes(32).toString('hex')
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
      await writeFile(resolve(dirname(directory), 'state.prerender-config.json'), JSON.stringify({ ...statePrerender, bypassToken }))
    } else {
      await writeFile(resolve(directory, '.vc-config.json'), JSON.stringify({ runtime: 'edge', entrypoint: `${name}.js`, envVarsInUse: [] }))
    }
  }
  const publisher = resolve(output, 'functions/api/publish-state.func')
  await mkdir(publisher, { recursive: true })
  const source = await readFile(resolve(root, 'api/publish-state.ts'), 'utf8')
  await writeFile(resolve(publisher, 'publish-state.js'), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
  await writeFile(resolve(publisher, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(resolve(publisher, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.cjs', launcherType: 'Nodejs', shouldAddHelpers: true }))
  await writeFile(resolve(publisher, 'index.cjs'), `module.exports = async function (req, res) {
  const { default: publish } = await import('./publish-state.js');
  let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) { res.statusCode = 413; res.end(); return; } }
  const request = new Request('https://internal/api/publish-state', { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body } : {}) });
  const response = await publish(request, ${JSON.stringify(bypassToken)});
  res.statusCode = response.status; for (const [key, value] of response.headers) res.setHeader(key, value);
  res.end(await response.text());
};\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) await buildVercelOutput()
