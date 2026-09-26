begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at)
values ('a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','patch@awwalha.test','x',now());
insert into public.admin_profiles(user_id,display_name) values ('a0000000-0000-0000-0000-000000000001','Patch Admin');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
create temporary table versions as select state_version as n from public.event_state;
select public.admin_set_registration(true,'b0000000-0000-0000-0000-000000000001');
select is(public.public_event_state()->>'registrationOpen','true','open reaches public state');
select public.register_participant('مشارك','+96891234567',repeat('a',64),'ABCD-1234');
select public.admin_set_registration(false,'b0000000-0000-0000-0000-000000000002');
select is(public.public_event_state()->>'registrationOpen','false','closed reaches public state');
select is((select state_version from public.event_state),(select n+2 from versions),'each toggle bumps version');
select throws_ok($$select public.register_participant('جديد','+96891234568',repeat('b',64),'BCDE-1234')$$,'55000','registration_closed','new registration blocked by backend');
select lives_ok($$select public.register_participant('مشارك','+96891234567',repeat('a',64),'ABCD-1234')$$,'lost response exact retry works while closed');
select lives_ok($$select public.validate_participant_session(repeat('a',64))$$,'existing session still valid');
select lives_ok($$select public.recover_participant_session('+96891234567','ABCD-1234')$$,'recovery still works while closed');
select is((select count(*) from public.participants),1::bigint,'closing deletes no participants');
select public.admin_set_registration(false,'b0000000-0000-0000-0000-000000000002');
select is((select state_version from public.event_state),(select n+2 from versions),'same request does not bump version twice');
select public.admin_set_registration(true,'b0000000-0000-0000-0000-000000000003');
select lives_ok($$select public.register_participant('جديد','+96891234568',repeat('b',64),'BCDE-1234')$$,'reopen permits new registration');
insert into public.participants(display_name,phone_e164) select 'مشارك '||n,'+9689'||lpad(n::text,7,'0') from generate_series(1,5) n;
create temporary table players as select id,row_number() over(order by phone_e164) as n from public.participants where phone_e164 like '+968900%';
insert into public.game_rounds(id,game_type,phase,starts_at,closes_at,winner_target_count,seats_available,correct_count,visual_seed,visual_category,display_duration_ms,created_by)
values ('c0000000-0000-0000-0000-000000000001','first_look','closed',now()-interval '30 seconds',now()-interval '10 seconds',3,3,36,1,'leaves',1800,'a0000000-0000-0000-0000-000000000001'),
('c0000000-0000-0000-0000-000000000002','first_look','closed',now()-interval '30 seconds',now()-interval '10 seconds',3,3,36,1,'leaves',1800,'a0000000-0000-0000-0000-000000000001');
insert into public.first_look_attempts(round_id,participant_id,guess,absolute_error)
select 'c0000000-0000-0000-0000-000000000001',id,36+n-1,n-1 from players where n<=3;
update public.event_state set current_round_id='c0000000-0000-0000-0000-000000000001',public_phase='closed';
select public.admin_resolve_round('c0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000004');
select is(public.admin_first_look_result_summary('c0000000-0000-0000-0000-000000000001')->>'tieNeeded','false','0,1,2 normal result no decision');
select is((select count(*) from public.game_winners),3::bigint,'normal result locks three winners');
select lives_ok($$select public.admin_reveal_winners('c0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000005')$$,'normal reveal still works');
delete from public.game_winners;
insert into public.first_look_attempts(round_id,participant_id,guess,absolute_error)
select 'c0000000-0000-0000-0000-000000000002',id,36+least(n-1,2),least(n-1,2) from players;
update public.event_state set current_round_id='c0000000-0000-0000-0000-000000000002',public_phase='closed';
select public.admin_resolve_round('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000006');
create temporary table summary as select public.admin_first_look_result_summary('c0000000-0000-0000-0000-000000000002') as v;
select is((select v->>'lockedCount' from summary),'2','two locked above cutoff');
select is((select v->>'tiedCount' from summary),'3','three cutoff ties');
select is((select v->>'remainingSeats' from summary),'1','one remaining seat');
select is((select v->>'projectedWinnerCount' from summary),'5','accept all projects five');
select is((select v->'groups' from summary),'[{"score":0,"count":1},{"score":1,"count":1},{"score":2,"count":3}]'::jsonb,'groups based on absolute error only');
select is(jsonb_array_length(public.public_event_state()->'winners'),0,'locked winners private');
select is(public.public_event_state()->'revealedCorrectCount','null'::jsonb,'answer remains private');
-- Nested savepoint fixture, rolled back before exercising the alternative.
savepoint tie_choice;
create temporary table child as select public.admin_start_tie_break('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000007') as v;
select is((select count(*) from public.round_eligibility where round_id=(select (v->>'roundId')::uuid from child)),3::bigint,'only three cutoff participants enter child');
select is((select count(*) from public.round_eligibility re join players p on p.id=re.participant_id where p.n<=2),0::bigint,'locked participants excluded');
select is(jsonb_array_length(public.public_event_state()->'tieEligiblePublicIds'),0,'child does not expose tied public IDs');
insert into public.participant_sessions(participant_id,token_hash) select id,extensions.digest(repeat('c',64),'sha256') from players where n=3;
select ok(public.public_event_state()->'tieEligibilityTags' ? encode(extensions.digest(encode(extensions.digest(repeat('c',64),'sha256'),'hex')||':'||(select v->>'roundId' from child),'sha256'),'hex'),'round scoped private capability available through cached state');
rollback to tie_choice;
select lives_ok($$select public.admin_accept_first_look_cutoff_tie('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000008')$$,'accept all cutoff tied');
select is((select count(*) from public.game_winners),5::bigint,'all five winners, not arbitrary subset');
select is((select public_phase from public.event_state),'resolved','acceptance makes result revealable');
select lives_ok($$select public.admin_accept_first_look_cutoff_tie('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000008')$$,'same request retry idempotent');
select lives_ok($$select public.admin_accept_first_look_cutoff_tie('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000009')$$,'fresh double click retry idempotent');
select is((select count(*) from public.game_winners),5::bigint,'retries still five winners');
select is((select count(*) from public.admin_action_log where action='accept_first_look_cutoff_tie'),1::bigint,'one committed decision log');
select throws_ok($$select public.admin_start_tie_break('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000010')$$,'22023','no_tie_break_needed','tie break cannot follow accept-all');
select lives_ok($$select public.admin_reveal_winners('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000011')$$,'expanded count reveal succeeds');
select is(jsonb_array_length(public.public_event_state()->'winners'),5,'public reveal contains all five');
select is(public.public_event_state()->'round'->>'winnerTargetCount','5','published effective count expanded');
select function_privs_are('public','admin_first_look_result_summary',array['uuid'],'anon',array[]::text[],'anon cannot call summary');
select function_privs_are('public','admin_accept_first_look_cutoff_tie',array['uuid','uuid'],'anon',array[]::text[],'anon cannot accept');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000099","role":"authenticated"}',true);
select throws_ok($$select public.admin_first_look_result_summary('c0000000-0000-0000-0000-000000000002')$$,'42501','admin_required','authenticated nonadmin denied summary');
select throws_ok($$select public.admin_accept_first_look_cutoff_tie('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000012')$$,'42501','admin_required','authenticated nonadmin denied accept');
select * from finish();
rollback;

