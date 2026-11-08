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
-- Nothing here changes what happens to anything else on a deletion. delete-account answers a refused deletion (hint group_plan_booking_unresolved) and checks before it starts.


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
--     Each booking goes through the reservation cancellation everyone else uses (_cancel_reservation_by_offer), so capacity returns and its
--     refusal stands. A booking it refuses (paid or authorized: there is no automatic refund) refuses this whole deletion: nothing changes, the
--     person is told what to do (hint group_plan_booking_unresolved), and the booking stays with an organizer who still exists.
--     The business and everyone in the plan are told. Each person's own request comes back as it would on Reopen, so they can book again.
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
      v_result := public._cancel_reservation_by_offer(v_offer.id);
      if not coalesce((v_result->>'cancelled')::boolean, false) then
        raise exception 'A group plan you organize has a booking that can''t be cancelled yet.'
          using errcode = 'P0001', hint = 'group_plan_booking_unresolved';
      end if;
      v_booked := true;
      perform public._record_cancellation('business_reservation', v_offer.id, v_offer.partner_id, 'requester');
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

-- What deleting would do to the plans a person organizes, for the warning before it and delete-account's answer. A preview only: the trigger above
-- decides. "unresolved" names what _cancel_reservation_by_offer refuses; journey step preview_matches_refusal keeps the two the same.
create or replace function private._account_deletion_plan_impact(user_id_param uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with mine as (
    select p.id, p.resulting_request_id from public.group_plan_proposals p
      where p.initiator_id = user_id_param and p.status in ('pending', 'confirmed')
        and not exists (select 1 from public.business_request_offers o where o.request_id = p.resulting_request_id and o.status = 'completed')
  ), bookings as (
    select o.id, res.status as reservation_status, pay.status as payment_status
      from mine m
      join public.business_requests r on r.id = m.resulting_request_id or r.parent_request_id = m.resulting_request_id
      join public.business_request_offers o on o.request_id = r.id and o.status = 'accepted'
      left join public.business_reservations res on res.offer_id = o.id
      left join public.business_payments pay on pay.reservation_id = res.id
  )
  select jsonb_build_object(
    'plans', (select count(*) from mine),
    'bookings', (select count(*) from bookings),
    'unresolved', (select count(*) from bookings b
      where b.reservation_status is distinct from 'confirmed' or b.payment_status in ('captured', 'authorized')));
$$;
create or replace function public.account_deletion_plan_impact()
returns jsonb language sql stable security definer set search_path = '' as $$
  select private._account_deletion_plan_impact(auth.uid());
$$;
create or replace function public.account_deletion_plan_check(user_id_param uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private._account_deletion_plan_impact(user_id_param);
$$;
revoke all on function private._account_deletion_plan_impact(uuid) from public, anon, authenticated, service_role;
revoke all on function public.account_deletion_plan_impact() from public, anon;
grant execute on function public.account_deletion_plan_impact() to authenticated;
revoke all on function public.account_deletion_plan_check(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_plan_check(uuid) to service_role;

revoke all on function private.business_payment_has_money(public.business_payments) from public, anon, authenticated;
revoke all on function private._business_payment_partner() from public, anon, authenticated;
revoke all on function private._business_payment_detached() from public, anon, authenticated;
revoke all on function private._account_deletion_release_plans() from public, anon, authenticated;

