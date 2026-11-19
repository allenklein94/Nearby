-- Business message alerts: a muted message never holds back the next alert (staging E9, 2026-11-19; owner approved the fix,
-- staging branch only). 20270428 claimed the conversation's 5-minute window BEFORE _send_push applied the owner's
-- "Customer messages" switch, so a message that arrived while the switch was off claimed the window and the first messages
-- after switching it back on alerted nobody for up to 5 minutes. Same for a conversation whose only recipients were
-- suspended or blocked.
--
-- Now:
--   * The window is per RECIPIENT (business location + customer + the person alerted): one person's alert never holds back
--     another's, so an owner who switches the alerts back on is eligible at once even while a colleague's window runs.
--   * A recipient's window is claimed only once they will really be sent the alert: never the sender or the customer, not
--     suspended, not blocked either way, the switch on (public._push_muted, the same check _send_push makes).
--   * Muted messages are never replayed: switching the alerts back on sends nothing for messages that arrived while off;
--     the next NEW message alerts.
--   * Unchanged: at most ONE alert per person per conversation per 5 minutes (claimed atomically, so concurrent messages
--     can't both alert), the dedupe key per message + recipient, _send_push (outbox, retry, email fallback), the alert's
--     wording + data (no message text, no customer), and a failing alert never refuses the message.
-- The old per-conversation windows hold only timestamps (no content); they are dropped (at most one extra alert per
-- conversation right after this migration). Rollback: scripts/rollback/20270429_business_message_alert_mute_window.rollback.sql.

drop table if exists private.business_message_alert_windows;
create table private.business_message_alert_windows (
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  last_alerted_at timestamptz not null,
  primary key (partner_id, customer_id, recipient_id)
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
    for v_uid in select r from private._business_message_recipients(new.partner_id) r loop
      continue when v_uid is null or v_uid = new.sender_id or v_uid = new.conversation_with_id;
      continue when private.account_suspended(v_uid);
      continue when exists (select 1 from public.blocks b
                            where (b.blocker_id = v_uid and b.blocked_id = new.conversation_with_id)
                               or (b.blocker_id = new.conversation_with_id and b.blocked_id = v_uid));
      -- the person's own switch, decided before the window: a muted message claims nothing
      continue when public._push_muted(v_uid, 'business_message_received');
      v_claimed := false;
      insert into private.business_message_alert_windows as w (partner_id, customer_id, recipient_id, last_alerted_at)
      values (new.partner_id, new.conversation_with_id, v_uid, now())
      on conflict (partner_id, customer_id, recipient_id) do update set last_alerted_at = excluded.last_alerted_at
        where w.last_alerted_at <= excluded.last_alerted_at - interval '5 minutes'
      returning true into v_claimed;
      continue when not coalesce(v_claimed, false);  -- alerted about this conversation under 5 minutes ago
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
