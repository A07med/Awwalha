begin;
-- Original configured target and 1–6 constraints remain intact.
-- Only a confirmed First Look cutoff decision can expand effective count.
alter table public.game_rounds add column effective_winner_count integer
  check (effective_winner_count is null or (game_type = 'first_look' and effective_winner_count >= winner_target_count));
create or replace function public.register_participant(
  p_display_name text,
  p_phone text,
  p_session_token text,
  p_recovery_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.participants%rowtype;
  v_inserted boolean := false;
  v_token_hash bytea;
  v_recovery_hash bytea;
begin
  if p_display_name is null or char_length(pg_catalog.btrim(p_display_name)) not between 2 and 60 then
    raise exception using errcode = '22023', message = 'invalid_display_name';
  end if;
  if p_phone !~ '^\+968[279][0-9]{7}$' then
    raise exception using errcode = '22023', message = 'invalid_oman_phone';
  end if;
  if p_session_token !~ '^[a-f0-9]{64}$' or p_recovery_code !~ '^[A-F0-9]{4}-[A-F0-9]{4}$' then
    raise exception using errcode = '22023', message = 'invalid_registration_credentials';
  end if;

  v_token_hash := extensions.digest(p_session_token, 'sha256');
  v_recovery_hash := extensions.digest(p_recovery_code, 'sha256');

  -- Shared row lock linearizes NEW registrations against the close action,
  -- without serializing registrations with one another. Existing retries
  -- skip the gate and still require BOTH original hashes below.
  if not exists(select 1 from public.participants where phone_e164 = p_phone) then
    perform 1 from public.event_state where singleton = true and registration_open for share;
    if not found then
      raise exception using errcode = '55000', message = 'registration_closed';
    end if;
  end if;

  insert into public.participants(display_name, phone_e164)
  values (pg_catalog.btrim(p_display_name), p_phone)
  on conflict (phone_e164) do nothing
  returning * into v_participant;
  v_inserted := found;

  if v_inserted then
    insert into public.participant_sessions(participant_id, token_hash)
    values (v_participant.id, v_token_hash);
    insert into public.participant_recovery(participant_id, recovery_hash)
    values (v_participant.id, v_recovery_hash);
  else
    -- A separate statement gets a fresh READ COMMITTED snapshot after a
    -- concurrent INSERT has committed. Both hashes must match the same owner.
    select * into v_participant from public.participants where phone_e164 = p_phone;
    if v_participant.id is null
      or not exists (
        select 1 from public.participant_sessions
        where participant_id = v_participant.id and token_hash = v_token_hash
          and revoked_at is null and expires_at > statement_timestamp()
      )
      or not exists (
        select 1 from public.participant_recovery
        where participant_id = v_participant.id and recovery_hash = v_recovery_hash
      ) then
      raise exception using errcode = '23505', message = 'already_registered';
    end if;
  end if;

  return jsonb_build_object(
    'token', p_session_token,
    'recoveryCode', p_recovery_code,
    'participantPublicId', v_participant.public_id,
    'displayName', v_participant.display_name
  );
exception when unique_violation then
  raise exception using errcode = '23505', message = 'already_registered';
end;
$$;


create function public.admin_first_look_result_summary(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public.require_admin();
  r public.game_rounds%rowtype;
  cutoff integer; better integer; tied integer; remaining integer; prior integer;
begin
  select * into r from public.game_rounds where id = p_round_id and game_type = 'first_look' and phase in ('resolved','revealed');
  if r.id is null then raise exception using errcode = '22023', message = 'round_not_resolved'; end if;
  select absolute_error into cutoff from public.first_look_attempts where round_id = r.id
    order by absolute_error offset greatest(r.seats_available - 1, 0) limit 1;
  if cutoff is null then select max(absolute_error) into cutoff from public.first_look_attempts where round_id = r.id; end if;
  select count(*) into better from public.first_look_attempts where round_id = r.id and absolute_error < cutoff;
  select count(*) into tied from public.first_look_attempts where round_id = r.id and absolute_error = cutoff;
  select count(*) into prior from public.game_winners where game_type = 'first_look' and winning_round_id <> r.id;
  remaining := greatest(0, r.seats_available - better);
  return jsonb_build_object('roundId',r.id,'submittedCount',(select count(*) from public.first_look_attempts where round_id=r.id),
    'configuredTarget',r.winner_target_count,'lockedCount',prior+better,'cutoffScore',cutoff,
    'tiedCount',tied,'remainingSeats',remaining,'projectedWinnerCount',prior+better+tied,
    'tieNeeded',r.effective_winner_count is null and tied > remaining and remaining > 0,
    'groups',coalesce((select jsonb_agg(jsonb_build_object('score',absolute_error,'count',n) order by absolute_error)
      from (select absolute_error,count(*) as n from public.first_look_attempts where round_id=r.id group by absolute_error) g),'[]'::jsonb));
end; $$;

create function public.admin_accept_first_look_cutoff_tie(p_round_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := public.require_admin(); r public.game_rounds%rowtype;
  summary jsonb; result jsonb; n integer;
begin
  -- Serialize decisions on the same round; repeat request IDs return their
  -- original result, and fresh retries cannot expand a second time.
  select * into r from public.game_rounds where id=p_round_id and game_type='first_look' for update;
  select details into result from public.admin_action_log
    where request_id=p_request_id and admin_id=v_admin and action='accept_first_look_cutoff_tie' and resource_id=p_round_id;
  if result is not null then return result; end if;
  if r.effective_winner_count is not null then return jsonb_build_object('winnerCount',r.effective_winner_count,'idempotent',true); end if;
  if r.phase <> 'resolved' or r.id is null or not exists(select 1 from public.event_state where singleton and current_round_id=r.id and public_phase='tie_break') then
    raise exception using errcode='22023',message='round_not_resolved';
  end if;
  summary := public.admin_first_look_result_summary(r.id);
  if not (summary->>'tieNeeded')::boolean then raise exception using errcode='22023',message='no_tie_break_needed'; end if;
  insert into public.game_winners(game_type,participant_id,winning_round_id,score,guess)
    select 'first_look',participant_id,r.id,absolute_error,guess from public.first_look_attempts
    where round_id=r.id and absolute_error=(summary->>'cutoffScore')::integer
    on conflict (game_type,participant_id) do nothing;
  select count(*) into n from public.game_winners where game_type='first_look';
  update public.game_rounds set effective_winner_count=n where id=r.id;
  update public.event_state set public_phase='resolved',state_version=state_version+1,updated_at=statement_timestamp() where singleton and current_round_id=r.id;
  result := jsonb_build_object('winnerCount',n);
  insert into public.admin_action_log(request_id,admin_id,action,resource_id,details)
    values(p_request_id,v_admin,'accept_first_look_cutoff_tie',r.id,result);
  return result;
end; $$;
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
  select * into v_parent from public.game_rounds where id = p_parent_round_id and phase = 'resolved' for update;
  if v_parent.game_type = 'first_look' and (v_parent.effective_winner_count is not null or not exists(select 1 from public.event_state where singleton and current_round_id = p_parent_round_id)) then
    raise exception using errcode = '22023', message = 'no_tie_break_needed';
  end if;
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
  select game_type, coalesce(effective_winner_count, winner_target_count) into v_game, v_target from public.game_rounds where id = p_round_id and phase = 'resolved';
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


revoke all on function public.admin_first_look_result_summary(uuid) from public, anon;
revoke all on function public.admin_accept_first_look_cutoff_tie(uuid,uuid) from public, anon;
grant execute on function public.admin_first_look_result_summary(uuid) to authenticated;
grant execute on function public.admin_accept_first_look_cutoff_tie(uuid,uuid) to authenticated;
commit;

