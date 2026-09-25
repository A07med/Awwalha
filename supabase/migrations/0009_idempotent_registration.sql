begin;

-- The caller retains these credentials before sending the request. A retry with
-- the same credentials can therefore recover a committed-but-lost response;
-- knowing only the phone number never grants a session.
create function public.register_participant(
  p_display_name text,
  p_phone text,
  p_session_token text,
  p_recovery_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.participants%rowtype;
  v_inserted boolean := false;
  v_token_hash bytea;
  v_recovery_hash bytea;
begin
  if p_display_name is null or char_length(pg_catalog.btrim(p_display_name)) not between 2 and 60 then
    raise exception using errcode = '22023', message = 'invalid_display_name';
  end if;
  if p_phone !~ '^\+968[279][0-9]{7}$' then
    raise exception using errcode = '22023', message = 'invalid_oman_phone';
  end if;
  if p_session_token !~ '^[a-f0-9]{64}$' or p_recovery_code !~ '^[A-F0-9]{4}-[A-F0-9]{4}$' then
    raise exception using errcode = '22023', message = 'invalid_registration_credentials';
  end if;

  v_token_hash := extensions.digest(p_session_token, 'sha256');
  v_recovery_hash := extensions.digest(p_recovery_code, 'sha256');

  insert into public.participants(display_name, phone_e164)
  values (pg_catalog.btrim(p_display_name), p_phone)
  on conflict (phone_e164) do nothing
  returning * into v_participant;
  v_inserted := found;

  if v_inserted then
    insert into public.participant_sessions(participant_id, token_hash)
    values (v_participant.id, v_token_hash);
    insert into public.participant_recovery(participant_id, recovery_hash)
    values (v_participant.id, v_recovery_hash);
  else
    -- A separate statement gets a fresh READ COMMITTED snapshot after a
    -- concurrent INSERT has committed. Both hashes must match the same owner.
    select * into v_participant from public.participants where phone_e164 = p_phone;
    if v_participant.id is null
      or not exists (
        select 1 from public.participant_sessions
        where participant_id = v_participant.id and token_hash = v_token_hash
          and revoked_at is null and expires_at > statement_timestamp()
      )
      or not exists (
        select 1 from public.participant_recovery
        where participant_id = v_participant.id and recovery_hash = v_recovery_hash
      ) then
      raise exception using errcode = '23505', message = 'already_registered';
    end if;
  end if;

  return jsonb_build_object(
    'token', p_session_token,
    'recoveryCode', p_recovery_code,
    'participantPublicId', v_participant.public_id,
    'displayName', v_participant.display_name
  );
exception when unique_violation then
  raise exception using errcode = '23505', message = 'already_registered';
end;
$$;

revoke all on function public.register_participant(text,text,text,text) from public;
grant execute on function public.register_participant(text,text,text,text) to anon, authenticated;
revoke all on function public.register_participant(text,text) from public, anon, authenticated;

commit;
