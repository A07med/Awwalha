import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes, randomUUID } from 'node:crypto'
import { scheduledInteractionActive } from '../src/lib/scheduled-activation.ts'

const run = promisify(execFile)
// Verify deployment metadata (target=null, staging, expected SHA) before running.
const base = process.env.PREVIEW_URL
const supabase = 'https://segymjevvgjywvqqjgyk.supabase.co'
const cookie = process.env.PREVIEW_COOKIE
const anon = process.env.SUPABASE_ANON_KEY
const adminId = '11111111-2222-3333-4444-555555555555'
let adminBearer
const mode = process.argv[2]
if (!cookie || !anon || !base || !/^https:\/\/awwalha-[a-z0-9]+-ahmeds-projects-829f0693\.vercel\.app$/.test(base)) throw new Error('Missing/unsafe staging-only test configuration')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const percentile = (values, p) => values.length ? Math.round([...values].sort((a,b) => a-b)[Math.min(values.length-1, Math.ceil(values.length*p)-1)] * 10)/10 : null
const summarize = (records) => ({
  total: records.length,
  success: records.filter((r) => r.ok).length,
  p50: percentile(records.filter((r) => r.ok).map((r) => r.ms), .5),
  p95: percentile(records.filter((r) => r.ok).map((r) => r.ms), .95),
  p99: percentile(records.filter((r) => r.ok).map((r) => r.ms), .99),
  max: percentile(records.filter((r) => r.ok).map((r) => r.ms), 1),
  statuses: Object.fromEntries([...new Set(records.map((r) => String(r.status)))].map((status) => [status, records.filter((r) => String(r.status) === status).length])),
})

async function db(sql) {
  const { stdout } = await run('supabase', ['db', 'query', '--linked', sql], {
    cwd: process.env.TEST_WORKDIR,
    timeout: 60000,
    maxBuffer: 1000000,
  })
  return JSON.parse(stdout.slice(stdout.indexOf('{'))).rows
}
async function stateSqlStats() {
  return (await db("select calls,total_exec_time from extensions.pg_stat_statements where queryid=6254495689674358618"))[0]
}
async function registrationSqlStats() {
  return (await db("select calls,total_exec_time from extensions.pg_stat_statements where queryid=-3933188430283882512"))[0]
}
async function gameSqlStats(queryid) {
  return (await db(`select calls,total_exec_time from extensions.pg_stat_statements where queryid=${queryid}`))[0]
}
async function baselineState() {
  return (await db("select state_version,registration_open,public_phase,current_round_id,updated_at from public.event_state where singleton=true"))[0]
}
async function openRegistration() {
  await db("update public.event_state set registration_open=true,state_version=state_version+1,updated_at=statement_timestamp() where singleton=true; select true as opened")
}
async function cleanupRegistrations(phoneBase, baseline) {
  const lo = '+968' + phoneBase
  const hi = '+968' + (phoneBase + 499)
  const round = baseline.current_round_id ? `'${baseline.current_round_id}'::uuid` : 'null'
  await db(`begin; delete from public.participants where phone_e164 between '${lo}' and '${hi}' and display_name like 'LOADTEST-FINAL-%'; update public.event_state set state_version=${baseline.state_version},registration_open=${baseline.registration_open},public_phase='${baseline.public_phase}',current_round_id=${round},updated_at='${baseline.updated_at}'::timestamptz where singleton=true; commit; select count(*) as remaining from public.participants where phone_e164 between '${lo}' and '${hi}'`)
}
async function registrationCounts(phoneBase, count = 500) {
  const lo = '+968' + phoneBase
  const hi = '+968' + (phoneBase + count - 1)
  return (await db(`select (select count(*) from public.participants where phone_e164 between '${lo}' and '${hi}') as participants,(select count(*) from public.participant_sessions s join public.participants p on p.id=s.participant_id where p.phone_e164 between '${lo}' and '${hi}') as sessions,(select count(*) from public.participant_recovery r join public.participants p on p.id=r.participant_id where p.phone_e164 between '${lo}' and '${hi}') as recovery`))[0]
}

function credentials(phoneBase, i, phase) {
  const raw = randomBytes(4).toString('hex').toUpperCase()
  return {
    p_display_name: `LOADTEST-FINAL-${phase}-${i}`,
    p_phone: '+968' + (phoneBase + i),
    p_session_token: randomBytes(32).toString('hex'),
    p_recovery_code: raw.slice(0, 4) + '-' + raw.slice(4),
  }
}

async function previewRequest(path, expectJson = false) {
  const started = performance.now()
  try {
    const response = await fetch(base + path, { headers: { cookie, accept: expectJson ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(35000) })
    const text = await response.text()
    const valid = expectJson ? text.startsWith('{') && text.includes('"registrationOpen"') : text.includes('<html') && text.includes('/assets/')
    const value = expectJson && valid ? JSON.parse(text) : undefined
    return { ok: response.ok && valid, status: response.status, ms: performance.now() - started, cache: response.headers.get('x-vercel-cache'), delivery: response.headers.get('x-awwalha-state-delivery'), snapshotAt: response.headers.get('x-awwalha-snapshot-at'), valid, value }
  } catch (error) {
    return { ok: false, status: 'NETWORK', ms: performance.now() - started, error: error?.name }
  }
}

async function supabaseRpc(name, args) {
  const started = performance.now()
  try {
    const response = await fetch(supabase + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: anon, authorization: 'Bearer ' + anon, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(35000),
    })
    const value = await response.json().catch(() => null)
    return { ok: response.ok, status: response.status, ms: performance.now() - started, value, code: value?.code }
  } catch (error) {
    return { ok: false, status: 'NETWORK', ms: performance.now() - started, error: error?.name }
  }
}

async function stateOnly() {
  const before = await stateSqlStats()
  const start = performance.now()
  const site = []
  const states = []
  const clients = Array.from({ length: 500 }, (_, i) => (async () => {
    await sleep(Math.random() * 2000)
    site.push(await previewRequest(i % 2 ? '/play' : '/join'))
    while (performance.now() - start < 28000) {
      states.push(await previewRequest('/api/state', true))
      const elapsed = performance.now() - start
      if (i % 10 === 0 && elapsed >= 8000 && elapsed <= 16000) await sleep(16000 - elapsed)
      await sleep(6000 + Math.random() * 4000)
    }
  })())
  await Promise.all(clients)
  const after = await stateSqlStats()
  const result = {
    mode: 'state-only',
    site: summarize(site),
    state: summarize(states),
    cache: Object.fromEntries([...new Set(states.map((r) => String(r.cache)))].map((key) => [key, states.filter((r) => String(r.cache) === key).length])),
    publicStateRpcCalls: Number(after.calls) - Number(before.calls),
    publicStateSqlMs: Number(after.total_exec_time) - Number(before.total_exec_time),
    durationMs: performance.now() - start,
  }
  console.log(JSON.stringify(result))
}

async function compareState() {
  const before = await stateSqlStats()
  const vercel = []
  const direct = []
  await Promise.all(Array.from({ length: 100 }, async () => {
    await sleep(Math.random() * 2000)
    const [a, b] = await Promise.all([
      previewRequest('/api/state', true),
      supabaseRpc('public_event_state', {}),
    ])
    vercel.push(a)
    direct.push(b)
  }))
  const after = await stateSqlStats()
  console.log(JSON.stringify({ mode: 'compare-state', vercel: summarize(vercel), direct: summarize(direct), publicStateRpcCalls: Number(after.calls)-Number(before.calls), publicStateSqlMs: Number(after.total_exec_time)-Number(before.total_exec_time) }))
}

async function registrationOnly() {
  const phoneBase = 99803000
  const baseline = await baselineState()
  if (baseline.registration_open || baseline.current_round_id || baseline.public_phase !== 'lobby') throw new Error('Staging baseline changed; refusing to write')
  const before = await registrationSqlStats()
  await openRegistration()
  try {
    const args = Array.from({ length: 500 }, (_, i) => credentials(phoneBase, i, 'B'))
    const results = await Promise.all(args.map(async (item) => {
      await sleep(Math.random() * 8000)
      return supabaseRpc('register_participant', item)
    }))
    const counts = await registrationCounts(phoneBase)
    const firstReplyDiscarded = results[0]
    const retry = await supabaseRpc('register_participant', args[0])
    const afterRetry = await registrationCounts(phoneBase)
    const after = await registrationSqlStats()
    console.log(JSON.stringify({
      mode: 'registration-only', registration: summarize(results), counts,
      idempotentRetry: firstReplyDiscarded.ok && retry.ok && retry.value?.token === args[0].p_session_token && retry.value?.participantPublicId === firstReplyDiscarded.value?.participantPublicId && afterRetry.participants === counts.participants && afterRetry.sessions === counts.sessions,
      retryStatus: retry.status, afterRetry,
      registerRpcCalls: Number(after.calls) - Number(before.calls),
      registerSqlMs: Number(after.total_exec_time) - Number(before.total_exec_time),
      sql57014: results.filter((r) => r.code === '57014').length,
      tooManyConnections: results.filter((r) => String(r.value?.message ?? '').includes('too_many_connections')).length,
    }))
  } finally {
    await cleanupRegistrations(phoneBase, baseline)
    console.log(JSON.stringify({ mode: 'registration-only', cleanup: true }))
  }
}

async function combined() {
  const phoneBase = 99804000
  const baseline = await baselineState()
  if (baseline.registration_open || baseline.current_round_id || baseline.public_phase !== 'lobby') throw new Error('Staging baseline changed; refusing to write')
  const stateBefore = await stateSqlStats()
  const registerBefore = await registrationSqlStats()
  await openRegistration()
  try {
    const start = performance.now()
    const site = []
    const states = []
    const registrations = []
    await Promise.all(Array.from({ length: 500 }, (_, i) => (async () => {
      await sleep(Math.random() * 2000)
      site[i] = await previewRequest(i % 2 ? '/play' : '/join')
      const poll = (async () => {
        while (performance.now() - start < 30000) {
          states.push(await previewRequest('/api/state', true))
          await sleep(6000 + Math.random() * 4000)
        }
      })()
      const register = (async () => {
        await sleep(Math.random() * 8000)
        registrations[i] = await supabaseRpc('register_participant', credentials(phoneBase, i, 'C'))
      })()
      await Promise.all([poll, register])
    })()))
    const counts = await registrationCounts(phoneBase)
    const stateAfter = await stateSqlStats()
    const registerAfter = await registrationSqlStats()
    const all = [...site, ...states, ...registrations]
    console.log(JSON.stringify({
      mode: 'combined', site: summarize(site), state: summarize(states), registration: summarize(registrations), counts,
      cache: Object.fromEntries([...new Set(states.map((r) => String(r.cache)))].map((key) => [key, states.filter((r) => String(r.cache) === key).length])),
      publicStateRpcCalls: Number(stateAfter.calls) - Number(stateBefore.calls),
      publicStateSqlMs: Number(stateAfter.total_exec_time) - Number(stateBefore.total_exec_time),
      registerRpcCalls: Number(registerAfter.calls) - Number(registerBefore.calls),
      registerSqlMs: Number(registerAfter.total_exec_time) - Number(registerBefore.total_exec_time),
      status503: all.filter((r) => r.status === 503).length,
      status504: all.filter((r) => r.status === 504).length,
      sql57014: registrations.filter((r) => r.code === '57014').length,
      durationMs: performance.now() - start,
    }))
  } finally {
    await cleanupRegistrations(phoneBase, baseline)
    console.log(JSON.stringify({ mode: 'combined', cleanup: true }))
  }
}

async function admin(sql) {
  const value = (await db(`select set_config('request.jwt.claims','{"sub":"${adminId}","role":"authenticated"}',false); ${sql}`))[0]?.value
  if (sql.includes('admin_prepare_round(') && mode !== 'diagnostic750') {
    const started = performance.now()
    const response = await fetch(base + '/api/publish-state', { method: 'POST', headers: { cookie, authorization: 'Bearer ' + adminBearer, 'content-type': 'application/json' }, body: JSON.stringify({ roundId: value.roundId }), signal: AbortSignal.timeout(6000) })
    const publication = await response.json()
    console.log(JSON.stringify({ phase: 'scheduled-publication', status: response.status, published: publication.published, ms: performance.now()-started, leadMs: Date.parse(value.startsAt)-Date.now() }))
    if (!response.ok || !publication.published) throw new Error('Operator publication not confirmed')
  }
  return value
}
async function waitForClientRound(states, roundId, i, deadline, publicId) {
  while (Date.now() < deadline) {
    const s = states[i]
    if (s?.round?.id === roundId && (mode === 'diagnostic750'
      ? s.round.phase === 'active'
      : scheduledInteractionActive(s, roundId, Date.now() - Date.parse(s.round.startsAt), publicId))) return true
    await sleep(100)
  }
  return false
}
async function fullFlow(n, focused = false) {
  if (![500, 750, 1000, 1500, 2000].includes(n)) throw new Error('Unsupported full-flow tier')
  const phoneBase = { 500: 99700000, 750: 99701000, 1000: 99702000, 1500: 99704000, 2000: 99706000 }[n]
  const required = Math.ceil(n * .99)
  const baseline = await baselineState()
  if (baseline.registration_open || baseline.current_round_id || baseline.public_phase !== 'lobby') throw new Error('Staging baseline changed; refusing to write')
  const existing = (await db(`select (select count(*) from auth.users where id='${adminId}') as admins,(select count(*) from public.participants where phone_e164 between '+968${phoneBase}' and '+968${phoneBase+n-1}') as participants`))[0]
  if (existing.admins || existing.participants) throw new Error('Dedicated staging test identifiers already exist')
  const sqlBefore = {
    state: await stateSqlStats(), registration: await registrationSqlStats(),
    perfect: await gameSqlStats('8058985544151617663'), first: await gameSqlStats('3698518852598530345'), wahaj: await gameSqlStats('5641962653559054603'),
  }
  // Restore-to-baseline checks prevent a previous tier's cached higher version
  // from hydrating a new client before the next test begins.
  let warmed
  for (let i = 0; i < 8; i++) {
    warmed = await previewRequest('/api/state', true)
    if (warmed.ok && warmed.delivery === 'isr-v1' && warmed.value.stateVersion === baseline.state_version * 4 && warmed.value.phase === 'lobby') break
    await sleep(1000)
  }
  if (!warmed?.ok || warmed.delivery !== 'isr-v1' || warmed.value.stateVersion !== baseline.state_version * 4) throw new Error('Native ISR baseline is not verified; refusing load')
  let created = false
  let stopPoll = false
  let pollers = []
  const site = [], stateRecords = [], registrations = []
  const lastStates = Array(n).fill(null)
  const submitted = Array(n).fill(null)
  const ready = Array(n).fill(false)
  const observed = Array.from({ length: n }, () => new Map())
  const activations = Array.from({ length: n }, () => new Map())
  let activationTimer
  const cacheSummary = () => Object.fromEntries([...new Set(stateRecords.map((r) => String(r.cache)))].map((key) => [key, stateRecords.filter((r) => String(r.cache) === key).length]))
  const errorSummary = (records) => ({ status429: records.filter((r) => r.status === 429).length, fiveXX: records.filter((r) => typeof r.status === 'number' && r.status >= 500).length, status503: records.filter((r) => r.status === 503).length, status504: records.filter((r) => r.status === 504).length, status520: records.filter((r) => r.status === 520).length, status522: records.filter((r) => r.status === 522).length, sql57014: records.filter((r) => r.code === '57014').length, tooManyConnections: records.filter((r) => /too_many_connections|too many connections|remaining connection slots/i.test(String(r.value?.message ?? ''))).length })
  const args = Array.from({ length: n }, (_, i) => credentials(phoneBase, i, 'D'))
  try {
    const password = randomBytes(24).toString('hex')
    await db(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change_token_new,email_change) values ('${adminId}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','final-loadtest@awwalha.invalid',extensions.crypt('${password}',extensions.gen_salt('bf')),now(),'','','',''); insert into public.admin_profiles(user_id,display_name) values ('${adminId}','Final Preview Load Test'); select true as created`)
    created = true
    const auth = await fetch(supabase + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'final-loadtest@awwalha.invalid', password }), signal: AbortSignal.timeout(10000) })
    const signedIn = await auth.json()
    if (!auth.ok || !signedIn.access_token) throw new Error('Temporary staging admin could not authenticate: ' + (signedIn.error_code ?? auth.status))
    adminBearer = signedIn.access_token
    await admin(`select public.admin_set_registration(true,'${randomUUID()}'::uuid) as value`)
    console.log(JSON.stringify({ phase: 'full-site-start', tier: n, at: new Date().toISOString() }))
    await Promise.all(Array.from({ length: n }, (_, i) => (async () => {
      await sleep(Math.random() * 2000)
      site[i] = await previewRequest(i % 2 ? '/play' : '/join')
    })()))
    pollers = Array.from({ length: n }, (_, i) => (async () => {
      while (!stopPoll) {
        const r = await previewRequest('/api/state', true)
        stateRecords.push(r)
        if (r.ok && (!lastStates[i] || r.value.stateVersion > lastStates[i].stateVersion)) {
          lastStates[i] = r.value
          const incoming = r.value.round
          if (incoming) {
            const prior = observed[i].get(incoming.id) ?? { firstSeenAt: Date.now(), startsAt: incoming.startsAt, firstPhase: incoming.phase }
            if (incoming.phase === 'active' && !prior.activeAt) prior.activeAt = Date.now()
            observed[i].set(incoming.id, prior)
          }
        }
        const round = lastStates[i]?.round
        while (!stopPoll && round && round.gameType !== 'taif' && submitted[i] !== round.id && lastStates[i]?.round?.id === round.id &&
          (mode === 'diagnostic750' ? round.phase === 'active' : scheduledInteractionActive(lastStates[i], round.id, Date.now() - Date.parse(round.startsAt), registrations[i]?.value?.participantPublicId ?? ''))) await sleep(150)
        const phase = lastStates[i]?.phase
        const isWahajReady = ready[i] && lastStates[i]?.currentGame === 'taif'
        const submittedCurrentRound = submitted[i] === round?.id
        const baseDelay = isWahajReady ? 1500 : submittedCurrentRound ? 7000 : phase === 'preparing' || phase === 'countdown' ? 2000 : 6000
        const span = isWahajReady ? 1000 : submittedCurrentRound ? 5000 : phase === 'preparing' || phase === 'countdown' ? 2000 : 4000
        await sleep(baseDelay + Math.random() * span)
      }
    })())
    activationTimer = setInterval(() => {
      for (let i = 0; i < n; i++) {
        const s = lastStates[i], round = s?.round
        if (round && !activations[i].has(round.id) && scheduledInteractionActive(s, round.id, Date.now() - Date.parse(round.startsAt), registrations[i]?.value?.participantPublicId ?? '')) {
          activations[i].set(round.id, { at: Date.now(), path: round.phase === 'active' ? 'server' : 'local' })
        }
      }
    }, 16)
    await Promise.all(args.map(async (item, i) => {
      await sleep(Math.random() * 8000)
      registrations[i] = await supabaseRpc('register_participant', item)
    }))
    const counts = await registrationCounts(phoneBase, n)
    const retry = await supabaseRpc('register_participant', args[0])
    const retryCounts = await registrationCounts(phoneBase, n)
    const idempotentRetry = retry.ok && retry.value?.participantPublicId === registrations[0]?.value?.participantPublicId && retry.value?.token === args[0].p_session_token && retryCounts.participants === counts.participants && retryCounts.sessions === counts.sessions
    console.log(JSON.stringify({ phase: 'full-registration', tier: n, site: summarize(site), registration: summarize(registrations), counts, state: summarize(stateRecords), at: new Date().toISOString() }))
    if (!idempotentRetry || summarize(site).success < required || summarize(registrations).success < required || counts.participants !== n || counts.sessions !== n || stateRecords.some((r) => !r.ok)) throw new Error('Full-flow registration/state gate failed')

    const perfectRound = await admin(`select public.admin_prepare_round('${randomUUID()}'::uuid,'perfect_second'::public.game_type,6::smallint,6000,1500,null::smallint,null::integer,null::text,null::integer) as value`)
    await sleep(Math.max(0, Date.parse(perfectRound.startsAt) - Date.now() + 6000))
    const perfect = await Promise.all(args.map(async (item, i) => {
      await sleep(Math.random() * 900)
      if (!(await waitForClientRound(lastStates, perfectRound.roundId, i, Date.parse(perfectRound.startsAt) + 7500, registrations[i]?.value?.participantPublicId))) return { ok: false, status: 'ROUND_NOT_VISIBLE', ms: 0 }
      submitted[i] = perfectRound.roundId
      return supabaseRpc('submit_perfect_second', { p_session_token: item.p_session_token, p_round_id: perfectRound.roundId, p_elapsed_ms: 6000 + i % 850, p_timing_metadata: { visibilityState: 'visible', clock: 'performance.now', loadTest: true } })
    }))
    console.log(JSON.stringify({ phase: 'full-perfect', tier: n, perfect: summarize(perfect), state: summarize(stateRecords), at: new Date().toISOString() }))
    const knowledge = perfect.map((r, i) => ({ client: i, success: r.ok, ...observed[i].get(perfectRound.roundId), activation: activations[i].get(perfectRound.roundId) }))
    const knewBefore = knowledge.filter((r) => r.firstSeenAt < Date.parse(perfectRound.startsAt)).length
    const local = knowledge.filter((r) => r.activation?.path === 'local').length
    const server = knowledge.filter((r) => r.activation?.path === 'server').length
    const attemptCounts = (await db(`select count(*)::integer attempts,count(distinct participant_id)::integer unique_participants from public.perfect_second_attempts where round_id='${perfectRound.roundId}'`))[0]
    console.log(JSON.stringify({ phase: 'activation-evidence', tier: n, startsAt: perfectRound.startsAt, knewBefore, unknownBefore: n-knewBefore, local, server, attemptCounts, failed: knowledge.filter((r) => !r.success), maxActivationDelayMs: Math.max(...knowledge.map((r) => r.activation ? r.activation.at-Date.parse(perfectRound.startsAt) : -1)) }))
    if (focused) {
      const after = await stateSqlStats()
      console.log(JSON.stringify({ phase: 'focused-result', pass: knewBefore === n && local+server === n && perfect.every((r) => r.ok) && attemptCounts.attempts === n && attemptCounts.unique_participants === n && stateRecords.every((r) => r.ok), active: local+server, local, server, knewBefore, submissions: summarize(perfect), state: summarize(stateRecords), upstreamCalls: Number(after.calls)-Number(sqlBefore.state.calls), errors: errorSummary([...site,...registrations,...perfect,...stateRecords]) }))
      return
    }
    if (summarize(perfect).success < required || stateRecords.some((r) => !r.ok)) throw new Error('Full-flow Perfect Second/state gate failed')
    await admin(`select public.admin_close_round('${perfectRound.roundId}'::uuid,'${randomUUID()}'::uuid) as value`)
    await sleep(3300)
    await admin(`select public.admin_resolve_round('${perfectRound.roundId}'::uuid,'${randomUUID()}'::uuid) as value`)
    await admin(`select public.admin_reveal_winners('${perfectRound.roundId}'::uuid,'${randomUUID()}'::uuid) as value`)

    const firstRound = await admin(`select public.admin_prepare_round('${randomUUID()}'::uuid,'first_look'::public.game_type,6::smallint,null::integer,null::integer,47::smallint,12345,'seeds',3000) as value`)
    await sleep(Math.max(0, Date.parse(firstRound.startsAt) - Date.now() + 3500))
    const first = await Promise.all(args.map(async (item, i) => {
      await sleep(Math.random() * 900)
      if (!(await waitForClientRound(lastStates, firstRound.roundId, i, Date.parse(firstRound.startsAt) + 10000, registrations[i]?.value?.participantPublicId))) return { ok: false, status: 'ROUND_NOT_VISIBLE', ms: 0 }
      submitted[i] = firstRound.roundId
      return supabaseRpc('submit_first_look', { p_session_token: item.p_session_token, p_round_id: firstRound.roundId, p_guess: i < 6 ? 47 + i : 100 + i % 900 })
    }))
    console.log(JSON.stringify({ phase: 'full-first', tier: n, first: summarize(first), state: summarize(stateRecords), at: new Date().toISOString() }))
    if (summarize(first).success < required || stateRecords.some((r) => !r.ok)) throw new Error('Full-flow First Look/state gate failed')
    await admin(`select public.admin_close_round('${firstRound.roundId}'::uuid,'${randomUUID()}'::uuid) as value`)
    await sleep(3300)
    await admin(`select public.admin_resolve_round('${firstRound.roundId}'::uuid,'${randomUUID()}'::uuid) as value`)
    await admin(`select public.admin_reveal_winners('${firstRound.roundId}'::uuid,'${randomUUID()}'::uuid) as value`)

    const taifRound = await admin(`select public.admin_prepare_taif('${randomUUID()}'::uuid) as value`)
    const waitReady = Date.now() + 18000
    while (Date.now() < waitReady && lastStates.filter((s) => s?.round?.id === taifRound.roundId).length < n) await sleep(200)
    const wahaj = await Promise.all(args.map(async (item, i) => {
      await sleep(Math.random() * 900)
      if (lastStates[i]?.round?.id !== taifRound.roundId) return { ok: false, status: 'ROUND_NOT_VISIBLE', ms: 0 }
      ready[i] = true
      return supabaseRpc('join_taif_round', { p_session_token: item.p_session_token, p_round_id: taifRound.roundId })
    }))
    console.log(JSON.stringify({ phase: 'full-wahaj', tier: n, wahaj: summarize(wahaj), state: summarize(stateRecords), at: new Date().toISOString() }))
    if (summarize(wahaj).success < required || stateRecords.some((r) => !r.ok)) throw new Error('Full-flow Wahaj/state gate failed')
    const started = await admin(`select public.admin_start_taif('${taifRound.roundId}'::uuid,'${randomUUID()}'::uuid) as value`)
    const beforeReveal = await previewRequest('/api/state', true)
    await sleep(Math.max(0, Date.parse(started.revealAt) - Date.now()))
    // Same reveal refresh as the participant hook: one request, 0–300ms jitter,
    // existing regular polls remain in place. No direct per-user state RPC.
    const revealRefreshes = await Promise.all(Array.from({ length: n }, async (_, i) => {
      await sleep(Math.random() * 300)
      const r = await previewRequest('/api/state', true)
      stateRecords.push(r)
      if (r.ok && (!lastStates[i] || r.value.stateVersion > lastStates[i].stateVersion)) lastStates[i] = r.value
      return r
    }))
    let afterReveal = await previewRequest('/api/state', true)
    for (let i = 0; i < 5 && afterReveal.value?.taifWinners?.length !== 4; i++) { await sleep(1000); afterReveal = await previewRequest('/api/state', true) }
    const colors = afterReveal.value?.taifWinners?.map((x) => x.color) ?? []
    const privacy = beforeReveal.value?.taifWinners?.length === 0 && colors.length === 4 && colors.filter((c) => c === 'green').length === 2 && colors.filter((c) => c === 'yellow').length === 2 && afterReveal.value.taifWinners.every((w) => !('displayName' in w) && !('phone' in w))
    const attempts = (await db(`select (select count(*) from public.perfect_second_attempts where round_id='${perfectRound.roundId}') as perfect,(select count(*) from public.first_look_attempts where round_id='${firstRound.roundId}') as first,(select count(*) from public.taif_ready where round_id='${taifRound.roundId}') as wahaj`))[0]
    const sqlAfter = { state: await stateSqlStats(), registration: await registrationSqlStats(), perfect: await gameSqlStats('8058985544151617663'), first: await gameSqlStats('3698518852598530345'), wahaj: await gameSqlStats('5641962653559054603') }
    const sql = Object.fromEntries(Object.keys(sqlBefore).map((k) => [k, { calls: Number(sqlAfter[k].calls)-Number(sqlBefore[k].calls), ms: Number(sqlAfter[k].total_exec_time)-Number(sqlBefore[k].total_exec_time) }]))
    const all = [...site, ...stateRecords, ...registrations, ...perfect, ...first, ...wahaj, beforeReveal, afterReveal]
    const errors = errorSummary(all)
    const pass = privacy && attempts.perfect === n && attempts.first === n && attempts.wahaj === n && errors.fiveXX === 0 && errors.sql57014 === 0 && errors.tooManyConnections === 0 && [site, registrations, perfect, first, wahaj].every((records) => summarize(records).success >= required)
    console.log(JSON.stringify({ phase: 'full-result', tier: n, pass, site: summarize(site), state: summarize(stateRecords), cache: cacheSummary(), amplification: stateRecords.length / sql.state.calls, registration: summarize(registrations), perfect: summarize(perfect), first: summarize(first), wahaj: summarize(wahaj), reveal: summarize(revealRefreshes), privacy, idempotentRetry, attempts, sql, errors }))
  } catch (error) {
    const after = await stateSqlStats()
    console.log(JSON.stringify({ phase: 'full-failed', tier: n, reason: String(error?.message ?? error), site: summarize(site), state: summarize(stateRecords), cache: cacheSummary(), upstreamStateCalls: Number(after.calls) - Number(sqlBefore.state.calls), upstreamStateSqlMs: Number(after.total_exec_time) - Number(sqlBefore.state.total_exec_time), registration: summarize(registrations), errors: errorSummary([...site, ...stateRecords, ...registrations]) }))
  } finally {
    adminBearer = undefined
    clearInterval(activationTimer)
    stopPoll = true
    await Promise.all(pollers)
    if (created) {
      const round = baseline.current_round_id ? `'${baseline.current_round_id}'::uuid` : 'null'
      await db(`begin; update public.event_state set current_round_id=${round},public_phase='${baseline.public_phase}',registration_open=${baseline.registration_open},state_version=${baseline.state_version},updated_at='${baseline.updated_at}'::timestamptz where singleton=true; delete from public.admin_action_log where admin_id='${adminId}'; delete from public.game_rounds where created_by='${adminId}'; delete from public.participants where phone_e164 between '+968${phoneBase}' and '+968${phoneBase+n-1}' and display_name like 'LOADTEST-FINAL-%'; delete from public.admin_profiles where user_id='${adminId}'; delete from auth.users where id='${adminId}'; commit; select (select count(*) from public.participants) participants,(select count(*) from public.game_rounds) rounds,(select count(*) from auth.users where id='${adminId}') test_admins`)
    }
    console.log(JSON.stringify({ phase: 'full-cleanup', tier: n, created }))
  }
}

if (mode === 'state') await stateOnly()
else if (mode === 'compare') await compareState()
else if (mode === 'registration') await registrationOnly()
else if (mode === 'combined') await combined()
else if (mode === 'full500') await fullFlow(500)
else if (mode === 'full750') await fullFlow(750)
else if (mode === 'diagnostic750') await fullFlow(750, true)
else if (mode === 'focused750') await fullFlow(750, true)
else if (mode === 'full1000') await fullFlow(1000)
else if (mode === 'full1500') await fullFlow(1500)
else if (mode === 'full2000') await fullFlow(2000)
else throw new Error('Unsupported mode: ' + mode)
