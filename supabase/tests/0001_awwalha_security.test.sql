begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('participants','participant_sessions','participant_recovery','admin_profiles','event_state','game_rounds','round_eligibility','perfect_second_attempts','first_look_attempts','game_winners','admin_action_log') and c.relrowsecurity), 11, 'RLS enabled on every table');
select has_function('public', 'register_participant', array['text','text'], 'registration RPC exists');
select has_function('public', 'recover_participant_session', array['text','text'], 'recovery RPC exists');
select has_function('public', 'public_event_state', array[]::text[], 'safe public state RPC exists');
select has_function('public', 'admin_resolve_round', array['uuid','uuid'], 'admin resolution RPC exists');
select function_privs_are('public', 'public_event_state', array[]::text[], 'anon', array['EXECUTE'], 'anon can only execute safe public state');
select function_privs_are('public', 'admin_reset_games', array['uuid'], 'anon', array[]::text[], 'anon cannot reset games');
select function_privs_are('public', 'admin_clear_registrations', array['uuid','text'], 'anon', array[]::text[], 'anon cannot clear registrations');

create temporary table registration_result as
  select public.register_participant('أحمد', '+96891234567') as value;
select ok((select value->>'token' from registration_result) ~ '^[a-f0-9]{64}$', 'registration issues a high entropy opaque token');
select ok((select value->>'recoveryCode' from registration_result) ~ '^[A-F0-9]{4}-[A-F0-9]{4}$', 'registration issues one human recovery code');
select isnt((select encode(token_hash, 'hex') from public.participant_sessions limit 1), (select value->>'token' from registration_result), 'session token is not stored in plaintext');
select isnt((select encode(recovery_hash, 'hex') from public.participant_recovery limit 1), replace((select value->>'recoveryCode' from registration_result), '-', ''), 'recovery code is not stored in plaintext');
select throws_ok($$select public.register_participant('آخر', '+96891234567')$$, '23505', 'already_registered', 'duplicate phone cannot hijack participant');
select throws_ok($$select public.recover_participant_session('+96891234567', 'WRONG-CODE')$$, '28000', 'invalid_recovery', 'phone alone cannot recover a participant');

create temporary table read_snapshot as select count(*) as session_count from public.participant_sessions;
select lives_ok(format('select public.validate_participant_session(%L)', (select value->>'token' from registration_result)), 'session validation succeeds');
select is((select count(*) from public.participant_sessions), (select session_count from read_snapshot), 'read RPC performs no write');

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@awwalha.test', 'x', now());
insert into public.admin_profiles(user_id, display_name) values ('10000000-0000-0000-0000-000000000001', 'Admin');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

create temporary table prepared as select public.admin_prepare_round('20000000-0000-0000-0000-000000000001'::uuid, 'perfect_second'::public.game_type, 3::smallint, 6000, 1500, null::smallint, null::integer, null::text, null::integer) as value;
select is((select value->>'roundId' from prepared), (select public.admin_prepare_round('20000000-0000-0000-0000-000000000001'::uuid, 'perfect_second'::public.game_type, 3::smallint, 6000, 1500, null::smallint, null::integer, null::text, null::integer)->>'roundId'), 'admin prepare is idempotent');
select ok((select starts_at > statement_timestamp() + interval '14 seconds' from public.game_rounds limit 1), 'round is scheduled in the future');

select lives_ok(format('select public.submit_perfect_second(%L, %L, 6004, ''{}''::jsonb)', (select value->>'token' from registration_result), (select value->>'roundId' from prepared)), 'valid Perfect Second attempt accepted');
select throws_ok(format('select public.submit_perfect_second(%L, %L, 6005, ''{}''::jsonb)', (select value->>'token' from registration_result), (select value->>'roundId' from prepared)), '23505', 'attempt_already_submitted', 'one attempt per participant');
select is((select signed_delta_ms from public.perfect_second_attempts limit 1), 4, 'Perfect Second signed delta is correct');
select is((select absolute_error_ms from public.perfect_second_attempts limit 1), 4, 'Perfect Second absolute score is correct');

update public.game_rounds set phase = 'closed', starts_at = clock_timestamp() - interval '10 seconds', closes_at = clock_timestamp() - interval '4 seconds' where id = (select (value->>'roundId')::uuid from prepared);
select throws_ok(format('select public.submit_perfect_second(%L, %L, 6010, ''{}''::jsonb)', (select value->>'token' from registration_result), (select value->>'roundId' from prepared)), '22023', 'round_closed', 'server enforces round close');

select lives_ok($$select public.admin_reset_games('20000000-0000-0000-0000-000000000002')$$, 'game reset succeeds');
select is((select count(*) from public.participants), 1::bigint, 'game reset preserves registrations');
select throws_ok($$select public.admin_clear_registrations('20000000-0000-0000-0000-000000000003', 'wrong')$$, '22023', 'confirmation_required', 'clear registrations requires exact confirmation');

select * from finish();
rollback;
