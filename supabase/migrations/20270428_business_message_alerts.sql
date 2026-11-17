-- Business message alerts (owner, 2026-11-17: "fix Gap 1 now, staged"): a customer writing to a business notified
-- nobody (production has no trigger on business_messages), so an owner only saw a question if they happened to open
-- Messages. Now a NEW customer message alerts the people who manage that business location, through the one push path.
--
--   * Trigger zz_alert_business_message (AFTER INSERT, customer messages only: from_business = false).
--   * Recipients = the location's managers, read by ONE helper private._business_message_recipients(partner):
--     private.business_memberships when that table exists (multi-location, 20270424), else profiles.managed_partner_id.
--     Never the sender, never the customer, never a suspended account (private.account_suspended), never someone blocked
--     either way with the customer (the business inbox hides that conversation from them anyway).
--   * At most ONE alert per conversation (business location + customer) per 5 minutes:
--     private.business_message_alert_windows, claimed atomically (insert ... on conflict ... where older than 5 min), so
--     concurrent messages can't both alert. Every message is still stored and shown; only the alert is held back.
--   * Through _send_push (outbox, retry), so the owner's own mutes apply ('owner_requests' = "New requests"), and a dedupe
--     key per message + recipient. send-push emails the same alert to a verified address only when the owner has no app
--     (or a dead token): email stays the fallback, never a second copy.
--   * The alert carries NO message text and NO customer name or id (lock screens + email inboxes): title "New message
--     from a customer", body "Open it to read and reply.", data = type + message id + business id. The app/website
--     re-reads the message under the owner's own access to find the conversation.
--   * Any failure inside the alert is caught: the customer's message is never refused because of a notification.
--
-- Builds <= 87 know nothing of the type: a tap opens the app's default destination, nothing breaks.

insert into public.notification_type_groups (type, group_key) values ('business_message_received', 'owner_requests')
on conflict (type) do update set group_key = excluded.group_key;

create table if not exists private.business_message_alert_windows (
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  last_alerted_at timestamptz not null,
  primary key (partner_id, customer_id)
);
revoke all on private.business_message_alert_windows from public, anon, authenticated;

create or replace function private._business_message_recipients(p_partner uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if to_regclass('private.business_memberships') is not null then
    return query execute 'select distinct m.user_id from private.business_memberships m where m.partner_id = $1' using p_partner;
  else
    return query select p.id from public.profiles p where p.managed_partner_id = p_partner;
  end if;
end;
$function$;
revoke all on function private._business_message_recipients(uuid) from public, anon, authenticated;

create or replace function private._alert_business_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_claimed boolean;
  v_uid uuid;
begin
  if new.from_business then
    return null;
  end if;
  begin
    insert into private.business_message_alert_windows as w (partner_id, customer_id, last_alerted_at)
    values (new.partner_id, new.conversation_with_id, now())
    on conflict (partner_id, customer_id) do update set last_alerted_at = excluded.last_alerted_at
      where w.last_alerted_at <= excluded.last_alerted_at - interval '5 minutes'
    returning true into v_claimed;
    if not coalesce(v_claimed, false) then
      return null;  -- this conversation alerted under 5 minutes ago; the message itself is stored as usual
    end if;
    for v_uid in select r from private._business_message_recipients(new.partner_id) r loop
      continue when v_uid is null or v_uid = new.sender_id or v_uid = new.conversation_with_id;
      continue when private.account_suspended(v_uid);
      continue when exists (select 1 from public.blocks b
                            where (b.blocker_id = v_uid and b.blocked_id = new.conversation_with_id)
                               or (b.blocker_id = new.conversation_with_id and b.blocked_id = v_uid));
      perform public._send_push(v_uid, 'New message from a customer', 'Open it to read and reply.',
        jsonb_build_object('type', 'business_message_received', 'message_id', new.id, 'partner_id', new.partner_id),
        'business_message:' || new.id || ':' || v_uid);
    end loop;
  exception when others then
    raise warning 'business message alert not sent for %: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$;
revoke all on function private._alert_business_message() from public, anon, authenticated;

drop trigger if exists zz_alert_business_message on public.business_messages;
create trigger zz_alert_business_message after insert on public.business_messages
  for each row when (new.from_business = false) execute function private._alert_business_message();
