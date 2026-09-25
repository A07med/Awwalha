begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select has_function('public', 'register_participant', array['text','text','text','text'], 'idempotent registration RPC exists');
select function_privs_are('public', 'register_participant', array['text','text','text','text'], 'anon', array['EXECUTE'], 'anon may register with retained credentials');
select function_privs_are('public', 'register_participant', array['text','text'], 'anon', array[]::text[], 'legacy unsafe registration is not callable');

-- The first HTTP response is deliberately discarded. The retained client
-- credentials must recover the same committed row and usable session.
select public.register_participant('أحمد', '+96891234568', repeat('a', 64), 'ABCD-1234');
create temporary table retried as
  select public.register_participant('أحمد', '+96891234568', repeat('a', 64), 'ABCD-1234') as value;
select is((select value->>'token' from retried), repeat('a', 64), 'lost response retry returns the original token');
select is((select value->>'recoveryCode' from retried), 'ABCD-1234', 'lost response retry returns original recovery code');
select is((select count(*)::integer from public.participants where phone_e164 = '+96891234568'), 1, 'retry makes no duplicate participant');
select is((select count(*)::integer from public.participant_sessions s join public.participants p on p.id=s.participant_id where p.phone_e164 = '+96891234568'), 1, 'retry makes no duplicate session');
select is((select count(*)::integer from public.participant_recovery r join public.participants p on p.id=r.participant_id where p.phone_e164 = '+96891234568'), 1, 'retry does not rotate recovery state');
select is((select public.validate_participant_session(repeat('a', 64))->>'participantPublicId'), (select value->>'participantPublicId' from retried), 'retried token is a usable session');
select throws_ok($$select public.register_participant('غريب', '+96891234568', repeat('b', 64), 'ABCD-1234')$$, '23505', 'already_registered', 'phone and recovery code without token cannot hijack');
select throws_ok($$select public.register_participant('غريب', '+96891234568', repeat('a', 64), 'FFFF-FFFF')$$, '23505', 'already_registered', 'phone and token without recovery code cannot rotate recovery');

select * from finish();
rollback;
