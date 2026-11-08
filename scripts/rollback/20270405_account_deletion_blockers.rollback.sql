-- Rollback of 20270405 (run before rolling back anything older). Restores the keys, guards and columns. It refuses, with what it found, if rows
-- already depend on the new behaviour: a kept payment has no reservation to go back to, and the old NOT NULL columns can't hold a deleted person's
-- cleared id. Those rows are records of real deletions, so removing them is the owner's decision, never this script's. Defect only; owner decides.
do $$
declare v jsonb;
begin
  v := jsonb_strip_nulls(jsonb_build_object(
    'kept_payments', nullif((select count(*) from public.business_payments where reservation_id is null), 0),
    'submissions_without_submitter', nullif((select count(*) from public.business_offer_submissions where submitted_by is null), 0),
    'organizers_without_adder', nullif((select count(*) from public.plan_organizers where added_by is null), 0),
    'options_without_author', nullif((select count(*) from public.occasion_group_plan_options where proposed_by is null), 0)));
  if v <> '{}'::jsonb then raise exception 'Rollback refused: rows depend on 20270405: %', v; end if;
end $$;

drop trigger if exists b_account_deletion_release_plans on public.profiles;
drop function if exists private._account_deletion_release_plans();
drop trigger if exists z_business_payment_detached on public.business_payments;
drop trigger if exists a_business_payment_partner on public.business_payments;
drop function if exists private._business_payment_detached();
drop function if exists private._business_payment_partner();
drop function if exists private.business_payment_has_money(public.business_payments);

alter table public.business_requests drop constraint business_requests_superseded_by_group_plan_id_fkey,
  add constraint business_requests_superseded_by_group_plan_id_fkey foreign key (superseded_by_group_plan_id) references public.group_plan_proposals(id);
alter table public.business_requests drop constraint business_requests_group_plan_id_fkey,
  add constraint business_requests_group_plan_id_fkey foreign key (group_plan_id) references public.group_plan_proposals(id);
alter table public.group_plan_offer_confirmations drop constraint group_plan_offer_confirmations_offer_id_fkey,
  add constraint group_plan_offer_confirmations_offer_id_fkey foreign key (offer_id) references public.business_request_offers(id);
alter table public.group_plan_offer_confirmations drop constraint group_plan_offer_confirmations_user_id_fkey,
  add constraint group_plan_offer_confirmations_user_id_fkey foreign key (user_id) references public.profiles(id);
alter table public.group_plan_participants drop constraint group_plan_participants_source_request_id_fkey,
  add constraint group_plan_participants_source_request_id_fkey foreign key (source_request_id) references public.business_requests(id);
alter table public.group_plan_participants drop constraint group_plan_participants_user_id_fkey,
  add constraint group_plan_participants_user_id_fkey foreign key (user_id) references public.profiles(id);
alter table public.group_plan_proposals drop constraint group_plan_proposals_resulting_request_id_fkey,
  add constraint group_plan_proposals_resulting_request_id_fkey foreign key (resulting_request_id) references public.business_requests(id);
alter table public.group_plan_proposals drop constraint group_plan_proposals_initiator_id_fkey,
  add constraint group_plan_proposals_initiator_id_fkey foreign key (initiator_id) references public.profiles(id);

alter table public.business_payments drop constraint business_payments_reservation_id_fkey,
  add constraint business_payments_reservation_id_fkey foreign key (reservation_id) references public.business_reservations(id) on delete cascade;
alter table public.business_payments drop constraint business_payments_payer_id_fkey,
  add constraint business_payments_payer_id_fkey foreign key (payer_id) references public.profiles(id);
alter table public.business_payments alter column reservation_id set not null;
alter table public.business_payments drop column if exists detached_at, drop column if exists partner_id;

alter table public.offer_redemptions drop constraint offer_redemptions_user_id_fkey,
  add constraint offer_redemptions_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade;
alter table public.offer_redemptions drop constraint offer_redemptions_confirmed_by_fkey,
  add constraint offer_redemptions_confirmed_by_fkey foreign key (confirmed_by) references public.profiles(id);

alter table public.occasion_group_plans drop constraint occasion_group_plans_winning_option_fkey,
  add constraint occasion_group_plans_winning_option_fkey foreign key (winning_option_id) references public.occasion_group_plan_options(id);
alter table public.occasion_group_plan_options drop constraint occasion_group_plan_options_proposed_by_fkey,
  add constraint occasion_group_plan_options_proposed_by_fkey foreign key (proposed_by) references public.profiles(id) on delete cascade;
alter table public.plan_organizers drop constraint plan_organizers_added_by_fkey,
  add constraint plan_organizers_added_by_fkey foreign key (added_by) references public.profiles(id);
alter table public.business_offer_submissions drop constraint business_offer_submissions_submitted_by_fkey,
  add constraint business_offer_submissions_submitted_by_fkey foreign key (submitted_by) references public.profiles(id);
alter table public.business_partner_requests drop constraint business_partner_requests_reviewed_by_fkey,
  add constraint business_partner_requests_reviewed_by_fkey foreign key (reviewed_by) references public.profiles(id);
alter table public.business_customer_notes drop constraint business_customer_notes_updated_by_fkey,
  add constraint business_customer_notes_updated_by_fkey foreign key (updated_by) references public.profiles(id);
alter table public.business_content_screening_results drop constraint business_content_screening_results_reviewed_by_fkey,
  add constraint business_content_screening_results_reviewed_by_fkey foreign key (reviewed_by) references public.profiles(id);
alter table public.business_content_screening_results drop constraint business_content_screening_results_submitted_by_fkey,
  add constraint business_content_screening_results_submitted_by_fkey foreign key (submitted_by) references public.profiles(id);
alter table public.occasion_group_plan_options alter column proposed_by set not null;
alter table public.plan_organizers alter column added_by set not null;
alter table public.business_offer_submissions alter column submitted_by set not null;

create or replace function public._sponsored_terms_acceptance_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'A terms acceptance cannot be deleted'; end if;
  if (new.id, new.user_id, new.partner_id, new.placement_id, new.payment_id, new.terms_version, new.accepted_at)
     is distinct from (old.id, old.user_id, old.partner_id, old.placement_id, old.payment_id, old.terms_version, old.accepted_at)
     or (old.stripe_checkout_session_id is not null and new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id) then
    raise exception 'A terms acceptance is immutable';
  end if;
  return new;
end $$;

create or replace function private._account_restrictions_guard()
returns trigger language plpgsql as $$
begin
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
