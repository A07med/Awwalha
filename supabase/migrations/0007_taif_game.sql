begin;

alter table public.game_rounds add column reveal_at timestamptz;

do $$
declare v_constraint text;
begin
  select c.conname into v_constraint
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.game_rounds'::regclass
    and c.contype = 'c'
    and pg_catalog.pg_get_constraintdef(c.oid) like '%game_type%first_look%';
  if v_constraint is not null then
    execute format('alter table public.game_rounds drop constraint %I', v_constraint);
  end if;
end;
$$;

alter table public.game_rounds
  add constraint game_rounds_game_payload_check check (
    (game_type = 'perfect_second' and target_ms is not null and hide_timer_after_ms is not null and correct_count is null and reveal_at is null)
    or
    (game_type = 'first_look' and correct_count is not null and visual_seed is not null and visual_category is not null and display_duration_ms is not null and target_ms is null and reveal_at is null)
    or
    (game_type = 'taif' and winner_target_count = 4 and seats_available = 4 and target_ms is null and hide_timer_after_ms is null and correct_count is null and visual_seed is null and visual_category is null and display_duration_ms is null)
  ),
  add constraint game_rounds_taif_reveal_check check (reveal_at is null or reveal_at > starts_at);

create table public.taif_ready (
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  selection_key bytea not null default extensions.gen_random_bytes(32),
  created_at timestamptz not null default statement_timestamp(),
  primary key (round_id, participant_id)
);
create index taif_ready_selection_idx on public.taif_ready(round_id, selection_key, participant_id);

create table public.taif_winners (
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  position smallint not null check (position between 1 and 4),
  color text not null check (color in ('green', 'yellow')),
  created_at timestamptz not null default statement_timestamp(),
  primary key (round_id, participant_id),
  unique (round_id, position)
);
create index taif_winners_round_color_idx on public.taif_winners(round_id, color);

alter table public.taif_ready enable row level security;
alter table public.taif_winners enable row level security;
revoke all on public.taif_ready, public.taif_winners from anon, authenticated;

create policy admin_read_taif_ready on public.taif_ready for select to authenticated using (public.is_admin());
create policy admin_read_taif_winners on public.taif_winners for select to authenticated using (public.is_admin());

create or replace function public.join_taif_round(p_session_token text, p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant_id uuid := public.participant_id_for_token(p_session_token);
  v_round public.game_rounds%rowtype;
  v_inserted boolean := false;
begin
  if v_participant_id is null then raise exception using errcode = '28000', message = 'invalid_session'; end if;

  select r.* into v_round
  from public.game_rounds r
  join public.event_state e on e.singleton and e.current_round_id = r.id
  where r.id = p_round_id and r.game_type = 'taif'
  for share of r;

  if v_round.id is null then raise exception using errcode = '22023', message = 'invalid_round'; end if;
  if v_round.phase <> 'preparing' then raise exception using errcode = '22023', message = 'ready_closed'; end if;

  insert into public.taif_ready(round_id, participant_id)
  values (p_round_id, v_participant_id)
  on conflict (round_id, participant_id) do nothing;
  v_inserted := found;

  return jsonb_build_object('ready', true, 'alreadyReady', not v_inserted);
end;
$$;

create or replace function public.admin_prepare_taif(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_admin();
  v_round_id uuid;
  v_placeholder_start timestamptz := statement_timestamp() + interval '7 days';
begin
  select resource_id into v_round_id from public.admin_action_log where request_id = p_request_id;
  if v_round_id is not null then
    return jsonb_build_object('roundId', v_round_id, 'idempotent', true);
  end if;

  insert into public.game_rounds(
    game_type, phase, starts_at, closes_at, winner_target_count, seats_available, created_by
  ) values (
    'taif', 'preparing', v_placeholder_start, v_placeholder_start + interval '1 hour', 4, 4, v_admin
  ) returning id into v_round_id;

  update public.event_state
  set current_round_id = v_round_id,
      public_phase = 'preparing',
      state_version = state_version + 1,
      updated_at = statement_timestamp()
  where singleton = true;

  insert into public.admin_action_log(request_id, admin_id, action, resource_id)
  values (p_request_id, v_admin, 'prepare_taif', v_round_id);

  return jsonb_build_object('roundId', v_round_id);
end;
$$;

create or replace function public.admin_start_taif(p_round_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_admin();
  v_round public.game_rounds%rowtype;
  v_ready_count bigint;
  v_winner_count bigint;
  v_starts_at timestamptz;
  v_reveal_at timestamptz;
  v_existing jsonb;
begin
  select details into v_existing from public.admin_action_log where request_id = p_request_id;
  if v_existing is not null then return v_existing || jsonb_build_object('idempotent', true); end if;

  select * into v_round
  from public.game_rounds
  where id = p_round_id and game_type = 'taif'
  for update;
  if v_round.id is null then raise exception using errcode = '22023', message = 'invalid_round'; end if;

  select count(*) into v_winner_count from public.taif_winners where round_id = p_round_id;
  if v_round.phase = 'active' and v_winner_count = 4 and v_round.reveal_at is not null then
    return jsonb_build_object(
      'roundId', p_round_id,
      'startsAt', v_round.starts_at,
      'revealAt', v_round.reveal_at,
      'winnerCount', 4,
      'idempotent', true
    );
  end if;

  if v_round.phase <> 'preparing'
    or not exists(select 1 from public.event_state where singleton and current_round_id = p_round_id)
  then
    raise exception using errcode = '22023', message = 'taif_not_startable';
  end if;

  select count(*) into v_ready_count from public.taif_ready where round_id = p_round_id;
  if v_ready_count < 4 then raise exception using errcode = '22023', message = 'not_enough_ready'; end if;

  insert into public.taif_winners(round_id, participant_id, position, color)
  select p_round_id, chosen.participant_id, chosen.position,
    case when chosen.position <= 2 then 'green' else 'yellow' end
  from (
    select participant_id, row_number() over (order by selection_key, participant_id)::smallint as position
    from public.taif_ready
    where round_id = p_round_id
    order by selection_key, participant_id
    limit 4
  ) chosen;

  v_starts_at := statement_timestamp() + interval '3 seconds';
  v_reveal_at := v_starts_at + interval '6 seconds';

  update public.game_rounds
  set phase = 'active', starts_at = v_starts_at, reveal_at = v_reveal_at, closes_at = v_reveal_at
  where id = p_round_id;

  update public.event_state
  set public_phase = 'active',
      state_version = state_version + 1,
      updated_at = statement_timestamp()
  where singleton = true and current_round_id = p_round_id;

  v_existing := jsonb_build_object(
    'roundId', p_round_id,
    'readyCount', v_ready_count,
    'winnerCount', 4,
    'startsAt', v_starts_at,
    'revealAt', v_reveal_at
  );
  insert into public.admin_action_log(request_id, admin_id, action, resource_id, details)
  values (p_request_id, v_admin, 'start_taif', p_round_id, v_existing);
  return v_existing;
end;
$$;

create or replace function public.public_event_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with state as (
    select e.*, r.game_type, r.phase as round_phase, r.starts_at, r.closes_at, r.reveal_at,
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
        when (select game_type from state) = 'taif' then (select count(*) from public.taif_ready where round_id = (select current_round_id from state))
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
      'revealAt', case when s.game_type = 'taif' then s.reveal_at else null end,
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
    'winners', case when s.public_phase = 'revealed' and s.game_type <> 'taif' then coalesce((
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
    'taifWinners', case when s.game_type = 'taif' and s.round_phase = 'active' then coalesce((
      select jsonb_agg(jsonb_build_object('participantPublicId', p.public_id, 'color', tw.color) order by tw.position)
      from public.taif_winners tw join public.participants p on p.id = tw.participant_id
      where tw.round_id = s.current_round_id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'revealedCorrectCount', case when s.public_phase = 'revealed' and s.game_type = 'first_look' then (select correct_count from public.game_rounds where id = s.current_round_id) else null end,
    'serverPublishedAt', s.updated_at
  )
  from state s cross join totals t;
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
  elsif v_game = 'taif' then select count(*) into v_count from public.taif_ready where round_id = p_round_id;
  else raise exception using errcode = '22023', message = 'invalid_round'; end if;
  return jsonb_build_object('submittedCount', v_count);
end;
$$;

revoke all on function public.join_taif_round(text,uuid) from public;
revoke all on function public.admin_prepare_taif(uuid) from public;
revoke all on function public.admin_start_taif(uuid,uuid) from public;
revoke all on function public.public_event_state() from public;
revoke all on function public.admin_round_status(uuid) from public;
grant execute on function public.join_taif_round(text,uuid) to anon, authenticated;
grant execute on function public.admin_prepare_taif(uuid) to authenticated;
grant execute on function public.admin_start_taif(uuid,uuid) to authenticated;
grant execute on function public.public_event_state() to anon, authenticated;
grant execute on function public.admin_round_status(uuid) to authenticated;

commit;
