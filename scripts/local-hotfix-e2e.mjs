// Small, state-changing functional test. Hard-locked to LOCAL Supabase.
// No cloud URLs, load, schema changes, or resets. Fixtures remain local.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import ts from 'typescript'

const config = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }))
const base = config.API_URL
assert.equal(base, 'http://127.0.0.1:55321', 'Never run against a remote project')
assert.equal(new URL(config.DB_URL).hostname, '127.0.0.1')
const sql = (query) => execFileSync('docker', ['exec', '-i', 'supabase_db_awwalha-live', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-At'], { input: query, encoding: 'utf8' }).trim()
assert.equal(sql('select count(*) from public.game_winners;'), '0', 'Use a clean LOCAL fixture database: existing winners must not be reset/overwritten by this test')
const key = config.ANON_KEY
const realFetch = globalThis.fetch
const request = async (path, body, bearer = key, apiKey = key) => {
  const response = await realFetch(base + path, { method: 'POST', headers: { authorization: 'Bearer ' + bearer, apikey: apiKey, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw new Error(`${path}: ${result.message ?? result.msg ?? response.status}`)
  return result
}
const email = `hotfix-${randomUUID()}@awwalha.test`
const password = randomBytes(24).toString('hex')
const user = await request('/auth/v1/admin/users', { email, password, email_confirm: true }, config.SERVICE_ROLE_KEY, config.SERVICE_ROLE_KEY)
sql(`insert into public.admin_profiles(user_id,display_name) values ('${user.id}', 'Local Hotfix');`)
const session = await request('/auth/v1/token?grant_type=password', { email, password })
const admin = (name, args = {}) => request('/rest/v1/rpc/' + name, { ...args, ...(name.startsWith('admin_') && !['admin_round_status', 'admin_round_detail'].includes(name) ? { p_request_id: randomUUID() } : {}) }, session.access_token)
const participant = (name, args) => request('/rest/v1/rpc/' + name, args)
const state = () => participant('public_event_state', {})
await admin('admin_set_registration', { p_open: true })
const people = []
for (let i = 0; i < 4; i++) {
  const phone = '+9689' + String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000000).padStart(7, '0')
  const recovery = randomBytes(4).toString('hex').toUpperCase()
  people.push(await participant('register_participant', { p_display_name: 'اختبار محلي ' + i, p_phone: phone, p_session_token: randomBytes(32).toString('hex'), p_recovery_code: recovery.slice(0, 4) + '-' + recovery.slice(4) }))
}
const source = ts.transpileModule(readFileSync('api/publish-state.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { default: publish } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
process.env.SUPABASE_URL = base
process.env.SUPABASE_ANON_KEY = key
process.env.VERCEL_ENV = 'production'
process.env.VERCEL_PROJECT_PRODUCTION_URL = 'local-isr.vercel.app'
process.env.VERCEL_URL = 'protected-deployment.vercel.app'
// Only the Vercel ISR transport is simulated. Auth/RPC/state are real local HTTP.
// ISR itself is separately exercised by the deployed Preview.
globalThis.fetch = async (url, options) => {
  if (url === 'https://local-isr.vercel.app/api/state') {
    assert.equal(options.redirect, 'manual')
    assert.equal(options.headers['x-prerender-revalidate'], 'local-private-token')
    return Response.json(await state())
  }
  assert.ok(String(url).startsWith(base + '/'), 'No external test writes/fetches')
  return realFetch(url, options)
}
async function publication(roundId) {
  const req = (token) => new Request('https://local/api/publish-state', { method: 'POST', headers: token ? { authorization: 'Bearer ' + token, 'content-type': 'application/json' } : {}, body: JSON.stringify({ roundId }) })
  const authorized = await publish(req(session.access_token), 'local-private-token')
  assert.equal(authorized.status, 200); assert.deepEqual(await authorized.json(), { published: true })
  assert.equal((await publish(req(null), 'local-private-token')).status, 401)
  assert.equal((await publish(req(key), 'local-private-token')).status, 403)
  console.log('LOCAL publication: authorized 200 published=true; anonymous 401; non-admin 403 (ISR transport simulated)')
}
async function waitUntil(time) {
  const delay = Math.max(0, Date.parse(time) - Date.now() + 80)
  assert.ok(delay < 20000)
  await new Promise((resolve) => setTimeout(resolve, delay))
}
async function submit(game, roundId, person, value) {
  return participant(game === 'perfect_second' ? 'submit_perfect_second' : 'submit_first_look', game === 'perfect_second'
    ? { p_round_id: roundId, p_session_token: person.token, p_elapsed_ms: value, p_timing_metadata: { localFunctionalTest: true } }
    : { p_round_id: roundId, p_session_token: person.token, p_guess: value })
}
async function finishRound(roundId) {
  await admin('admin_close_round', { p_round_id: roundId })
  const closed = await state(); assert.equal(closed.round.phase, 'closed')
  await waitUntil(new Date(Date.parse(closed.round.closesAt) + 3100).toISOString())
  return admin('admin_resolve_round', { p_round_id: roundId })
}
for (const game of ['perfect_second', 'first_look']) {
  const round = await admin('admin_prepare_round', { p_game_type: game, p_winner_target_count: 1, p_target_ms: game === 'perfect_second' ? 1000 : null, p_hide_timer_after_ms: game === 'perfect_second' ? 500 : null, p_correct_count: game === 'first_look' ? 36 : null, p_visual_seed: game === 'first_look' ? 123 : null, p_visual_category: game === 'first_look' ? 'leaves' : null, p_display_duration_ms: game === 'first_look' ? 1500 : null })
  await publication(round.roundId)
  assert.equal((await state()).phase, 'preparing')
  await waitUntil(round.startsAt)
  assert.equal((await state()).phase, 'active')
  const value = game === 'perfect_second' ? 1000 : 36
  for (const [i, person] of people.slice(0, 2).entries()) {
    await submit(game, round.roundId, person, value)
    assert.equal((await admin('admin_round_status', { p_round_id: round.roundId })).submittedCount, i + 1)
  }
  await assert.rejects(() => submit(game, round.roundId, people[0], value), /attempt_already_submitted/)
  const resolved = await finishRound(round.roundId)
  assert.equal(resolved.tiedCount, 2); assert.equal(resolved.remainingSeats, 1)
  assert.equal((await state()).phase, 'tie_break')
  const tie = await admin('admin_start_tie_break', { p_parent_round_id: round.roundId })
  await publication(tie.roundId)
  const tieState = await state()
  assert.equal(tieState.tieEligiblePublicIds.length, 2)
  await waitUntil(tieState.round.startsAt)
  const tieValue = game === 'perfect_second' ? tieState.round.targetMs : (await admin('admin_round_detail', { p_round_id: tie.roundId })).correctCount
  await submit(game, tie.roundId, people[0], tieValue)
  await submit(game, tie.roundId, people[1], tieValue + 10)
  assert.equal((await admin('admin_round_status', { p_round_id: tie.roundId })).submittedCount, 2)
  const final = await finishRound(tie.roundId)
  assert.equal(final.tiedCount, 0)
  assert.equal((await state()).phase, 'resolved')
  await assert.rejects(() => admin('admin_start_tie_break', { p_parent_round_id: tie.roundId }), /no_tie_break_needed/)
  await admin('admin_reveal_winners', { p_round_id: tie.roundId })
  const revealed = await state(); assert.equal(revealed.phase, 'revealed'); assert.equal(revealed.winners.length, 1)
  assert.equal(revealed.winners[0].participantPublicId, people[0].participantPublicId)
  console.log(`${game}: prepare/publish/scheduled activation/counts/duplicate rejection/close/resolve/conditional tie/reveal PASS`)
}
const wahaj = await admin('admin_prepare_taif')
for (const [i, person] of people.entries()) {
  const ready = await participant('join_taif_round', { p_round_id: wahaj.roundId, p_session_token: person.token })
  assert.equal(ready.ready, true)
  assert.equal((await admin('admin_round_status', { p_round_id: wahaj.roundId })).submittedCount, i + 1)
}
assert.equal((await participant('join_taif_round', { p_round_id: wahaj.roundId, p_session_token: people[0].token })).alreadyReady, true)
assert.equal((await admin('admin_round_status', { p_round_id: wahaj.roundId })).submittedCount, 4)
const started = await admin('admin_start_taif', { p_round_id: wahaj.roundId })
assert.equal((await state()).taifWinners.length, 0)
await waitUntil(started.revealAt)
const revealed = await state()
assert.equal(revealed.taifWinners.length, 4)
for (const color of ['green', 'yellow']) assert.equal(revealed.taifWinners.filter((w) => w.color === color).length, 2)
for (const winner of revealed.taifWinners) assert.deepEqual(Object.keys(winner).sort(), ['color', 'participantPublicId'])
assert.equal(new Set(revealed.taifWinners.map((w) => w.participantPublicId)).size, 4)
console.log('wahaj: readiness counts 1/2/3/4, idempotency, exactly 4 unique winners 2/2, pre-reveal privacy PASS')
globalThis.fetch = realFetch
console.log('LOCAL HOTFIX E2E PASS; cloud database untouched; no load tests')
