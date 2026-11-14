begin;

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
      r.winner_target_count, r.seats_available, r.parent_round_id, r.eligibility_mode,
      case
        when r.phase = 'preparing' and statement_timestamp() >= r.starts_at and statement_timestamp() <= r.closes_at then 1
        when r.phase = 'preparing' and statement_timestamp() > r.closes_at then 2
        else 0
      end as schedule_bucket
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
    'stateVersion', s.state_version * 4 + s.schedule_bucket,
    'registrationOpen', s.registration_open,
    'phase', case
      when s.public_phase = 'preparing' and s.schedule_bucket = 1 then 'active'
      when s.public_phase = 'preparing' and s.schedule_bucket = 2 then 'closed'
      else s.public_phase
    end,
    'currentGame', s.game_type,
    'round', case when s.current_round_id is null then null else jsonb_strip_nulls(jsonb_build_object(
      'id', s.current_round_id,
      'gameType', s.game_type,
      'phase', case
        when s.round_phase = 'preparing' and s.schedule_bucket = 1 then 'active'
        when s.round_phase = 'preparing' and s.schedule_bucket = 2 then 'closed'
        else s.round_phase::text
      end,
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

commit;
