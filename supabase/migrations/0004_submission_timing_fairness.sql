begin;

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
  v_received_at timestamptz := clock_timestamp();
  v_local_deadline_ms integer;
  v_delta integer;
  v_flag text;
begin
  if v_participant_id is null then raise exception using errcode = '28000', message = 'invalid_session'; end if;
  select * into v_round from public.game_rounds where id = p_round_id and game_type = 'perfect_second' for share;
  if v_round.id is null then raise exception using errcode = '22023', message = 'invalid_round'; end if;
  if v_round.phase not in ('preparing','active','closed') or v_received_at > v_round.closes_at + interval '3 seconds' then
    raise exception using errcode = '22023', message = 'round_closed';
  end if;
  if v_round.eligibility_mode = 'restricted' and not exists(select 1 from public.round_eligibility where round_id = p_round_id and participant_id = v_participant_id) then raise exception using errcode = '42501', message = 'not_eligible'; end if;
  if p_elapsed_ms < 0 or p_elapsed_ms > 60000 then raise exception using errcode = '22023', message = 'impossible_timing'; end if;
  v_local_deadline_ms := floor(extract(epoch from (v_round.closes_at - v_round.starts_at)) * 1000)::integer;
  if p_elapsed_ms > v_local_deadline_ms then
    raise exception using errcode = '22023', message = 'client_deadline_exceeded';
  end if;
  v_delta := p_elapsed_ms - v_round.target_ms;
  if p_elapsed_ms < 100 then v_flag := 'implausibly_early'; end if;

  insert into public.perfect_second_attempts(round_id, participant_id, elapsed_ms, signed_delta_ms, absolute_error_ms, timing_metadata, integrity_flag)
  values (p_round_id, v_participant_id, p_elapsed_ms, v_delta, abs(v_delta), coalesce(p_timing_metadata, '{}'::jsonb), v_flag);
  return jsonb_build_object('elapsedMs', p_elapsed_ms, 'signedDeltaMs', v_delta, 'receivedDuringGrace', v_received_at > v_round.closes_at);
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
  v_received_at timestamptz := clock_timestamp();
begin
  if v_participant_id is null then raise exception using errcode = '28000', message = 'invalid_session'; end if;
  select * into v_round from public.game_rounds where id = p_round_id and game_type = 'first_look' for share;
  if v_round.id is null then raise exception using errcode = '22023', message = 'invalid_round'; end if;
  if v_round.phase not in ('preparing','active','closed') or v_received_at > v_round.closes_at + interval '3 seconds' then
    raise exception using errcode = '22023', message = 'round_closed';
  end if;
  if v_round.eligibility_mode = 'restricted' and not exists(select 1 from public.round_eligibility where round_id = p_round_id and participant_id = v_participant_id) then raise exception using errcode = '42501', message = 'not_eligible'; end if;
  if p_guess not between 0 and 999 then raise exception using errcode = '22023', message = 'invalid_guess'; end if;

  insert into public.first_look_attempts(round_id, participant_id, guess, absolute_error)
  values (p_round_id, v_participant_id, p_guess, abs(p_guess - v_round.correct_count));
  return jsonb_build_object('guess', p_guess, 'receivedDuringGrace', v_received_at > v_round.closes_at);
exception when unique_violation then
  raise exception using errcode = '23505', message = 'attempt_already_submitted';
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
  if v_round.phase = 'closed' and clock_timestamp() <= v_round.closes_at + interval '3 seconds' then
    raise exception using errcode = '55000', message = 'submission_grace_active';
  end if;

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

revoke all on function public.submit_perfect_second(text,uuid,integer,jsonb) from public;
revoke all on function public.submit_first_look(text,uuid,integer) from public;
revoke all on function public.admin_resolve_round(uuid,uuid) from public;
grant execute on function public.submit_perfect_second(text,uuid,integer,jsonb) to anon, authenticated;
grant execute on function public.submit_first_look(text,uuid,integer) to anon, authenticated;
grant execute on function public.admin_resolve_round(uuid,uuid) to authenticated;

commit;
