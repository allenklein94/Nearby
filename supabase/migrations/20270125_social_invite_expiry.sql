-- A gathering invitation cannot be accepted once the gathering has happened
-- (2026-09-20). Past gathering -> the invite can still be viewed, "accept" is
-- refused, and dismissing it records status 'expired' (the person did not
-- decline, they missed the window), so it is never reported as a decline.
-- Community invites have no date and are unchanged.

alter table public.social_invites drop constraint if exists social_invites_status_check;
alter table public.social_invites
  add constraint social_invites_status_check
  check (status = any (array['pending'::text, 'accepted'::text, 'declined'::text, 'expired'::text]));

-- Same signature as before: replaced in place (single overload).
create or replace function public.respond_to_social_invite(invite_id_param uuid, accept boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_type text;
  v_target uuid;
  v_past boolean := false;
begin
  select invite_type, target_id into v_type, v_target
  from social_invites
  where id = invite_id_param and invitee_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'Invite not found or already responded to';
  end if;

  if v_type = 'gathering' then
    select scheduled_at < now() into v_past from gatherings where id = v_target;
    v_past := coalesce(v_past, false);
  end if;

  if v_past and accept then
    raise exception 'This invitation has expired: the gathering has already happened';
  end if;

  update social_invites
  set status = case
        when v_past then 'expired'
        when accept then 'accepted'
        else 'declined'
      end,
      responded_at = now()
  where id = invite_id_param and invitee_id = auth.uid() and status = 'pending';
end;
$function$;

revoke all on function public.respond_to_social_invite(uuid, boolean) from public, anon;
grant execute on function public.respond_to_social_invite(uuid, boolean) to authenticated, service_role;
