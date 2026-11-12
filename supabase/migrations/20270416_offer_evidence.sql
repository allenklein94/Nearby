-- Offer evidence outlives a deletion while it is under report, investigation or legal hold + admin offer history (owner idea 39,
-- 2026-11-12). Staged after 20270415; deploy only with its own approval, in number order.
--
-- Audit first (read-only, local replay of all 539, 2026-11-12): a BUSINESS row is never deleted by any client or function (RLS on,
-- no delete policy, no function deletes brand_partners); deleting the owner's account leaves the business, its offers and its
-- screening results (submitted_by set null, 20270405). Screening results are never purged. The gap: an offer row is deleted with
-- its REQUEST, so a customer deleting their account (or a service-role delete of a business) takes every offer to them with it,
-- including one under report. 0355 keeps the report and its text copy, 0372 adds the business name, but not which business: with
-- the manager's account also gone, the report can no longer be tied to the business.
--
-- 1. private.offer_evidence: when an offer row is deleted for ANY reason, and at that moment it is covered by
--      - an unresolved report about that offer or about its business (0372 / 0381), or a resolved one under a legal hold (0395), or
--      - an open account review case (0369) about a manager of the business, or
--      - an active legal hold on a manager's account (0403),
--    one row keeps the BUSINESS side only: offer id, business id + name, the request id (a bare id, nothing about the request),
--    what the business sent (title, description, items, redemption instructions, type, price, discount, proposed times), status and
--    its times (created, sent, viewed, accepted, completed, cancelled), the latest screening result's risk level + time, and which
--    reports / cases / holds kept it. Never the customer: no requester id, name, note, request text, party, place or payment.
--    Nothing covered = nothing kept (an ordinary deletion is unchanged). A failure here never blocks the deletion: it is logged
--    (private.offer_evidence_failures: offer id, error code, time; no content) and the deletion carries on.
-- 2. Retention: no new period. A row lives exactly as long as something that kept it: a kept report still exists (reports follow
--    0355's 12 months after resolve, skipped while held), a kept case still exists (0369's purge, holds respected), or a kept hold
--    is still active. Daily purge under the legal-hold lock; an append-only log of counts.
-- 3. public.admin_business_offer_history(partner, limit): admins only (check_is_admin). The business's offers, newest first:
--    live rows + kept rows, each with screening outcome (or 'automatic'), viewed / accepted / completed / cancelled times and
--    whether it is reported. No customer field. Shown as one collapsible section on the existing admin business review card.
-- No client can read or write the evidence tables. No screen, score, restriction or notice. No existing row changes.

create table if not exists private.offer_evidence (
  offer_id uuid primary key,
  partner_id uuid not null,
  partner_name text,
  request_id uuid,
  offer_type text,
  offer_title text,
  offer_description text,
  included_items text[],
  redemption_instructions text,
  offer_price numeric,
  price_is_per_person boolean,
  discount_pct numeric,
  proposed_time timestamptz,
  proposed_time_alt timestamptz,
  auto_reply text,
  status text,
  created_at timestamptz,
  responded_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  screening_risk_tier text,
  screened_at timestamptz,
  kept_for_reports uuid[] not null default '{}',
  kept_for_cases uuid[] not null default '{}',
  kept_for_holds uuid[] not null default '{}',
  kept_at timestamptz not null default now(),
  constraint offer_evidence_kept_for_something check (
    cardinality(kept_for_reports) + cardinality(kept_for_cases) + cardinality(kept_for_holds) > 0)
);
create index if not exists offer_evidence_partner_idx on private.offer_evidence (partner_id, created_at desc);

create table if not exists private.offer_evidence_failures (
  id bigint generated always as identity primary key,
  offer_id uuid,
  sqlstate text,
  at timestamptz not null default now()
);

create table if not exists private.offer_evidence_purge_log (
  id bigint generated always as identity primary key,
  purged integer not null,
  at timestamptz not null default now()
);

revoke all on private.offer_evidence, private.offer_evidence_failures, private.offer_evidence_purge_log
  from public, anon, authenticated, service_role;

-- What covers an offer right now (the deciding rule, also used by the admin history's "reported" flag).
create or replace function private.offer_evidence_reasons(p_offer uuid, p_partner uuid,
  out report_ids uuid[], out case_ids uuid[], out hold_ids uuid[])
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_managers uuid[];
begin
  select coalesce(array_agg(r.id), '{}') into report_ids
    from reports r
   where ((r.content_type = 'business_offer' and r.content_id = p_offer)
       or (r.content_type = 'business' and r.content_id = p_partner))
     and (not coalesce(r.resolved, false) or private.report_on_legal_hold(r.id));
  -- Managers: the business's current managers + whoever the kept reports name (a manager whose link was already cleared).
  select coalesce(array_agg(distinct m), '{}') into v_managers
    from (select p.id as m from profiles p where p.managed_partner_id = p_partner
          union select r.reported_id from reports r where r.id = any(report_ids) and r.reported_id is not null) x;
  select coalesce(array_agg(distinct c.id), '{}') into case_ids
    from private.account_review_cases c
   where c.status = 'open'
     and (c.subject_user = any(v_managers)
          or exists (select 1 from private.account_review_case_members cm where cm.case_id = c.id and cm.user_id = any(v_managers)));
  select coalesce(array_agg(h.id), '{}') into hold_ids
    from private.legal_holds h
   where h.released_at is null and h.target_type = 'account' and h.target_id = any(v_managers);
end;
$function$;

create or replace function private._keep_offer_evidence()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_reasons record;
  v_name text;
  v_tier text;
  v_screened timestamptz;
  v_state text;
begin
  if old.status = 'pending' then
    return old; -- a routed request the business never answered: nothing the business sent
  end if;
  begin
    select * into v_reasons from private.offer_evidence_reasons(old.id, old.partner_id);
    if cardinality(v_reasons.report_ids) + cardinality(v_reasons.case_ids) + cardinality(v_reasons.hold_ids) = 0 then
      return old;
    end if;
    select bp.name into v_name from brand_partners bp where bp.id = old.partner_id;
    select s.risk_tier, s.created_at into v_tier, v_screened
      from business_content_screening_results s
     where s.partner_id = old.partner_id and s.target_type = 'offer_response' and s.target_id = old.request_id
     order by s.created_at desc limit 1;
    insert into private.offer_evidence (offer_id, partner_id, partner_name, request_id, offer_type, offer_title, offer_description,
        included_items, redemption_instructions, offer_price, price_is_per_person, discount_pct, proposed_time, proposed_time_alt,
        auto_reply, status, created_at, responded_at, viewed_at, accepted_at, completed_at, cancelled_at,
        screening_risk_tier, screened_at, kept_for_reports, kept_for_cases, kept_for_holds)
      values (old.id, old.partner_id, v_name, old.request_id, old.offer_type, old.offer_title, old.offer_description,
        old.included_items, old.redemption_instructions, old.offer_price, old.price_is_per_person, old.discount_pct,
        old.proposed_time, old.proposed_time_alt, old.auto_reply, old.status, old.created_at, old.responded_at, old.viewed_at,
        old.accepted_at, old.completed_at, old.cancelled_at, v_tier, v_screened,
        v_reasons.report_ids, v_reasons.case_ids, v_reasons.hold_ids)
      on conflict (offer_id) do nothing;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    begin
      insert into private.offer_evidence_failures (offer_id, sqlstate) values (old.id, v_state);
    exception when others then null;
    end;
  end;
  return old;
end;
$function$;

drop trigger if exists keep_offer_evidence on public.business_request_offers;
create trigger keep_offer_evidence before delete on public.business_request_offers
  for each row execute function private._keep_offer_evidence();

create or replace function private.purge_offer_evidence()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  perform private.legal_hold_lock();
  delete from private.offer_evidence e
   where not exists (select 1 from reports r where r.id = any(e.kept_for_reports))
     and not exists (select 1 from private.account_review_cases c where c.id = any(e.kept_for_cases))
     and not exists (select 1 from private.legal_holds h where h.id = any(e.kept_for_holds) and h.released_at is null);
  get diagnostics v_n = row_count;
  insert into private.offer_evidence_purge_log (purged) values (v_n);
  return v_n;
end;
$function$;

revoke all on function private.offer_evidence_reasons(uuid, uuid) from public, anon, authenticated;
revoke all on function private._keep_offer_evidence() from public, anon, authenticated;
revoke all on function private.purge_offer_evidence() from public, anon, authenticated;

select cron.unschedule('purge-offer-evidence') where exists (select 1 from cron.job where jobname = 'purge-offer-evidence');
select cron.schedule('purge-offer-evidence', '41 4 * * *', 'select private.purge_offer_evidence();');

-- Admin offer history: live offers + kept evidence, business side only.
create or replace function public.admin_business_offer_history(partner_id_param uuid, limit_param integer default 50)
returns table (offer_id uuid, source text, created_at timestamptz, offer_title text, offer_description text, status text,
               screening text, screened_at timestamptz, viewed_at timestamptz, accepted_at timestamptz, completed_at timestamptz,
               cancelled_at timestamptz, reported boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Admins only' using errcode = '42501', hint = 'admin_only';
  end if;
  return query
  with live as (
    select o.id, 'live'::text as src, o.created_at, o.offer_title, o.offer_description, o.status,
           case when o.auto_reply is not null then 'automatic' else s.risk_tier end as scr, s.created_at as scr_at,
           o.viewed_at, o.accepted_at, o.completed_at, o.cancelled_at
      from business_request_offers o
      left join lateral (select r.risk_tier, r.created_at from business_content_screening_results r
                          where r.partner_id = o.partner_id and r.target_type = 'offer_response' and r.target_id = o.request_id
                          order by r.created_at desc limit 1) s on true
     where o.partner_id = partner_id_param and o.status <> 'pending'
  ), kept as (
    select e.offer_id, 'kept'::text, e.created_at, e.offer_title, e.offer_description, e.status,
           case when e.auto_reply is not null then 'automatic' else e.screening_risk_tier end, e.screened_at,
           e.viewed_at, e.accepted_at, e.completed_at, e.cancelled_at
      from private.offer_evidence e
     where e.partner_id = partner_id_param
  )
  select a.id, a.src, a.created_at, a.offer_title, a.offer_description, a.status, a.scr, a.scr_at, a.viewed_at, a.accepted_at,
         a.completed_at, a.cancelled_at,
         exists (select 1 from reports r where r.content_type = 'business_offer' and r.content_id = a.id)
    from (select * from live union all select * from kept) a
   order by a.created_at desc nulls last
   limit greatest(1, least(coalesce(limit_param, 50), 200));
end;
$function$;

revoke all on function public.admin_business_offer_history(uuid, integer) from public, anon;
grant execute on function public.admin_business_offer_history(uuid, integer) to authenticated;
