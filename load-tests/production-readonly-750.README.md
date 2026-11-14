# Owner-run Production read-only test (macOS)

This script has **not** been run against Production by Codex. It never loads
HTML/assets or calls Supabase, registration, authentication, or mutation RPCs.
The URL is fixed; redirects are disabled. No keys or credentials are needed.

## Verified client behavior

Inspected repository HEAD: `260bb338d74daa91c35cabf0c9a377539a539c24`.

- `src/hooks/use-public-state.ts`: initial state refresh immediately; subsequent
  polls wait `Math.round(6000 + Math.random() * 4000)` ms **after completion**.
  One in-flight request at a time. Failures increase the delay by 2x, then 4x
  maximum. This safety test stops on the first failure instead of retrying it.
- Hidden documents cancel the timer/abort the request. Becoming visible refreshes
  immediately and restarts polling. This test keeps all VUs visible, a conservative
  upper bound; it does not invent visibility events or retry storms.
- Preparing/countdown: 2–4 seconds; submitted: 7–12 seconds; Wahaj ready/active:
  1.5–2.5 seconds. Timing-critical non-Wahaj play pauses polling. These are **not
  idle traffic**: the script stops if a round appears or the event leaves Lobby.
- `src/pages/play.tsx` and `src/hooks/use-clock-sync.ts`: clock sync is enabled by
  `Boolean(round?.startsAt)`, not by entering idle `/play`. On enable: 300–2500 ms
  jitter, then three `/api/time` samples; samples 2/3 wait 120–400 ms after the
  preceding response. The effect depends on the enabled boolean, not a periodic
  timer or every round ID. There are **zero idle audience time requests**.
- `src/lib/api.ts`, `src/lib/session.ts`, `src/App.tsx`, and
  `src/hooks/use-private-tie-eligibility.ts`: participant identity/recovery data
  are read locally; tie capability hashing is local. No additional participant
  read RPC is scheduled in normal idle flow. A previously signed-in operator's
  Supabase Auth session can auto-refresh independently; that is not simulated
  as participant traffic and needs no participant key here.

## Before running

1. In Vercel, independently verify that `awwalha.vercel.app` points to the exact
   SHA above. `CONFIRMED_SHA` is an **owner acknowledgement**, not API verification.
2. Coordinate with the event owner. Run only while registration is CLOSED and
   the event is idle, with no current round. Do not run during the live event.
3. Keep Vercel and Supabase logs open. Stop with Ctrl+C if you see sustained
   5xx, 504, `57014`, or connection exhaustion. The script automatically aborts
   on a received non-200, invalid/fallback state, live-state change, or network
   failure. It cannot itself read privileged database logs.
4. Save the upstream RPC baseline immediately before the run. In the Supabase
   SQL editor, this **read-only** query reports successful tracked calls:

```sql
select clock_timestamp() as measured_at, coalesce(sum(calls), 0) as state_rpc_calls
from extensions.pg_stat_statements
where query like '%public_event_state%'
  and query not like '%pg_stat_statements%';
```

Repeat immediately after. Do not reset statistics. Confirm the matching queries
are the RPC entry queries, counters were not reset/evicted, and record background
traffic. The delta includes other callers in that window. Alternatively count
complete Supabase API logs for `/rest/v1/rpc/public_event_state`. Do not infer RPC
counts or database errors from HTTP 200/cache headers alone.

## Commands

Run from this repository's root. If necessary:

```sh
brew install k6
```

Default: **exact idle audience model**, with one `/api/time` setup health check
only (excluded from audience metrics).

```sh
mkdir -p load-tests/results
CONFIRMED_SHA=260bb338d74daa91c35cabf0c9a377539a539c24 \
  k6 run --summary-export=load-tests/results/production-750.json \
  load-tests/production-readonly-750.js
```

Optional, **separate supplementary test**: also measure `/api/time` using one
three-sample startup sync per VU (2250 audience time requests). This deliberately
adds clock traffic to Lobby; do not label it the actual idle model. Same safety
limits, not a second polling loop, no game starts required:

```sh
mkdir -p load-tests/results
CONFIRMED_SHA=260bb338d74daa91c35cabf0c9a377539a539c24 CLOCK_PROBE=1 \
  k6 run --summary-export=load-tests/results/production-750-clock.json \
  load-tests/production-readonly-750.js
```

The detailed `production-750-report.json` is overwritten each run: copy it before
running the optional test. It includes endpoint counts/success, HTTP status
distribution, HTTP p50/p95/p99, cache counts and separate reset/TLS/timeout/DNS/
connection errors. Full unbucketed HTTP status codes are also available through
k6's built-in `status` tags; use `--out json=load-tests/results/raw.json` if needed.

Each level 50 → 100 → 250 → 500 → 750 has a 15-second ramp followed by a
45-second hold (at least four typical idle polling cycles). Then 15 seconds to
ramp down, with up to 15 seconds graceful completion. Total approximately
**5 minutes 15 seconds**, up to **5 minutes 55 seconds including preflight/grace**.
No CLI `--vus`/`--duration` override: it would invalidate the intended shape.

## Verdict and server-log evidence

- Require full 750-VU hold completion, state success ≥99.9%, received server 5xx=0
  and no runner-network errors. An aborted/incomplete test proves no capacity.
- Thresholds: `http_req_failed < 0.1%`, state p95 <1000 ms; optional clock p95
  <1500 ms and time success ≥99.9%. Network failures remain availability failures
  but are **not counted as HTTP 5xx**. Slow p95 is a failed latency target, not
  permission to change the app. Default idle time results are N/A, not a fake PASS.
- Independently review the exact UTC test window in Vercel/Supabase for 429,
  500, 502, 503, 504, 520, 522, `57014`, and `too_many_connections` (including
  remaining connection slots/exhaustion). A successful client run alone is not
  final production verification. Cached requests may not appear in function logs.
- Amplification = audience `/api/state` request count / measured upstream RPC
  delta. Report unknown if counters/log coverage are unavailable; do not divide
  by zero or claim infinite cache effectiveness.
- No functional smoke, state restoration or data cleanup is part of this script.
  It never changes registration or creates a round/participant.

Implementation references: [k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/),
[network error codes](https://grafana.com/docs/k6/latest/javascript-api/error-codes/),
[custom summaries](https://grafana.com/docs/k6/latest/results-output/end-of-test/custom-summary/).
