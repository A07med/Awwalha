begin;

create or replace function public.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  return auth.uid();
end;
$$;
revoke all on function public.require_admin() from public, anon, authenticated;

create or replace function public.public_event_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with state as (
    select e.*, r.game_type, r.phase as round_phase, r.starts_at, r.closes_at,
      r.target_ms, r.hide_timer_after_ms, r.display_duration_ms,
      r.winner_target_count, r.seats_available, r.parent_round_id, r.eligibility_mode
    from public.event_state e
    left join public.game_rounds r on r.id = e.current_round_id
    where e.singleton = true
  ), totals as (
    select (select count(*) from public.participants) as registered_count,
      case
        when (select game_type from state) = 'perfect_second' then (select count(*) from public.perfect_second_attempts where round_id = (select current_round_id from state))
        when (select game_type from state) = 'first_look' then (select count(*) from public.first_look_attempts where round_id = (select current_round_id from state))
        else 0
      end as submitted_count
  )
  select jsonb_build_object(
    'stateVersion', s.state_version,
    'registrationOpen', s.registration_open,
    'phase', s.public_phase,
    'currentGame', s.game_type,
    'round', case when s.current_round_id is null then null else jsonb_strip_nulls(jsonb_build_object(
      'id', s.current_round_id,
      'gameType', s.game_type,
      'phase', s.round_phase,
      'startsAt', s.starts_at,
      'closesAt', s.closes_at,
      'targetMs', case when s.game_type = 'perfect_second' then s.target_ms else null end,
      'hideTimerAfterMs', case when s.game_type = 'perfect_second' then s.hide_timer_after_ms else null end,
      'displayDurationMs', case when s.game_type = 'first_look' then s.display_duration_ms else null end,
      'winnerTargetCount', s.winner_target_count,
      'seatsAvailable', s.seats_available,
      'parentRoundId', s.parent_round_id
    )) end,
    'registeredCount', t.registered_count,
    'submittedCount', t.submitted_count,
    'tieEligiblePublicIds', coalesce((
      select jsonb_agg(p.public_id order by p.public_id)
      from public.round_eligibility re join public.participants p on p.id = re.participant_id
      where re.round_id = s.current_round_id and s.eligibility_mode = 'restricted'
    ), '[]'::jsonb),
    'winners', case when s.public_phase = 'revealed' then coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'participantPublicId', p.public_id,
        'displayName', p.display_name,
        'score', w.score,
        'signedDeltaMs', w.signed_delta_ms,
        'guess', w.guess
      )) order by w.id)
      from public.game_winners w join public.participants p on p.id = w.participant_id
      where w.game_type = s.game_type and w.revealed_at is not null
    ), '[]'::jsonb) else '[]'::jsonb end,
    'revealedCorrectCount', case when s.public_phase = 'revealed' and s.game_type = 'first_look' then (select correct_count from public.game_rounds where id = s.current_round_id) else null end,
    'serverPublishedAt', s.updated_at
  )
  from state s cross join totals t;
$$;
revoke all on function public.public_event_state() from public;
grant execute on function public.public_event_state() to anon, authenticated;

create or replace function public.admin_round_detail(p_round_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_round public.game_rounds%rowtype;
begin
  perform public.require_admin();
  select * into v_round from public.game_rounds where id = p_round_id;
  if v_round.id is null then raise exception using errcode = '22023', message = 'invalid_round'; end if;
  return jsonb_build_object(
    'id', v_round.id,
    'correctCount', v_round.correct_count,
    'visualSeed', v_round.visual_seed,
    'visualCategory', v_round.visual_category,
    'displayDurationMs', v_round.display_duration_ms,
    'targetMs', v_round.target_ms,
    'hideTimerAfterMs', v_round.hide_timer_after_ms
  );
end;
$$;

create or replace function public.admin_set_registration(p_open boolean, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin uuid := public.require_admin();
begin
  if exists(select 1 from public.admin_action_log where request_id = p_request_id) then
    return jsonb_build_object('registrationOpen', (select registration_open from public.event_state where singleton = true), 'idempotent', true);
  end if;
  update public.event_state set registration_open = p_open, state_version = state_version + 1, updated_at = statement_timestamp() where singleton = true;
  insert into public.admin_action_log(request_id, admin_id, action, details) values (p_request_id, v_admin, 'set_registration', jsonb_build_object('open', p_open));
  return jsonb_build_object('registrationOpen', p_open);
end;
$$;

create or replace function public.admin_prepare_round(
  p_request_id uuid,
  p_game_type public.game_type,
  p_winner_target_count smallint,
  p_target_ms integer default null,
  p_hide_timer_after_ms integer default null,
  p_correct_count smallint default null,
  p_visual_seed integer default null,
  p_visual_category text default null,
  p_display_duration_ms integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_admin();
  v_round_id uuid;
  v_starts_at timestamptz := statement_timestamp() + interval '15 seconds';
  v_closes_at timestamptz;
begin
  select resource_id into v_round_id from public.admin_action_log where request_id = p_request_id;
  if v_round_id is not null then return jsonb_build_object('roundId', v_round_id, 'idempotent', true); end if;
  if p_winner_target_count not between 1 and 6 then raise exception using errcode = '22023', message = 'invalid_winner_count'; end if;
  if p_game_type = 'perfect_second' then
    v_closes_at := v_starts_at + pg_catalog.make_interval(secs => ((p_target_ms + 8000)::double precision / 1000));
  else
    v_closes_at := v_starts_at + pg_catalog.make_interval(secs => ((p_display_duration_ms + 12000)::double precision / 1000));
  end if;

  insert into public.game_rounds(game_type, starts_at, closes_at, winner_target_count, seats_available, target_ms, hide_timer_after_ms, correct_count, visual_seed, visual_category, display_duration_ms, created_by)
  values (p_game_type, v_starts_at, v_closes_at, p_winner_target_count, p_winner_target_count, p_target_ms, p_hide_timer_after_ms, p_correct_count, p_visual_seed, p_visual_category, p_display_duration_ms, v_admin)
  returning id into v_round_id;

  update public.event_state set current_round_id = v_round_id, public_phase = 'preparing', state_version = state_version + 1, updated_at = statement_timestamp() where singleton = true;
  insert into public.admin_action_log(request_id, admin_id, action, resource_id) values (p_request_id, v_admin, 'prepare_round', v_round_id);
  return jsonb_build_object('roundId', v_round_id, 'startsAt', v_starts_at, 'closesAt', v_closes_at);
end;
$$;

create or replace function public.admin_close_round(p_round_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin uuid := public.require_admin();
begin
  if exists(select 1 from public.admin_action_log where request_id = p_request_id) then return jsonb_build_object('roundId', p_round_id, 'idempotent', true); end if;
  update public.game_rounds set phase = 'closed', closes_at = least(closes_at, clock_timestamp()) where id = p_round_id and phase in ('preparing','active');
  if not found then raise exception using errcode = '22023', message = 'round_not_closeable'; end if;
  update public.event_state set public_phase = 'closed', state_version = state_version + 1, updated_at = statement_timestamp() where singleton = true and current_round_id = p_round_id;
  insert into public.admin_action_log(request_id, admin_id, action, resource_id) values (p_request_id, v_admin, 'close_round', p_round_id);
  return jsonb_build_object('roundId', p_round_id, 'phase', 'closed');
end;
$$;

create or replace function public.admin_resolve_round(p_round_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_admin();
  v_round public.game_rounds%rowtype;
  v_cutoff integer;
  v_better integer;
  v_tied integer;
  v_remaining integer;
begin
  if exists(select 1 from public.admin_action_log where request_id = p_request_id) then return (select details from public.admin_action_log where request_id = p_request_id); end if;
  select * into v_round from public.game_rounds where id = p_round_id and phase in ('closed','resolved') for update;
  if v_round.id is null then raise exception using errcode = '22023', message = 'round_not_closed'; end if;

  if v_round.game_type = 'perfect_second' then
    select absolute_error_ms into v_cutoff from public.perfect_second_attempts where round_id = p_round_id order by absolute_error_ms offset greatest(v_round.seats_available - 1, 0) limit 1;
    if v_cutoff is null then select max(absolute_error_ms) into v_cutoff from public.perfect_second_attempts where round_id = p_round_id; end if;
    select count(*) into v_better from public.perfect_second_attempts where round_id = p_round_id and absolute_error_ms < v_cutoff;
    select count(*) into v_tied from public.perfect_second_attempts where round_id = p_round_id and absolute_error_ms = v_cutoff;
    insert into public.game_winners(game_type, participant_id, winning_round_id, score, signed_delta_ms)
      select v_round.game_type, participant_id, p_round_id, absolute_error_ms, signed_delta_ms from public.perfect_second_attempts
      where round_id = p_round_id and (absolute_error_ms < v_cutoff or (v_tied <= v_round.seats_available - v_better and absolute_error_ms = v_cutoff))
      on conflict (game_type, participant_id) do nothing;
  else
    select absolute_error into v_cutoff from public.first_look_attempts where round_id = p_round_id order by absolute_error offset greatest(v_round.seats_available - 1, 0) limit 1;
    if v_cutoff is null then select max(absolute_error) into v_cutoff from public.first_look_attempts where round_id = p_round_id; end if;
    select count(*) into v_better from public.first_look_attempts where round_id = p_round_id and absolute_error < v_cutoff;
    select count(*) into v_tied from public.first_look_attempts where round_id = p_round_id and absolute_error = v_cutoff;
    insert into public.game_winners(game_type, participant_id, winning_round_id, score, guess)
      select v_round.game_type, participant_id, p_round_id, absolute_error, guess from public.first_look_attempts
      where round_id = p_round_id and (absolute_error < v_cutoff or (v_tied <= v_round.seats_available - v_better and absolute_error = v_cutoff))
      on conflict (game_type, participant_id) do nothing;
  end if;

  v_remaining := greatest(0, v_round.seats_available - v_better);
  update public.game_rounds set phase = 'resolved' where id = p_round_id;
  update public.event_state set public_phase = case when v_tied > v_remaining and v_remaining > 0 then 'tie_break' else 'resolved' end, state_version = state_version + 1, updated_at = statement_timestamp() where singleton = true and current_round_id = p_round_id;
  insert into public.admin_action_log(request_id, admin_id, action, resource_id, details)
  values (p_request_id, v_admin, 'resolve_round', p_round_id, jsonb_build_object('lockedCount', v_better, 'tiedCount', case when v_tied > v_remaining then v_tied else 0 end, 'remainingSeats', case when v_tied > v_remaining then v_remaining else 0 end, 'cutoffScore', v_cutoff));
  return jsonb_build_object('lockedCount', v_better, 'tiedCount', case when v_tied > v_remaining then v_tied else 0 end, 'remainingSeats', case when v_tied > v_remaining then v_remaining else 0 end, 'cutoffScore', v_cutoff);
end;
$$;

create or replace function public.admin_start_tie_break(p_parent_round_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_admin();
  v_parent public.game_rounds%rowtype;
  v_round_id uuid;
  v_cutoff integer;
  v_locked integer;
  v_remaining integer;
  v_start timestamptz := statement_timestamp() + interval '15 seconds';
begin
  select resource_id into v_round_id from public.admin_action_log where request_id = p_request_id;
  if v_round_id is not null then return jsonb_build_object('roundId', v_round_id, 'idempotent', true); end if;
  select * into v_parent from public.game_rounds where id = p_parent_round_id and phase = 'resolved';
  if v_parent.id is null then raise exception using errcode = '22023', message = 'parent_not_resolved'; end if;
  select count(*) into v_locked from public.game_winners where winning_round_id = p_parent_round_id;
  v_remaining := v_parent.seats_available - v_locked;
  if v_remaining <= 0 then raise exception using errcode = '22023', message = 'no_tie_break_needed'; end if;

  if v_parent.game_type = 'perfect_second' then
    select absolute_error_ms into v_cutoff from public.perfect_second_attempts where round_id = p_parent_round_id order by absolute_error_ms offset greatest(v_parent.seats_available - 1, 0) limit 1;
    insert into public.game_rounds(game_type, phase, starts_at, closes_at, winner_target_count, seats_available, parent_round_id, eligibility_mode, target_ms, hide_timer_after_ms, created_by)
    values ('perfect_second', 'preparing', v_start, v_start + interval '18 seconds', v_parent.winner_target_count, v_remaining, p_parent_round_id, 'restricted', 4000 + floor(random() * 5000)::integer, v_parent.hide_timer_after_ms, v_admin) returning id into v_round_id;
    insert into public.round_eligibility(round_id, participant_id) select v_round_id, participant_id from public.perfect_second_attempts where round_id = p_parent_round_id and absolute_error_ms = v_cutoff;
  else
    select absolute_error into v_cutoff from public.first_look_attempts where round_id = p_parent_round_id order by absolute_error offset greatest(v_parent.seats_available - 1, 0) limit 1;
    insert into public.game_rounds(game_type, phase, starts_at, closes_at, winner_target_count, seats_available, parent_round_id, eligibility_mode, correct_count, visual_seed, visual_category, display_duration_ms, created_by)
    values ('first_look', 'preparing', v_start, v_start + interval '16 seconds', v_parent.winner_target_count, v_remaining, p_parent_round_id, 'restricted', 20 + floor(random() * 41)::integer, floor(random() * 2147483646)::integer, v_parent.visual_category, v_parent.display_duration_ms, v_admin) returning id into v_round_id;
    insert into public.round_eligibility(round_id, participant_id) select v_round_id, participant_id from public.first_look_attempts where round_id = p_parent_round_id and absolute_error = v_cutoff;
  end if;
  update public.event_state set current_round_id = v_round_id, public_phase = 'preparing', state_version = state_version + 1, updated_at = statement_timestamp() where singleton = true;
  insert into public.admin_action_log(request_id, admin_id, action, resource_id, details) values (p_request_id, v_admin, 'start_tie_break', v_round_id, jsonb_build_object('parentRoundId', p_parent_round_id, 'remainingSeats', v_remaining));
  return jsonb_build_object('roundId', v_round_id, 'remainingSeats', v_remaining, 'startsAt', v_start);
end;
$$;

create or replace function public.admin_reveal_winners(p_round_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin uuid := public.require_admin(); v_game public.game_type; v_target integer; v_count integer;
begin
  if exists(select 1 from public.admin_action_log where request_id = p_request_id) then return jsonb_build_object('idempotent', true); end if;
  select game_type, winner_target_count into v_game, v_target from public.game_rounds where id = p_round_id and phase = 'resolved';
  if v_game is null then raise exception using errcode = '22023', message = 'round_not_resolved'; end if;
  select count(*) into v_count from public.game_winners where game_type = v_game;
  if v_count <> v_target then raise exception using errcode = '22023', message = 'winner_count_incomplete'; end if;
  update public.game_winners set revealed_at = statement_timestamp() where game_type = v_game and revealed_at is null;
  update public.game_rounds set phase = 'revealed' where id = p_round_id;
  update public.event_state set public_phase = 'revealed', state_version = state_version + 1, updated_at = statement_timestamp() where singleton = true and current_round_id = p_round_id;
  insert into public.admin_action_log(request_id, admin_id, action, resource_id) values (p_request_id, v_admin, 'reveal_winners', p_round_id);
  return jsonb_build_object('winnerCount', v_count);
end;
$$;

create or replace function public.admin_reset_games(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin uuid := public.require_admin();
begin
  if exists(select 1 from public.admin_action_log where request_id = p_request_id) then return jsonb_build_object('idempotent', true); end if;
  delete from public.game_rounds where id is not null;
  update public.event_state set current_round_id = null, public_phase = 'lobby', state_version = state_version + 1, updated_at = statement_timestamp() where singleton = true;
  insert into public.admin_action_log(request_id, admin_id, action) values (p_request_id, v_admin, 'reset_games');
  return jsonb_build_object('registrationsPreserved', true);
end;
$$;

create or replace function public.admin_clear_registrations(p_request_id uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin uuid := public.require_admin(); v_deleted integer;
begin
  if p_confirmation <> 'DELETE ALL REGISTRATIONS' then raise exception using errcode = '22023', message = 'confirmation_required'; end if;
  if exists(select 1 from public.admin_action_log where request_id = p_request_id) then return jsonb_build_object('idempotent', true); end if;
  delete from public.game_rounds where id is not null;
  delete from public.participants where id is not null;
  get diagnostics v_deleted = row_count;
  update public.event_state set current_round_id = null, public_phase = 'lobby', state_version = state_version + 1, updated_at = statement_timestamp() where singleton = true;
  insert into public.admin_action_log(request_id, admin_id, action, details) values (p_request_id, v_admin, 'clear_registrations', jsonb_build_object('deleted', v_deleted));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

create or replace function public.admin_round_status(p_round_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_game public.game_type; v_count bigint;
begin
  perform public.require_admin();
  select game_type into v_game from public.game_rounds where id = p_round_id;
  if v_game = 'perfect_second' then select count(*) into v_count from public.perfect_second_attempts where round_id = p_round_id;
  elsif v_game = 'first_look' then select count(*) into v_count from public.first_look_attempts where round_id = p_round_id;
  else raise exception using errcode = '22023', message = 'invalid_round'; end if;
  return jsonb_build_object('submittedCount', v_count);
end;
$$;

revoke all on function public.admin_round_detail(uuid) from public;
revoke all on function public.admin_set_registration(boolean,uuid) from public;
revoke all on function public.admin_prepare_round(uuid,public.game_type,smallint,integer,integer,smallint,integer,text,integer) from public;
revoke all on function public.admin_close_round(uuid,uuid) from public;
revoke all on function public.admin_resolve_round(uuid,uuid) from public;
revoke all on function public.admin_start_tie_break(uuid,uuid) from public;
revoke all on function public.admin_reveal_winners(uuid,uuid) from public;
revoke all on function public.admin_reset_games(uuid) from public;
revoke all on function public.admin_clear_registrations(uuid,text) from public;
revoke all on function public.admin_round_status(uuid) from public;
grant execute on function public.admin_round_detail(uuid) to authenticated;
grant execute on function public.admin_set_registration(boolean,uuid) to authenticated;
grant execute on function public.admin_prepare_round(uuid,public.game_type,smallint,integer,integer,smallint,integer,text,integer) to authenticated;
grant execute on function public.admin_close_round(uuid,uuid) to authenticated;
grant execute on function public.admin_resolve_round(uuid,uuid) to authenticated;
grant execute on function public.admin_start_tie_break(uuid,uuid) to authenticated;
grant execute on function public.admin_reveal_winners(uuid,uuid) to authenticated;
grant execute on function public.admin_reset_games(uuid) to authenticated;
grant execute on function public.admin_clear_registrations(uuid,text) to authenticated;
grant execute on function public.admin_round_status(uuid) to authenticated;

commit;
