-- Owner item 51 (2026-10-12): a business's first-ever offer gets its own confirmation (words only).
-- ONE server fact: the first business_request_offers row of a partner that ever reached a customer (status 'offered'),
-- by ANY path (owner send, one-tap reply, reviewer approval, standing availability/package/policy match, auto-respond).
-- Claimed atomically by the primary key: concurrent sends race on one insert, exactly one wins, and the claim is never
-- re-taken (a later withdraw/expire/delete does not make the next offer "first" again). No client grants: read only
-- through get_my_offer_submissions (queued path) and by screen-business-content (service role, live path).

create table if not exists public.partner_first_offers (
  partner_id uuid primary key references public.brand_partners(id) on delete cascade,
  offer_id uuid not null,
  request_id uuid not null,
  claimed_at timestamptz not null default now()
);
alter table public.partner_first_offers enable row level security;
revoke all on public.partner_first_offers from public, anon, authenticated;

create or replace function public._claim_partner_first_offer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'offered' and (tg_op = 'INSERT' or old.status is distinct from 'offered') then
    insert into partner_first_offers (partner_id, offer_id, request_id)
    values (new.partner_id, new.id, new.request_id)
    on conflict (partner_id) do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public._claim_partner_first_offer() from public, anon, authenticated;

drop trigger if exists business_request_offers_claim_first_offer on public.business_request_offers;
create trigger business_request_offers_claim_first_offer
  after insert or update of status on public.business_request_offers
  for each row execute function public._claim_partner_first_offer();

-- Backfill: a business that has already had an offer reach a customer never gets the first-offer line.
-- Every non-declined reply that was responded to passed through 'offered'; the earliest one is its first.
insert into partner_first_offers (partner_id, offer_id, request_id, claimed_at)
select distinct on (o.partner_id) o.partner_id, o.id, o.request_id, coalesce(o.responded_at, o.created_at)
from business_request_offers o
where o.status <> 'declined' and o.status <> 'pending' and o.responded_at is not null
order by o.partner_id, o.responded_at, o.id
on conflict (partner_id) do nothing;

-- get_my_offer_submissions gains is_first_offer (a changed return shape needs a drop; one overload, same grants).
drop function if exists public.get_my_offer_submissions(uuid);
create function public.get_my_offer_submissions(partner_id_param uuid)
 returns table(id uuid, request_id uuid, status text, reason text, matched_categories text[], payload jsonb, created_at timestamp with time zone, retryable boolean, is_first_offer boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.managed_partner_id = partner_id_param) then
    raise exception 'You do not manage this business';
  end if;
  return query
  select x.id, x.request_id, x.status, x.reason, x.matched_categories, x.payload, x.created_at, x.retryable,
    -- item 51: only a sent submission, and only the one whose request holds the business's first-ever offer
    -- ((request_id, partner_id) is unique on business_request_offers, so this also covers reviewer-approved offers).
    (x.status = 'published' and exists (select 1 from partner_first_offers f where f.partner_id = partner_id_param and f.request_id = x.request_id))
  from (
    select s.id, s.request_id,
      case
        when s.status = 'in_review' and r.review_outcome = 'approved' then 'published'
        when s.status = 'in_review' and r.review_outcome = 'denied' then 'needs_changes'
        when s.status = 'reviewing' and s.updated_at < now() - interval '3 minutes' then 'unavailable'
        else s.status
      end as status,
      case when s.status = 'in_review' and r.review_outcome = 'denied' then 'Our review team could not approve this offer.' else s.reason end as reason,
      s.matched_categories,
      s.payload,
      s.created_at,
      (s.status = 'unavailable' or (s.status = 'reviewing' and s.updated_at < now() - interval '3 minutes')) as retryable
    from business_offer_submissions s
    left join business_content_screening_results r on r.id = s.screening_id
    where s.partner_id = partner_id_param
      and s.dismissed_at is null
      and s.created_at > now() - interval '7 days'
    order by s.created_at desc
    limit 50
  ) x
  order by x.created_at desc;
end;
$function$;
revoke all on function public.get_my_offer_submissions(uuid) from public, anon;
grant execute on function public.get_my_offer_submissions(uuid) to authenticated, service_role;
