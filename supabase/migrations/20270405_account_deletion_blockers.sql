-- Account deletion: nothing an account is attached to may refuse its deletion, and deleting it must not take other people's plans or the
-- money records with it (owner, 2026-11-08; audit + per-column decisions: PRODUCT_AUDIT/ACCOUNT_DELETION_BLOCKERS_2026-11-08.md).
--
-- Found by scripts/replay/account-deletion-sweep.js (every relationship, tried for real): 14 keys refuse the delete, and two guards refuse
-- the SET NULL a deletion causes (a paused person's restriction when the admin deletes their account; a sponsored terms acceptance).
-- The same keys hid a worse thing: a customer's captured payment is deleted WITH their request whenever the row reaches that path first.
--
-- Decisions:
--   who-did-it columns (screening, notes, partner review, submissions, organizer added by): SET NULL. The record stays, the person doesn't.
--   business_payments: a row with money behind it (a Stripe id, or authorized/captured/refunded) outlives the reservation, with no person,
--     reservation or failure text on it. Its business stays on the row (partner_id). Rows with nothing behind them go, as before.
--     Kept until a retention period is decided: nothing here purges them (counsel; see the audit doc).
--   offer_redemptions: a confirmed or invoiced redemption stays without its person (billing counts them); an unconfirmed claim goes.
--   group plans: see private._account_deletion_release_plans below.
-- Payment exceptions: money that needs a person (see below). The app's warning before deleting must be on phones before this is deployed.
-- Nothing here changes what happens to anything else on a deletion. delete-account itself is unchanged.


-- ── guards: the one extra change each allows is a deletion clearing a reference to something already gone ──
create or replace function private._account_restrictions_guard()
returns trigger language plpgsql as $$
declare
  v_refs constant text[] := array['report_id', 'review_case_id', 'admin_id', 'lifted_by'];
begin
  if (to_jsonb(new) - v_refs) = (to_jsonb(old) - v_refs)
     and (new.report_id, new.review_case_id, new.admin_id, new.lifted_by) is distinct from (old.report_id, old.review_case_id, old.admin_id, old.lifted_by)
     and (new.report_id is not distinct from old.report_id or (new.report_id is null and not exists (select 1 from public.reports r where r.id = old.report_id)))
     and (new.review_case_id is not distinct from old.review_case_id or (new.review_case_id is null and not exists (select 1 from private.account_review_cases c where c.id = old.review_case_id)))
     and (new.admin_id is not distinct from old.admin_id or (new.admin_id is null and not exists (select 1 from auth.users u where u.id = old.admin_id)))
     and (new.lifted_by is not distinct from old.lifted_by or (new.lifted_by is null and not exists (select 1 from auth.users u where u.id = old.lifted_by)))
  then
    return new;
  end if;
  if old.lifted_at is not null
     or new.lifted_at is null
     or (new.id, new.user_id, new.capability, new.reason, new.report_id, new.review_case_id, new.admin_id, new.starts_at, new.expires_at)
        is distinct from (old.id, old.user_id, old.capability, old.reason, old.report_id, old.review_case_id, old.admin_id, old.starts_at, old.expires_at)
  then
    raise exception 'A restriction can only be lifted, once' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public._sponsored_terms_acceptance_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'A terms acceptance cannot be deleted'; end if;
  -- the partner, placement, version and time stay as proof; only the person's id may go, and only once that person is gone
  if new.user_id is null and old.user_id is not null and not exists (select 1 from auth.users u where u.id = old.user_id)
     and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
    return new;
  end if;
  if (new.id, new.user_id, new.partner_id, new.placement_id, new.payment_id, new.terms_version, new.accepted_at)
     is distinct from (old.id, old.user_id, old.partner_id, old.placement_id, old.payment_id, old.terms_version, old.accepted_at)
     or (old.stripe_checkout_session_id is not null and new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id) then
    raise exception 'A terms acceptance is immutable';
  end if;
  return new;
end $$;

-- ── who-did-it columns ──
alter table public.business_offer_submissions alter column submitted_by drop not null;
alter table public.plan_organizers alter column added_by drop not null;
alter table public.occasion_group_plan_options alter column proposed_by drop not null;

alter table public.business_content_screening_results drop constraint business_content_screening_results_submitted_by_fkey,
  add constraint business_content_screening_results_submitted_by_fkey foreign key (submitted_by) references public.profiles(id) on delete set null;
alter table public.business_content_screening_results drop constraint business_content_screening_results_reviewed_by_fkey,
  add constraint business_content_screening_results_reviewed_by_fkey foreign key (reviewed_by) references public.profiles(id) on delete set null;
alter table public.business_customer_notes drop constraint business_customer_notes_updated_by_fkey,
  add constraint business_customer_notes_updated_by_fkey foreign key (updated_by) references public.profiles(id) on delete set null;
alter table public.business_partner_requests drop constraint business_partner_requests_reviewed_by_fkey,
  add constraint business_partner_requests_reviewed_by_fkey foreign key (reviewed_by) references public.profiles(id) on delete set null;
alter table public.business_offer_submissions drop constraint business_offer_submissions_submitted_by_fkey,
  add constraint business_offer_submissions_submitted_by_fkey foreign key (submitted_by) references public.profiles(id) on delete set null;
alter table public.plan_organizers drop constraint plan_organizers_added_by_fkey,
  add constraint plan_organizers_added_by_fkey foreign key (added_by) references public.profiles(id) on delete set null;
alter table public.occasion_group_plan_options drop constraint occasion_group_plan_options_proposed_by_fkey,
  add constraint occasion_group_plan_options_proposed_by_fkey foreign key (proposed_by) references public.profiles(id) on delete set null;
alter table public.occasion_group_plans drop constraint occasion_group_plans_winning_option_fkey,
  add constraint occasion_group_plans_winning_option_fkey foreign key (winning_option_id) references public.occasion_group_plan_options(id) on delete set null;

-- ── redemptions ──
alter table public.offer_redemptions drop constraint offer_redemptions_confirmed_by_fkey,
  add constraint offer_redemptions_confirmed_by_fkey foreign key (confirmed_by) references public.profiles(id) on delete set null;
alter table public.offer_redemptions drop constraint offer_redemptions_user_id_fkey,
  add constraint offer_redemptions_user_id_fkey foreign key (user_id) references public.profiles(id) on delete set null;

-- ── payments ──
alter table public.business_payments
  add column if not exists partner_id uuid,   -- plain id: it has to outlive the reservation, and the business too
  add column if not exists detached_at timestamptz;
alter table public.business_payments alter column reservation_id drop not null;
alter table public.business_payments drop constraint business_payments_payer_id_fkey,
  add constraint business_payments_payer_id_fkey foreign key (payer_id) references public.profiles(id) on delete set null;
alter table public.business_payments drop constraint business_payments_reservation_id_fkey,
  add constraint business_payments_reservation_id_fkey foreign key (reservation_id) references public.business_reservations(id) on delete set null;

update public.business_payments p set partner_id = o.partner_id
  from public.business_reservations r join public.business_request_offers o on o.id = r.offer_id
  where r.id = p.reservation_id and p.partner_id is null;

create or replace function private.business_payment_has_money(p public.business_payments)
returns boolean language sql immutable as $$
  select p.stripe_payment_intent_id is not null or p.stripe_charge_id is not null or p.provider_transaction_id is not null
      or p.status in ('authorized', 'captured', 'refunded');
$$;

create or replace function private._business_payment_partner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reservation_id is not null then
    select o.partner_id into new.partner_id from public.business_reservations r join public.business_request_offers o on o.id = r.offer_id where r.id = new.reservation_id;
  elsif tg_op = 'UPDATE' and old.reservation_id is not null then
    -- the reservation is gone: what's left is the money, with no person on it
    new.detached_at := now();
    new.payer_id := null;
    new.failure_reason := null;
  end if;
  return new;
end;
$$;
drop trigger if exists a_business_payment_partner on public.business_payments;
create trigger a_business_payment_partner before insert or update of reservation_id on public.business_payments
  for each row execute function private._business_payment_partner();

create or replace function private._business_payment_detached()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.business_payment_has_money(new) then
    delete from public.business_payments where id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists z_business_payment_detached on public.business_payments;
create trigger z_business_payment_detached after update of reservation_id on public.business_payments
  for each row when (new.reservation_id is null and old.reservation_id is not null) execute function private._business_payment_detached();

-- ── payment exceptions ──
-- Money that needs a person to act on it: a paid booking ended because its customer left, or a payment that landed after its booking was cancelled.
-- No person on it, only the money facts a refund needs. Opened by the database, so nothing can miss it: the webhook is unchanged. A refund closes it by itself.
-- How long these are kept is counsel's answer (PRODUCT_AUDIT/ACCOUNT_DELETION_BLOCKERS_2026-11-08.md): nothing purges them.
create table private.payment_exceptions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null,
  partner_id uuid,
  kind text not null check (kind in ('paid_booking_ended', 'captured_after_cancellation')),
  amount numeric,
  currency text,
  stripe_payment_intent_id text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution in ('refunded', 'admin')),
  note text,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  last_reminded_at timestamptz
);
create unique index payment_exceptions_one_open on private.payment_exceptions (payment_id) where status = 'open';
create table private.payment_exception_events (
  id bigserial primary key,
  exception_id uuid not null references private.payment_exceptions(id),
  event text not null check (event in ('opened', 'reminded', 'resolved')),
  actor uuid,
  at timestamptz not null default now()
);
create or replace function private._payment_exception_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Payment exception events are append-only.';
end;
$$;
create trigger payment_exception_events_append_only before update or delete on private.payment_exception_events
  for each row execute function private._payment_exception_events_append_only();

create or replace function private._money_text(amount_param numeric, currency_param text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(upper(currency_param) || ' ' || to_char(amount_param, 'FM999999990.00'), 'the amount paid');
$$;

-- Opens at most one per payment, tells the business's owners and the admins. An already open one stays as it is.
create or replace function private._open_payment_exception(payment_param public.business_payments, kind_param text, leaving_param uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_money text := private._money_text(payment_param.amount, payment_param.currency);
  v_ref text := coalesce(' Stripe payment ' || payment_param.stripe_payment_intent_id || '.', '');
  v_partner uuid := coalesce(payment_param.partner_id, (select o.partner_id from public.business_reservations r
    join public.business_request_offers o on o.id = r.offer_id where r.id = payment_param.reservation_id));
  v_person uuid;
begin
  insert into private.payment_exceptions (payment_id, partner_id, kind, amount, currency, stripe_payment_intent_id)
    values (payment_param.id, v_partner, kind_param, payment_param.amount, payment_param.currency, payment_param.stripe_payment_intent_id)
    on conflict (payment_id) where status = 'open' do nothing returning id into v_id;
  if v_id is null then return; end if;
  insert into private.payment_exception_events (exception_id, event) values (v_id, 'opened');
  for v_person in select pr.id from public.profiles pr where pr.managed_partner_id = v_partner and pr.id is distinct from leaving_param loop
    perform public._send_push(v_person, 'A refund is needed',
      case kind_param when 'paid_booking_ended' then 'A paid reservation ended because the customer left Nearby. Please refund ' || v_money || ' in Stripe; it goes back to their payment method.'
        else 'A payment of ' || v_money || ' arrived after its reservation was cancelled. Please refund it in Stripe; it goes back to their payment method.' end || v_ref,
      jsonb_build_object('type', 'reservation_cancelled_by_customer'), 'payment_exception:' || v_id || ':' || v_person);
  end loop;
  for v_person in select pr.id from public.profiles pr where pr.is_admin is true and pr.suspended_at is null and pr.id is distinct from leaving_param loop
    perform public._send_push(v_person, 'A payment needs attention', 'A refund is owed: ' || v_money || '.',
      jsonb_build_object('type', 'admin_report_received'), 'payment_exception:' || v_id || ':' || v_person);
  end loop;
end;
$$;

-- The webhook writes the status; this reads it. A charge landing on a booking that's gone or cancelled opens an exception; a refund closes one.
create or replace function private._business_payment_status_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if new.status in ('captured', 'authorized') and old.status not in ('captured', 'authorized')
     and (new.reservation_id is null or exists (select 1 from public.business_reservations r where r.id = new.reservation_id and r.status = 'cancelled')) then
    perform private._open_payment_exception(new, 'captured_after_cancellation');
  elsif new.status = 'refunded' then
    update private.payment_exceptions set status = 'resolved', resolution = 'refunded', resolved_at = now()
      where payment_id = new.id and status = 'open' returning id into v_id;
    if v_id is not null then
      insert into private.payment_exception_events (exception_id, event) values (v_id, 'resolved');
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists z_business_payment_status_changed on public.business_payments;
create trigger z_business_payment_status_changed after update of status on public.business_payments
  for each row when (new.status is distinct from old.status) execute function private._business_payment_status_changed();

-- An open exception nobody has refunded reminds the admins after 3 days, then weekly. No screen: admins read and close these with the two functions below.
create or replace function private.remind_open_payment_exceptions()
returns void language plpgsql security definer set search_path = '' as $$
declare v_row record; v_person uuid;
begin
  for v_row in update private.payment_exceptions set last_reminded_at = now()
      where status = 'open' and opened_at < now() - interval '3 days'
        and (last_reminded_at is null or last_reminded_at < now() - interval '7 days')
      returning id, amount, currency loop
    insert into private.payment_exception_events (exception_id, event) values (v_row.id, 'reminded');
    for v_person in select pr.id from public.profiles pr where pr.is_admin is true and pr.suspended_at is null loop
      perform public._send_push(v_person, 'A refund is still owed', 'Not refunded yet: ' || private._money_text(v_row.amount, v_row.currency) || '.',
        jsonb_build_object('type', 'admin_report_received'), 'payment_exception_reminder:' || v_row.id || ':' || v_person || ':' || current_date);
    end loop;
  end loop;
end;
$$;
select cron.schedule('remind-open-payment-exceptions', '20 14 * * *', 'select private.remind_open_payment_exceptions()');

create or replace function public.admin_list_payment_exceptions()
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.check_is_admin(auth.uid()) then raise exception 'Not allowed.'; end if;
  return query select to_jsonb(e) from private.payment_exceptions e where e.status = 'open' order by e.opened_at;
end;
$$;
-- For what the refund can't show (handled outside Stripe, a dispute). The reason is required: it is the record.
create or replace function public.admin_resolve_payment_exception(exception_id_param uuid, note_param text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.check_is_admin(auth.uid()) then raise exception 'Not allowed.'; end if;
  if nullif(btrim(note_param), '') is null then raise exception 'A reason is required.'; end if;
  update private.payment_exceptions set status = 'resolved', resolution = 'admin', note = note_param, resolved_at = now()
    where id = exception_id_param and status = 'open';
  if not found then raise exception 'Not open.'; end if;
  insert into private.payment_exception_events (exception_id, event, actor) values (exception_id_param, 'resolved', auth.uid());
end;
$$;

revoke all on table private.payment_exceptions, private.payment_exception_events from public, anon, authenticated, service_role;
revoke all on function private._payment_exception_events_append_only() from public, anon, authenticated;
revoke all on function private._money_text(numeric, text) from public, anon, authenticated;
revoke all on function private._open_payment_exception(public.business_payments, text, uuid) from public, anon, authenticated;
revoke all on function private._business_payment_status_changed() from public, anon, authenticated;
revoke all on function private.remind_open_payment_exceptions() from public, anon, authenticated;
revoke all on function public.admin_list_payment_exceptions() from public, anon;
grant execute on function public.admin_list_payment_exceptions() to authenticated;
revoke all on function public.admin_resolve_payment_exception(uuid, text) from public, anon;
grant execute on function public.admin_resolve_payment_exception(uuid, text) to authenticated;

-- ── group plans ──
alter table public.group_plan_proposals drop constraint group_plan_proposals_initiator_id_fkey,
  add constraint group_plan_proposals_initiator_id_fkey foreign key (initiator_id) references public.profiles(id) on delete cascade;
alter table public.group_plan_proposals drop constraint group_plan_proposals_resulting_request_id_fkey,
  add constraint group_plan_proposals_resulting_request_id_fkey foreign key (resulting_request_id) references public.business_requests(id) on delete set null;
alter table public.group_plan_participants drop constraint group_plan_participants_user_id_fkey,
  add constraint group_plan_participants_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade;
alter table public.group_plan_participants drop constraint group_plan_participants_source_request_id_fkey,
  add constraint group_plan_participants_source_request_id_fkey foreign key (source_request_id) references public.business_requests(id) on delete cascade;
alter table public.group_plan_offer_confirmations drop constraint group_plan_offer_confirmations_user_id_fkey,
  add constraint group_plan_offer_confirmations_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade;
alter table public.group_plan_offer_confirmations drop constraint group_plan_offer_confirmations_offer_id_fkey,
  add constraint group_plan_offer_confirmations_offer_id_fkey foreign key (offer_id) references public.business_request_offers(id) on delete cascade;
alter table public.business_requests drop constraint business_requests_group_plan_id_fkey,
  add constraint business_requests_group_plan_id_fkey foreign key (group_plan_id) references public.group_plan_proposals(id) on delete set null;
alter table public.business_requests drop constraint business_requests_superseded_by_group_plan_id_fkey,
  add constraint business_requests_superseded_by_group_plan_id_fkey foreign key (superseded_by_group_plan_id) references public.group_plan_proposals(id) on delete set null;

-- Runs inside the profile delete, after held evidence is copied (a_ sorts first), before the cascades.
--   Someone else's plan: the person's row and confirmations go. The plan goes on, exactly as if they had left.
--   Their plan (owner, 2026-11-08, Option 1): it ends. Nobody is ever handed the organizer role, and nobody is handed a payment.
--     Each booking goes through the reservation cancellation everyone else uses (_cancel_reservation_by_offer), so capacity returns.
--     The business and everyone in the plan are told. Each person's own request comes back as it would on Reopen, so they can book again.
--   A paid booking (owner, 2026-11-08) never holds a deletion, and is never silently cancelled: the account goes, the money record stays with no person on it,
--     and a payment exception tells the business a refund is owed and tells the admins. Solo bookings the same: they already end with the customer's request.
create or replace function private._account_deletion_release_plans()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_me constant uuid := old.id;
  v_plan public.group_plan_proposals;
  v_offer record;
  v_result jsonb;
  v_booked boolean;
  v_person record;
  v_owner uuid;
  v_paid boolean;
  v_payment public.business_payments;
begin
  -- every plan the person is in, not just theirs: two people leaving one plan at once take turns here
  for v_plan in select * from public.group_plan_proposals p
      where p.initiator_id = v_me or exists (select 1 from public.group_plan_participants g where g.proposal_id = p.id and g.user_id = v_me)
      order by p.id for update loop
    continue when v_plan.initiator_id <> v_me;
    v_booked := false;
    for v_offer in select o.id, o.partner_id, o.request_id from public.business_request_offers o
        join public.business_requests r on r.id = o.request_id
        where o.status = 'accepted' and v_plan.resulting_request_id is not null
          and (r.id = v_plan.resulting_request_id or r.parent_request_id = v_plan.resulting_request_id)
        order by o.id loop
      -- the money comes off the booking first: an exception owes the refund, then the booking cancels like any unpaid one
      v_paid := false;
      for v_payment in select pay.* from public.business_payments pay join public.business_reservations res on res.id = pay.reservation_id
          where res.offer_id = v_offer.id and pay.status in ('captured', 'authorized') for update of pay loop
        perform private._open_payment_exception(v_payment, 'paid_booking_ended', v_me);
        update public.business_payments set reservation_id = null where id = v_payment.id;
        v_paid := true;
      end loop;
      v_result := public._cancel_reservation_by_offer(v_offer.id);
      -- not a live reservation (requested or failed): nothing to cancel, it goes with the request
      continue when not coalesce((v_result->>'cancelled')::boolean, false);
      v_booked := true;
      perform public._record_cancellation('business_reservation', v_offer.id, v_offer.partner_id, 'requester');
      continue when v_paid; -- the exception already told the business
      for v_owner in select pr.id from public.profiles pr where pr.managed_partner_id = v_offer.partner_id and pr.id <> v_me loop
        perform public._send_push(v_owner, 'A reservation was cancelled',
          'A customer cancelled their reservation: ' || public.business_safe_request_summary(v_offer.request_id),
          jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_offer.request_id, 'offer_id', v_offer.id));
      end loop;
    end loop;

    -- already over (visit completed, or cancelled or expired before): nobody is told, nothing reopens; only the row goes
    if v_plan.status not in ('pending', 'confirmed') or exists (select 1 from public.business_request_offers o
        where o.request_id = v_plan.resulting_request_id and o.status = 'completed') then
      delete from public.group_plan_proposals where id = v_plan.id;
      continue;
    end if;

    for v_person in select g.user_id, g.source_request_id from public.group_plan_participants g
        where g.proposal_id = v_plan.id and g.user_id <> v_me and g.status in ('accepted', 'invited') loop
      continue when not coalesce((select pr.notify_planning from public.profiles pr where pr.id = v_person.user_id), true);
      perform public._send_push(v_person.user_id, 'Your group plan was cancelled',
        'The organizer is no longer on Nearby, so your ' || coalesce(v_plan.category, 'group') || ' plan ended'
          || case when v_booked then ' and its booking was cancelled' else '' end
          || '. Your own request is still there if you want to book again.',
        jsonb_build_object('type', 'plan_cancelled', 'request_id', v_person.source_request_id));
    end loop;

    -- the same reopening as reopen_business_request; past its time it reads expired, where Reopen or Ask again takes over
    update public.business_request_offers o set status = 'pending'
      from public.business_requests r
      where o.request_id = r.id and r.superseded_by_group_plan_id = v_plan.id and r.requester_id <> v_me
        and r.status = 'merged' and r.expires_at > now() and o.status = 'expired' and o.responded_at is null;
    update public.business_requests r
      set status = case when r.expires_at > now() then 'open' else 'expired' end, superseded_by_group_plan_id = null
      where r.superseded_by_group_plan_id = v_plan.id and r.requester_id <> v_me and r.status = 'merged';

    perform public._record_cancellation('group_plan', v_plan.id, null, 'host');
    delete from public.group_plan_proposals where id = v_plan.id;
  end loop;
  -- their other paid bookings, still to happen: these end with their request, as they always have, and the refund is now on record
  for v_payment in select pay.* from public.business_payments pay
      join public.business_reservations res on res.id = pay.reservation_id
      join public.business_request_offers o on o.id = res.offer_id and o.status = 'accepted'
      join public.business_requests r on r.id = o.request_id and r.requester_id = v_me
      where pay.status in ('captured', 'authorized') for update of pay loop
    perform private._open_payment_exception(v_payment, 'paid_booking_ended', v_me);
  end loop;

  delete from public.group_plan_offer_confirmations where user_id = v_me;
  delete from public.group_plan_participants where user_id = v_me;

  -- an option the person suggested stays only if the group chose it (without their name); the rest go with them, as before
  delete from public.occasion_group_plan_options o where o.proposed_by = v_me
    and not exists (select 1 from public.occasion_group_plans g where g.winning_option_id = o.id);
  -- a claim nobody confirmed is theirs alone; a confirmed or invoiced one is the business's record
  delete from public.offer_redemptions where user_id = v_me and confirmed_at is null and invoice_id is null;
  return old;
end;
$$;
drop trigger if exists b_account_deletion_release_plans on public.profiles;
create trigger b_account_deletion_release_plans before delete on public.profiles
  for each row execute function private._account_deletion_release_plans();

-- What deleting would do, for the warning before it. A preview only: the trigger above decides. Own account only.
create or replace function public.account_deletion_plan_impact()
returns jsonb language sql stable security definer set search_path = '' as $$
  with mine as (
    select p.id, p.resulting_request_id from public.group_plan_proposals p
      where p.initiator_id = auth.uid() and p.status in ('pending', 'confirmed')
        and not exists (select 1 from public.business_request_offers o where o.request_id = p.resulting_request_id and o.status = 'completed')
  )
  select jsonb_build_object(
    'plans', (select count(*) from mine),
    'bookings', (select count(*) from mine m
      join public.business_requests r on r.id = m.resulting_request_id or r.parent_request_id = m.resulting_request_id
      join public.business_request_offers o on o.request_id = r.id and o.status = 'accepted'),
    'paid', (select count(*) from public.business_requests r
      join public.business_request_offers o on o.request_id = r.id and o.status = 'accepted'
      join public.business_reservations res on res.offer_id = o.id
      join public.business_payments pay on pay.reservation_id = res.id and pay.status in ('captured', 'authorized')
      where r.requester_id = auth.uid()));
$$;
revoke all on function public.account_deletion_plan_impact() from public, anon;
grant execute on function public.account_deletion_plan_impact() to authenticated;

revoke all on function private.business_payment_has_money(public.business_payments) from public, anon, authenticated;
revoke all on function private._business_payment_partner() from public, anon, authenticated;
revoke all on function private._business_payment_detached() from public, anon, authenticated;
revoke all on function private._account_deletion_release_plans() from public, anon, authenticated;

