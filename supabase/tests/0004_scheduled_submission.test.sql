begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
update public.event_state set registration_open=true where singleton;
create temporary table scheduled_session as select public.register_participant('Scheduled Timing Test','+96899998001') as value;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at)
values ('44444444-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','scheduled@awwalha.test','x',now());
insert into public.admin_profiles(user_id,display_name) values ('44444444-0000-0000-0000-000000000004','Scheduled Test');
insert into public.game_rounds(id,game_type,phase,starts_at,closes_at,winner_target_count,seats_available,target_ms,hide_timer_after_ms,created_by)
values ('44444444-0000-0000-0000-000000000001','perfect_second','preparing',clock_timestamp()-interval '6 seconds',clock_timestamp()+interval '8 seconds',1,1,6000,1500,'44444444-0000-0000-0000-000000000004');
select lives_ok(format('select public.submit_perfect_second(%L,%L,6004)',(select value->>'token' from scheduled_session),'44444444-0000-0000-0000-000000000001'),'preparing stored phase accepts a valid scheduled STOP after starts_at');
select is((select signed_delta_ms from public.perfect_second_attempts where round_id='44444444-0000-0000-0000-000000000001'),4,'score uses client elapsed, not server receipt');
select throws_ok(format('select public.submit_perfect_second(%L,%L,6004)',(select value->>'token' from scheduled_session),'44444444-0000-0000-0000-000000000001'),'23505','attempt_already_submitted','duplicate remains rejected');
select throws_ok($$select public.submit_perfect_second('invalid','44444444-0000-0000-0000-000000000001',6000)$$,'28000','invalid_session','session authorization remains mandatory');
insert into public.game_rounds(id,game_type,phase,starts_at,closes_at,winner_target_count,seats_available,correct_count,visual_seed,visual_category,display_duration_ms,created_by)
values ('44444444-0000-0000-0000-000000000002','first_look','preparing',clock_timestamp()-interval '4 seconds',clock_timestamp()+interval '8 seconds',1,1,47,12345,'seeds',3000,'44444444-0000-0000-0000-000000000004');
select lives_ok(format('select public.submit_first_look(%L,%L,47)',(select value->>'token' from scheduled_session),'44444444-0000-0000-0000-000000000002'),'First Look accepts scheduled answering while stored phase is preparing');
select is((select absolute_error from public.first_look_attempts where round_id='44444444-0000-0000-0000-000000000002'),0,'canonical answer scoring unchanged');
update public.game_rounds set closes_at=clock_timestamp()-interval '4 seconds' where id='44444444-0000-0000-0000-000000000002';
select throws_ok(format('select public.submit_first_look(%L,%L,47)',(select value->>'token' from scheduled_session),'44444444-0000-0000-0000-000000000002'),'22023','round_closed','expired scheduled rounds remain rejected');
select * from finish();
rollback;
