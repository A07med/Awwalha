# Public state delivery (staging)

The previous 750-client full flow produced 399 `/api/state` 504s. Edge
reported no initial response within 25 seconds, while state SQL averaged
roughly 6–10ms. Ordinary CDN headers (`s-maxage=1`, SWR=4) cached some reads
but did not coalesce all simultaneous dynamic-function misses.

## Selected existing platform capability

Use Vercel's native ISR via Build Output API for **only** `/api/state`.
The Vite application, `/api/time`, RPCs, database schema, game rules,
registration idempotency, and participant polling remain unchanged.
No new dependency/store/plan upgrade. Runtime Cache get/set alone has no
documented atomic refresh lock; ISR provides native request collapsing.

- PostgreSQL `public_event_state` is canonical and privacy-gated.
- One safe, whitelisted JSON snapshot per deployment/path; ignored query
  parameters prevent cache-key fanout. No participant cookie/header input.
- Native shared ISR + regional CDN, expiration 1 second, stale-while-refresh,
  request collapsing on cold misses and background regeneration.
- Failed regeneration returns non-cacheable 503, never a synthetic lobby;
  native ISR keeps its last successful response and retries regeneration.
- No build-time fallback/mocked state and no permanent expiration=false.
- Upstream timeout 2 seconds: measured direct HTTP p99 1487ms, SQL ~6ms.
  This does not raise any platform or database timeout.
- Future starts/reveal times and stateVersion pass through unchanged.
  Pre-reveal cache cannot contain Wahaj identities. A pre-reveal copy after
  reveal keeps animation running until a refreshed payload arrives.
- `x-vercel-cache` measures HIT/STALE/MISS. `x-awwalha-snapshot-at` identifies
  snapshot refresh age, and safe refresh logs show duration/version only.
  Actual upstream call counts come from before/after pg_stat_statements.

Official platform references:

- [Native request collapsing support](https://vercel.com/docs/incremental-static-regeneration/request-collapsing)
- [Build Output API prerender configuration](https://vercel.com/docs/build-output-api/primitives#prerender-functions)

Native cache behavior must be measured on the deployed Preview; unit tests
verify its configuration and safe response contract, not a mocked claim of
platform concurrency behavior. Cold-cache upstream failure can still return
503 because no last-known-good exists yet; normal traffic is warmed before
the full-flow tests, with a separate cold-key concurrency probe.
