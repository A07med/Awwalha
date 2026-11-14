begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'timing-admin@awwalha.test', 'x', now());
insert into public.admin_profiles(user_id, display_name) values ('30000000-0000-0000-0000-000000000001', 'Timing Admin');
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

create temporary table timing_participants as
select 1 as n, public.register_participant('Timing One', '+96892000001') as value
union all select 2, public.register_participant('Timing Two', '+96892000002')
union all select 3, public.register_participant('Timing Three', '+96892000003')
union all select 4, public.register_participant('Timing Four', '+96892000004');

insert into public.game_rounds(id, game_type, phase, starts_at, closes_at, winner_target_count, seats_available, target_ms, hide_timer_after_ms, created_by)
values
  ('31000000-0000-0000-0000-000000000001', 'perfect_second', 'closed', clock_timestamp() - interval '15 seconds', clock_timestamp() - interval '1 second', 1, 1, 6000, 1500, '30000000-0000-0000-0000-000000000001'),
  ('31000000-0000-0000-0000-000000000002', 'perfect_second', 'closed', clock_timestamp() - interval '20 seconds', clock_timestamp() - interval '5 seconds', 1, 1, 6000, 1500, '30000000-0000-0000-0000-000000000001'),
  ('31000000-0000-0000-0000-000000000003', 'perfect_second', 'closed', clock_timestamp() - interval '15 seconds', clock_timestamp() - interval '1 second', 1, 1, 6000, 1500, '30000000-0000-0000-0000-000000000001');

select lives_ok(format(
  'select public.submit_perfect_second(%L, %L, 13000, ''{}''::jsonb)',
  (select value->>'token' from timing_participants where n = 1), '31000000-0000-0000-0000-000000000001'
), 'locally timely Perfect Second STOP survives bounded network grace');

select throws_ok(format(
  'select public.submit_perfect_second(%L, %L, 13000, ''{}''::jsonb)',
  (select value->>'token' from timing_participants where n = 2), '31000000-0000-0000-0000-000000000002'
), '22023', 'round_closed', 'Perfect Second rejects receipt beyond grace');

select throws_ok(format(
  'select public.submit_perfect_second(%L, %L, 15000, ''{}''::jsonb)',
  (select value->>'token' from timing_participants where n = 3), '31000000-0000-0000-0000-000000000003'
), '22023', 'client_deadline_exceeded', 'Perfect Second rejects a client STOP after the local deadline');

insert into public.game_rounds(id, game_type, phase, starts_at, closes_at, winner_target_count, seats_available, correct_count, visual_seed, visual_category, display_duration_ms, created_by)
values
  ('32000000-0000-0000-0000-000000000001', 'first_look', 'closed', clock_timestamp() - interval '15 seconds', clock_timestamp() - interval '1 second', 1, 1, 36, 20260919, 'leaves', 1800, '30000000-0000-0000-0000-000000000001'),
  ('32000000-0000-0000-0000-000000000002', 'first_look', 'closed', clock_timestamp() - interval '20 seconds', clock_timestamp() - interval '5 seconds', 1, 1, 36, 20260919, 'leaves', 1800, '30000000-0000-0000-0000-000000000001');

select lives_ok(format(
  'select public.submit_first_look(%L, %L, 36)',
  (select value->>'token' from timing_participants where n = 4), '32000000-0000-0000-0000-000000000001'
), 'First Look answer survives bounded network grace');

select throws_ok(format(
  'select public.submit_first_look(%L, %L, 36)',
  (select value->>'token' from timing_participants where n = 3), '32000000-0000-0000-0000-000000000002'
), '22023', 'round_closed', 'First Look rejects receipt beyond grace');

select throws_ok(
  $$select public.admin_resolve_round('31000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001')$$,
  '55000', 'submission_grace_active', 'resolution waits for in-flight submission grace'
);

select lives_ok(
  $$select public.admin_resolve_round('31000000-0000-0000-0000-000000000002', '33000000-0000-0000-0000-000000000002')$$,
  'resolution succeeds after grace expires'
);

select * from finish();
rollback;
