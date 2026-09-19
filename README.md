# أولها — Awwalha Live

Arabic RTL live-event platform for the Agricultural & Marine Sciences Society at Sultan Qaboos University.

## Architecture

Audience clients use jittered, visibility-aware polling against the CDN-cached `/api/state` endpoint. They never create Realtime, Presence, Postgres Changes, or WebSocket connections. Scheduled rounds are published about 15 seconds ahead; timing uses `performance.now()` after midpoint/RTT clock synchronization. Each participant write is one indexed RPC and one row insert with a unique `(round_id, participant_id)` constraint.

## Local development

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

Without environment variables, the interface runs in a safe visual demo mode. Copy `.env.example` to `.env.local` and configure a dedicated `awwalha-live` Supabase project to use the database-backed mode.

Apply migrations with `supabase db reset` locally. Run pgTAP tests with `supabase test db`. Load tests require k6 and a dedicated local/staging environment; see `load-tests/`.
