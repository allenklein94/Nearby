-- Rollback of 20270429: back to 20270428's per-conversation window claimed before the mute check (the E9 defect returns).
-- The windows hold only timestamps (no content); they are dropped and recreated in 20270428's shape.
drop table if exists private.business_message_alert_windows;
create table private.business_message_alert_windows (
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  last_alerted_at timestamptz not null,
  primary key (partner_id, customer_id)
);
revoke all on private.business_message_alert_windows from public, anon, authenticated;
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
