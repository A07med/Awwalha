begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('taif_ready','taif_winners') and c.relrowsecurity), 2, 'RLS enabled on Taif tables');
select has_function('public', 'join_taif_round', array['text','uuid'], 'Taif ready RPC exists');
select has_function('public', 'admin_prepare_taif', array['uuid'], 'Taif prepare RPC exists');
select has_function('public', 'admin_start_taif', array['uuid','uuid'], 'Taif start RPC exists');
select function_privs_are('public', 'join_taif_round', array['text','uuid'], 'anon', array['EXECUTE'], 'anon can execute only the ready RPC');
select function_privs_are('public', 'admin_start_taif', array['uuid','uuid'], 'anon', array[]::text[], 'anon cannot start Taif');

create temporary table taif_people as
select n, value->>'token' as token, (value->>'participantPublicId')::uuid as public_id, value->>'displayName' as display_name
from generate_series(1, 5) g(n)
cross join lateral (
  select public.register_participant('مشارك ' || n, '+9689' || lpad(n::text, 7, '0')) as value
) registered;

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'taif-admin@awwalha.test', 'x', now());
insert into public.admin_profiles(user_id, display_name) values ('30000000-0000-0000-0000-000000000001', 'Taif Admin');
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

create temporary table taif_round as
select public.admin_prepare_taif('30000000-0000-0000-0000-000000000002') as value;

select throws_ok(format('select public.join_taif_round(%L, %L)', 'invalid-token', (select value->>'roundId' from taif_round)), '28000', 'invalid_session', 'invalid session cannot become ready');
select lives_ok(format('select public.join_taif_round(%L, %L)', (select token from taif_people where n = 1), (select value->>'roundId' from taif_round)), 'valid existing session becomes ready');
create temporary table taif_join_2 as select public.join_taif_round((select token from taif_people where n = 2), (select (value->>'roundId')::uuid from taif_round));
create temporary table taif_join_3 as select public.join_taif_round((select token from taif_people where n = 3), (select (value->>'roundId')::uuid from taif_round));
select is((select public.join_taif_round((select token from taif_people where n = 1), (select (value->>'roundId')::uuid from taif_round))->>'alreadyReady'), 'true', 'second ready press is harmless');
select is((select count(*) from public.taif_ready where round_id = (select (value->>'roundId')::uuid from taif_round)), 3::bigint, 'one ready row per participant');
select throws_ok(format('select public.admin_start_taif(%L, %L)', (select value->>'roundId' from taif_round), '30000000-0000-0000-0000-000000000003'), '22023', 'not_enough_ready', 'fewer than four ready cannot start');

create temporary table taif_join_4 as select public.join_taif_round((select token from taif_people where n = 4), (select (value->>'roundId')::uuid from taif_round));
create temporary table taif_started as
select public.admin_start_taif((select (value->>'roundId')::uuid from taif_round), '30000000-0000-0000-0000-000000000004') as value;

select is((select (value->>'winnerCount')::integer from taif_started), 4, 'start reports exactly four winners');
select ok((select starts_at between statement_timestamp() + interval '2 seconds' and statement_timestamp() + interval '4 seconds' from public.game_rounds where id = (select (value->>'roundId')::uuid from taif_round)), 'Taif start has a short synchronization buffer');
select is((select extract(epoch from (reveal_at - starts_at))::integer from public.game_rounds where id = (select (value->>'roundId')::uuid from taif_round)), 6, 'Taif animation lasts six seconds');
select is((select count(*) from public.taif_winners), 4::bigint, 'exactly four winner rows stored');
select is((select count(distinct participant_id) from public.taif_winners), 4::bigint, 'all Taif winners are unique');
select is((select count(*) from public.taif_winners where color = 'green'), 2::bigint, 'exactly two green winners');
select is((select count(*) from public.taif_winners where color = 'yellow'), 2::bigint, 'exactly two yellow winners');
select is((select count(*) from public.taif_winners w join taif_people p on p.public_id = (select public_id from public.participants where id = w.participant_id) where p.n = 5), 0::bigint, 'non-ready participant never wins');
select is((select public.admin_start_taif((select (value->>'roundId')::uuid from taif_round), '30000000-0000-0000-0000-000000000004')->>'idempotent'), 'true', 'same Start request is idempotent');

create temporary table taif_winner_snapshot as
select jsonb_agg(jsonb_build_object('participant', participant_id, 'position', position, 'color', color) order by position) as value from public.taif_winners;
select is((select public.admin_start_taif((select (value->>'roundId')::uuid from taif_round), '30000000-0000-0000-0000-000000000005')->>'idempotent'), 'true', 'second Start action is idempotent');
select is((select jsonb_agg(jsonb_build_object('participant', participant_id, 'position', position, 'color', color) order by position) from public.taif_winners), (select value from taif_winner_snapshot), 'second Start does not change winners');
select throws_ok(format('select public.join_taif_round(%L, %L)', (select token from taif_people where n = 5), (select value->>'roundId' from taif_round)), '22023', 'ready_closed', 'ready closes after Start');

create temporary table taif_public_before as select public.public_event_state() as value;
select is((select jsonb_array_length(value->'taifWinners') from taif_public_before), 0, 'Taif assignments remain private before revealAt');
select ok((select value::text not like '%displayName%' from taif_public_before), 'pre-reveal payload exposes no winner names');
select ok((select value::text not like '%phone%' from taif_public_before), 'pre-reveal payload exposes no phone data');

update public.game_rounds
set starts_at = statement_timestamp() - interval '7 seconds',
    reveal_at = statement_timestamp() - interval '1 second',
    closes_at = statement_timestamp() - interval '1 second'
where id = (select (value->>'roundId')::uuid from taif_round);

create temporary table taif_public as select public.public_event_state() as value;
select ok((select (value->>'stateVersion')::bigint from taif_public) > (select (value->>'stateVersion')::bigint from taif_public_before), 'state version advances at Taif reveal for cached clients');
select is((select jsonb_array_length(value->'taifWinners') from taif_public), 4, 'public state contains four opaque Taif assignments');
select is((select count(*) from taif_public, jsonb_array_elements(value->'taifWinners') item where item->>'color' = 'green'), 2::bigint, 'public state contains two green winners');
select is((select count(*) from taif_public, jsonb_array_elements(value->'taifWinners') item where item->>'color' = 'yellow'), 2::bigint, 'public state contains two yellow winners');
select is((select count(*) from taif_public, jsonb_array_elements(value->'taifWinners') item, jsonb_object_keys(item) key where key not in ('participantPublicId','color')), 0::bigint, 'Taif public winner objects contain only public ID and color');
select ok((select value::text not like '%displayName%' from taif_public), 'Taif payload exposes no winner names');
select ok((select value::text not like '%phone%' from taif_public), 'Taif payload exposes no phone data');

select lives_ok($$select public.admin_reset_games('30000000-0000-0000-0000-000000000006')$$, 'game reset succeeds with Taif data');
select is((select count(*) from public.taif_ready), 0::bigint, 'reset cleans Taif ready rows');
select is((select count(*) from public.taif_winners), 0::bigint, 'reset cleans Taif winner rows');
select is((select count(*) from public.game_rounds where game_type = 'taif'), 0::bigint, 'reset cleans Taif rounds');
select is((select count(*) from public.participants), 5::bigint, 'game reset preserves registrations');

select * from finish();
rollback;
