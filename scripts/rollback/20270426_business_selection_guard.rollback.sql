-- Rollback of 20270426 (stale-location guard). Removes the pre-request check: requests with x-nearby-business are then
-- served as before 0426 (the 20270424 window returns: a stale screen can write to the location selected on another
-- device) and the second-location gate is gone. Resets the setting only when it still names this check (never another hook). No data to keep.
do $$ begin
  if exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole, unnest(s.setconfig) c
             where r.rolname = 'authenticator' and s.setdatabase = 0 and c = 'pgrst.db_pre_request=public.nearby_pre_request') then
    execute 'alter role authenticator reset pgrst.db_pre_request';
  end if;
end $$;
notify pgrst, 'reload config';
drop function if exists public.nearby_pre_request();
drop trigger if exists gate_second_location on private.business_memberships;
drop function if exists private._gate_second_location();
drop function if exists private.multi_location_ready(uuid);
drop function if exists public.note_location_aware_session();
drop table if exists private.location_aware_sessions;
