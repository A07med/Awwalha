// Docker Desktop cannot bind-mount this workspace. Stream repository tests
// directly to LOCAL psql, with fixture isolation inside their rolled-back tx.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }))
assert.equal(status.DB_URL, 'postgresql://postgres:postgres@127.0.0.1:55322/postgres')
let total = 0
for (const file of readdirSync('supabase/tests').filter((f) => f.endsWith('.test.sql')).sort()) {
  const source = readFileSync('supabase/tests/' + file, 'utf8')
  assert.ok(source.startsWith('begin;') && source.trim().endsWith('rollback;'))
  const fixture = source.replace('begin;', `begin;
    truncate public.participants, public.game_rounds, public.admin_profiles, public.admin_action_log cascade;
    insert into public.event_state(singleton) values (true);
  `)
  const output = execFileSync('docker', ['exec', '-i', 'supabase_db_awwalha-live', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-At'], { input: fixture, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  const count = Number(output.match(/1\.\.(\d+)/)?.[1])
  const passed = output.split('\n').filter((line) => /^ok \d+\b/.test(line)).length
  if (/^not ok/m.test(output) || !count || passed !== count) { console.error(output); throw new Error('pgTAP failed: ' + file) }
  total += count
  console.log(`${file}: ${passed}/${count} PASS (rolled back)`)
}
console.log(`PGTAP: ${total}/${total} PASS; LOCAL ONLY`)
