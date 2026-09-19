begin;

create or replace function public.admin_reset_games(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin uuid := public.require_admin();
begin
  if exists(select 1 from public.admin_action_log where request_id = p_request_id) then return jsonb_build_object('idempotent', true); end if;
  update public.event_state set current_round_id = null, public_phase = 'lobby', state_version = state_version + 1, updated_at = statement_timestamp() where singleton = true;
  delete from public.game_rounds where id is not null;
  insert into public.admin_action_log(request_id, admin_id, action) values (p_request_id, v_admin, 'reset_games');
  return jsonb_build_object('registrationsPreserved', true);
end;
$$;

create or replace function public.admin_clear_registrations(p_request_id uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin uuid := public.require_admin(); v_deleted integer;
begin
  if p_confirmation <> 'DELETE ALL REGISTRATIONS' then raise exception using errcode = '22023', message = 'confirmation_required'; end if;
  if exists(select 1 from public.admin_action_log where request_id = p_request_id) then return jsonb_build_object('idempotent', true); end if;
  update public.event_state set current_round_id = null, public_phase = 'lobby', state_version = state_version + 1, updated_at = statement_timestamp() where singleton = true;
  delete from public.game_rounds where id is not null;
  delete from public.participants where id is not null;
  get diagnostics v_deleted = row_count;
  insert into public.admin_action_log(request_id, admin_id, action, details) values (p_request_id, v_admin, 'clear_registrations', jsonb_build_object('deleted', v_deleted));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

revoke all on function public.admin_reset_games(uuid) from public;
revoke all on function public.admin_clear_registrations(uuid,text) from public;
grant execute on function public.admin_reset_games(uuid) to authenticated;
grant execute on function public.admin_clear_registrations(uuid,text) to authenticated;

commit;
