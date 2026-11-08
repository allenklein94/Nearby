-- Rollback of 20270402. WARNING: this deletes any evidence already preserved in private.held_account_evidence and the protection
-- stops. If the table holds rows, export them first and get the owner's + counsel's decision: they may be under an active hold.
-- Redeploy the earlier delete-account after this (it calls a function this removes; it tolerates that, but keep them matched).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-held-account-evidence') then
    perform cron.unschedule('purge-held-account-evidence');
  end if;
end;
$$;
drop trigger if exists a_preserve_held_evidence on public.profiles;
drop trigger if exists a_preserve_held_evidence on auth.users;
drop function if exists public.account_deletion_preserve_held_evidence(uuid);
drop function if exists private.purge_held_account_evidence();
drop function if exists private._preserve_held_evidence_before_delete();
drop function if exists private.preserve_held_account_evidence(uuid);
drop trigger if exists held_evidence_guard on private.held_account_evidence;
drop function if exists private._held_evidence_guard();
drop function if exists private.held_evidence_hold_purgeable(uuid);
drop function if exists private.held_evidence_retention();
drop table if exists private.held_account_evidence;
