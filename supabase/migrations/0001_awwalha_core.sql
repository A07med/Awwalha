begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.game_type as enum ('perfect_second', 'first_look');
create type public.round_phase as enum ('preparing', 'active', 'closed', 'resolved', 'tie_break', 'revealed');
create type public.eligibility_mode as enum ('all', 'restricted');

create table public.participants (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id uuid not null unique default extensions.gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 2 and 60),
  phone_e164 text not null unique check (phone_e164 ~ '^\+968[279][0-9]{7}$'),
  created_at timestamptz not null default statement_timestamp()
);

create table public.participant_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null default (statement_timestamp() + interval '90 days'),
  revoked_at timestamptz,
  created_at timestamptz not null default statement_timestamp()
);
create index participant_sessions_active_token_idx on public.participant_sessions(token_hash) where revoked_at is null;

create table public.participant_recovery (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  recovery_hash bytea not null,
  created_at timestamptz not null default statement_timestamp()
);

create table public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default statement_timestamp()
);

create table public.game_rounds (
  id uuid primary key default extensions.gen_random_uuid(),
  game_type public.game_type not null,
  phase public.round_phase not null default 'preparing',
  starts_at timestamptz not null,
  closes_at timestamptz not null,
  winner_target_count smallint not null check (winner_target_count between 1 and 6),
  seats_available smallint not null check (seats_available between 1 and 6),
  parent_round_id uuid references public.game_rounds(id),
  eligibility_mode public.eligibility_mode not null default 'all',
  target_ms integer check (target_ms between 1000 and 30000),
  hide_timer_after_ms integer check (hide_timer_after_ms between 500 and 5000),
  correct_count smallint check (correct_count between 1 and 200),
  visual_seed integer,
  visual_category text check (visual_category in ('seeds','leaves','fish','bubbles','drops')),
  display_duration_ms integer check (display_duration_ms between 500 and 10000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(),
  check (closes_at > starts_at),
  check (
    (game_type = 'perfect_second' and target_ms is not null and hide_timer_after_ms is not null and correct_count is null)
    or
    (game_type = 'first_look' and correct_count is not null and visual_seed is not null and visual_category is not null and display_duration_ms is not null and target_ms is null)
  )
);
create index game_rounds_current_idx on public.game_rounds(created_at desc);

create table public.round_eligibility (
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  created_at timestamptz not null default statement_timestamp(),
  primary key (round_id, participant_id)
);

create table public.perfect_second_attempts (
  id bigint generated always as identity primary key,
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  elapsed_ms integer not null check (elapsed_ms between 0 and 60000),
  signed_delta_ms integer not null,
  absolute_error_ms integer not null check (absolute_error_ms >= 0),
  timing_metadata jsonb not null default '{}'::jsonb check (pg_column_size(timing_metadata) <= 2048),
  integrity_flag text,
  submission_received_at timestamptz not null default clock_timestamp(),
  unique (round_id, participant_id)
);
create index perfect_second_round_score_idx on public.perfect_second_attempts(round_id, absolute_error_ms);

create table public.first_look_attempts (
  id bigint generated always as identity primary key,
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  guess smallint not null check (guess between 0 and 999),
  absolute_error integer not null check (absolute_error >= 0),
  submission_received_at timestamptz not null default clock_timestamp(),
  unique (round_id, participant_id)
);
create index first_look_round_score_idx on public.first_look_attempts(round_id, absolute_error);

create table public.game_winners (
  id bigint generated always as identity primary key,
  game_type public.game_type not null,
  participant_id uuid not null references public.participants(id) on delete cascade,
  winning_round_id uuid not null references public.game_rounds(id) on delete cascade,
  final_position smallint check (final_position between 1 and 6),
  score integer not null check (score >= 0),
  signed_delta_ms integer,
  guess smallint,
  revealed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  unique (game_type, participant_id)
);
create index game_winners_public_idx on public.game_winners(game_type, revealed_at) where revealed_at is not null;

create table public.event_state (
  singleton boolean primary key default true check (singleton),
  state_version bigint not null default 1 check (state_version > 0),
  registration_open boolean not null default true,
  current_round_id uuid references public.game_rounds(id),
  public_phase text not null default 'lobby' check (public_phase in ('lobby','preparing','countdown','active','answering','closed','resolved','tie_break','revealed','ended')),
  updated_at timestamptz not null default statement_timestamp()
);
insert into public.event_state(singleton) values (true);

create table public.admin_action_log (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  admin_id uuid not null references auth.users(id),
  action text not null,
  resource_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp()
);
create index admin_action_log_admin_created_idx on public.admin_action_log(admin_id, created_at desc);

alter table public.participants enable row level security;
alter table public.participant_sessions enable row level security;
alter table public.participant_recovery enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.game_rounds enable row level security;
alter table public.round_eligibility enable row level security;
alter table public.perfect_second_attempts enable row level security;
alter table public.first_look_attempts enable row level security;
alter table public.game_winners enable row level security;
alter table public.event_state enable row level security;
alter table public.admin_action_log enable row level security;

revoke all on all tables in schema public from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.admin_profiles where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create policy admin_profiles_self on public.admin_profiles for select to authenticated using (user_id = auth.uid());
create policy admin_read_participants on public.participants for select to authenticated using (public.is_admin());
create policy admin_read_rounds on public.game_rounds for select to authenticated using (public.is_admin());
create policy admin_read_eligibility on public.round_eligibility for select to authenticated using (public.is_admin());
create policy admin_read_perfect on public.perfect_second_attempts for select to authenticated using (public.is_admin());
create policy admin_read_first on public.first_look_attempts for select to authenticated using (public.is_admin());
create policy admin_read_winners on public.game_winners for select to authenticated using (public.is_admin());
create policy admin_read_state on public.event_state for select to authenticated using (public.is_admin());
create policy admin_read_log on public.admin_action_log for select to authenticated using (public.is_admin());

create or replace function public.participant_id_for_token(p_token text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select participant_id
  from public.participant_sessions
  where token_hash = extensions.digest(p_token, 'sha256')
    and revoked_at is null
    and expires_at > statement_timestamp()
  limit 1;
$$;
revoke all on function public.participant_id_for_token(text) from public, anon, authenticated;

create or replace function public.register_participant(p_display_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.participants%rowtype;
  v_token text := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_recovery text := upper(substr(pg_catalog.encode(extensions.gen_random_bytes(8), 'hex'), 1, 4) || '-' || substr(pg_catalog.encode(extensions.gen_random_bytes(8), 'hex'), 1, 4));
begin
  if p_display_name is null or char_length(pg_catalog.btrim(p_display_name)) not between 2 and 60 then
    raise exception using errcode = '22023', message = 'invalid_display_name';
  end if;
  if p_phone !~ '^\+968[279][0-9]{7}$' then
    raise exception using errcode = '22023', message = 'invalid_oman_phone';
  end if;

  insert into public.participants(display_name, phone_e164)
  values (pg_catalog.btrim(p_display_name), p_phone)
  returning * into v_participant;

  insert into public.participant_sessions(participant_id, token_hash)
  values (v_participant.id, extensions.digest(v_token, 'sha256'));
  insert into public.participant_recovery(participant_id, recovery_hash)
  values (v_participant.id, extensions.digest(v_recovery, 'sha256'));

  return jsonb_build_object(
    'token', v_token,
    'recoveryCode', v_recovery,
    'participantPublicId', v_participant.public_id,
    'displayName', v_participant.display_name
  );
exception when unique_violation then
  raise exception using errcode = '23505', message = 'already_registered';
end;
$$;

create or replace function public.recover_participant_session(p_phone text, p_recovery_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.participants%rowtype;
  v_token text := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
begin
  select p.* into v_participant
  from public.participants p
  join public.participant_recovery r on r.participant_id = p.id
  where p.phone_e164 = p_phone
    and r.recovery_hash = extensions.digest(upper(pg_catalog.btrim(p_recovery_code)), 'sha256');

  if v_participant.id is null then
    raise exception using errcode = '28000', message = 'invalid_recovery';
  end if;

  insert into public.participant_sessions(participant_id, token_hash)
  values (v_participant.id, extensions.digest(v_token, 'sha256'));

  return jsonb_build_object('token', v_token, 'participantPublicId', v_participant.public_id, 'displayName', v_participant.display_name);
end;
$$;

create or replace function public.validate_participant_session(p_session_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('participantPublicId', p.public_id, 'displayName', p.display_name)
  from public.participants p
  where p.id = public.participant_id_for_token(p_session_token);
$$;

create or replace function public.submit_perfect_second(
  p_session_token text,
  p_round_id uuid,
  p_elapsed_ms integer,
  p_timing_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant_id uuid := public.participant_id_for_token(p_session_token);
  v_round public.game_rounds%rowtype;
  v_delta integer;
  v_flag text;
begin
  if v_participant_id is null then raise exception using errcode = '28000', message = 'invalid_session'; end if;
  select * into v_round from public.game_rounds where id = p_round_id and game_type = 'perfect_second' for share;
  if v_round.id is null then raise exception using errcode = '22023', message = 'invalid_round'; end if;
  if clock_timestamp() > v_round.closes_at or v_round.phase not in ('preparing','active') then raise exception using errcode = '22023', message = 'round_closed'; end if;
  if v_round.eligibility_mode = 'restricted' and not exists(select 1 from public.round_eligibility where round_id = p_round_id and participant_id = v_participant_id) then raise exception using errcode = '42501', message = 'not_eligible'; end if;
  if p_elapsed_ms < 0 or p_elapsed_ms > 60000 then raise exception using errcode = '22023', message = 'impossible_timing'; end if;
  v_delta := p_elapsed_ms - v_round.target_ms;
  if p_elapsed_ms < 100 then v_flag := 'implausibly_early'; end if;

  insert into public.perfect_second_attempts(round_id, participant_id, elapsed_ms, signed_delta_ms, absolute_error_ms, timing_metadata, integrity_flag)
  values (p_round_id, v_participant_id, p_elapsed_ms, v_delta, abs(v_delta), coalesce(p_timing_metadata, '{}'::jsonb), v_flag);
  return jsonb_build_object('elapsedMs', p_elapsed_ms, 'signedDeltaMs', v_delta);
exception when unique_violation then
  raise exception using errcode = '23505', message = 'attempt_already_submitted';
end;
$$;

create or replace function public.submit_first_look(p_session_token text, p_round_id uuid, p_guess integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant_id uuid := public.participant_id_for_token(p_session_token);
  v_round public.game_rounds%rowtype;
begin
  if v_participant_id is null then raise exception using errcode = '28000', message = 'invalid_session'; end if;
  select * into v_round from public.game_rounds where id = p_round_id and game_type = 'first_look' for share;
  if v_round.id is null then raise exception using errcode = '22023', message = 'invalid_round'; end if;
  if clock_timestamp() > v_round.closes_at or v_round.phase not in ('preparing','active') then raise exception using errcode = '22023', message = 'round_closed'; end if;
  if v_round.eligibility_mode = 'restricted' and not exists(select 1 from public.round_eligibility where round_id = p_round_id and participant_id = v_participant_id) then raise exception using errcode = '42501', message = 'not_eligible'; end if;
  if p_guess not between 0 and 999 then raise exception using errcode = '22023', message = 'invalid_guess'; end if;

  insert into public.first_look_attempts(round_id, participant_id, guess, absolute_error)
  values (p_round_id, v_participant_id, p_guess, abs(p_guess - v_round.correct_count));
  return jsonb_build_object('guess', p_guess);
exception when unique_violation then
  raise exception using errcode = '23505', message = 'attempt_already_submitted';
end;
$$;

revoke all on function public.register_participant(text,text) from public;
revoke all on function public.recover_participant_session(text,text) from public;
revoke all on function public.validate_participant_session(text) from public;
revoke all on function public.submit_perfect_second(text,uuid,integer,jsonb) from public;
revoke all on function public.submit_first_look(text,uuid,integer) from public;
grant execute on function public.register_participant(text,text) to anon, authenticated;
grant execute on function public.recover_participant_session(text,text) to anon, authenticated;
grant execute on function public.validate_participant_session(text) to anon, authenticated;
grant execute on function public.submit_perfect_second(text,uuid,integer,jsonb) to anon, authenticated;
grant execute on function public.submit_first_look(text,uuid,integer) to anon, authenticated;

commit;
