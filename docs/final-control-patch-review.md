# Final control patch — local validation only

Baseline: d8ae7c4906315d70dd2538fe63ed22e4ae1a384e (staging).

## Release gate: owner decision required

No cloud migrations, registration toggles, round mutations, or Production
deployments were performed. No load tests were run.

Migration 0010 adds secure First Look result-summary/accept-all RPCs, an
optional effective winner count, and the missing new-registration gate.
Original configured targets and Perfect Second behavior remain unchanged.
Registration retries with both retained credentials bypass only the new-account
gate; session/recovery verification remains mandatory.

Migration 0011 removes First Look restricted-round public identities and
publishes round-scoped session capability digests instead. The new participant
client computes its own digest locally. No new audience RPCs, direct Supabase
reads, polling intervals, Realtime, or sockets are introduced. Join uses the
existing cached-state polling hook, never a second parallel polling loop.

**0011 is NOT backward-compatible with the currently deployed participant
client**: that client relies on tieEligiblePublicIds to enter a restricted
First Look round. Applying 0011 to the shared Preview/Production database
without a coordinated approved client rollout would prevent valid participants
from entering that round. Retaining those IDs would violate the requested
pre-reveal privacy rule. Per the owner's explicit safety instruction, cloud
application and Preview release are paused pending approval of a compatible,
coordinated rollout. Production authorization has NOT been inferred.

## Evidence

- Local pgTAP: 121/121 passing, fixtures rolled back.
- Vitest: 192/192 passing; typecheck/build passing.
- Isolated mobile fixtures: Chromium/WebKit, 390/430 widths, login/guard,
  both identities, non-admin denial, closed registration, First Look decision,
  and exact full-viewport Wahaj colors.
- Browser fixtures are not authenticated cloud end-to-end evidence.
- Production cached state was inspected read-only: registrationOpen=false.
- Root routing was participant-only and join/play had no explicit Admin entry;
  admin routes themselves never register participants. This supports a
  navigation explanation, not a claim that phone credentials were invalid.
- Join previously ignored registrationOpen; admin_set_registration never
  published the change; register_participant did not enforce the close gate.

Expanded First Look winners cycle through six-card pages every eight seconds
using a local presentation timer, retaining all legitimate winners. Ordinary
1–6 winner displays and Perfect Second scoring/tie resolution are unchanged.

Reproduce browser fixtures with a LOCAL-only dev server:

    VITE_APP_MODE=supabase VITE_SUPABASE_URL=http://127.0.0.1:55321 VITE_SUPABASE_ANON_KEY=stage-qa-public-placeholder pnpm dev --host 127.0.0.1
    STAGE_QA_PLAYWRIGHT=/absolute/path/to/playwright node scripts/final-control-visual-qa.mjs

The harness intercepts local requests and aborts any non-local request. Reports
and screenshots are in screenshots/final-control (gitignored).
