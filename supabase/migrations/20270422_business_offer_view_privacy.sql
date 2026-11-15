-- A customer's read receipt on a business reply never reaches the business (owner, 2026-11-15; item 77: no view counts).
--
-- Before: business_request_offers.viewed_at (set by mark_business_offer_viewed when the requester opens a reply) was
-- readable by the business three ways: (1) get_partner_offer_performance's viewed_count, (2) get_business_opportunities'
-- per-offer viewed_at, (3) a direct SELECT of its own offer rows (policy "Business owners can view their own offer rows",
-- no column limit), plus (4) the realtime UPDATE event its dashboard receives the moment a customer opens a reply.
-- Column grants can't tell a customer from a business (same role), so the receipt moves out of the offer row:
--   * business_offer_views (offer_id, viewed_at): one row per opened reply, readable by anyone who can see the offer
--     EXCEPT the business that sent it; no client write (only mark_business_offer_viewed, definer).
--   * business_request_offers.viewed_at is emptied and kept NULL by a check constraint (builds <= 87 still select the
--     column by name, so it stays until no build reads it; they read NULL = "not viewed", which only affects their
--     first-reply wording, never a business). Opening a reply no longer updates the offer row (no realtime signal).
--   * get_business_opportunities: same definition as 20270313 minus bro.viewed_at.
--   * get_partner_offer_performance: same query minus viewed_count (return type change = drop + create).
-- Not changed: social_offers.viewed_at (person-to-person offers, no business involved); the service-role-only
-- request_journey view lists o.viewed_at (now NULL; the receipt is in business_offer_views for service-role diagnosis);
-- the digest's "o.viewed_at is null" on pending rows (always true before too, see 20270151).
-- Deploy gate: only after a released build without the per-group "viewed" line replaces build 87 AND the business
-- website is re-exported from this branch (build 87's Offer Performance would otherwise print "{viewedCount} viewed").

create table public.business_offer_views (
  offer_id uuid primary key references public.business_request_offers(id) on delete cascade,
  viewed_at timestamptz not null default now()
);
alter table public.business_offer_views enable row level security;
revoke all on public.business_offer_views from public, anon, authenticated;
grant select on public.business_offer_views to authenticated;
grant all on public.business_offer_views to service_role;

-- Visible to whoever can see the offer row (the subquery runs under business_request_offers' own RLS: requester,
-- plan organizers, gathering attendees, match partners), never to the business that sent it.
create policy "Offer viewers other than its business can see the receipt"
on public.business_offer_views for select to authenticated
using (
  exists (
    select 1 from public.business_request_offers bro
    where bro.id = business_offer_views.offer_id
      and bro.partner_id is distinct from public.my_managed_partner_id()
  )
);

-- Move existing receipts. Only viewed_at changes on these rows; offer triggers are about status, media, discounts and
-- party sizes, so they are held off for this one statement rather than re-validating old rows.
insert into public.business_offer_views (offer_id, viewed_at)
select id, viewed_at from public.business_request_offers where viewed_at is not null
on conflict (offer_id) do nothing;

alter table public.business_request_offers disable trigger user;
update public.business_request_offers set viewed_at = null where viewed_at is not null;
alter table public.business_request_offers enable trigger user;

alter table public.business_request_offers
  add constraint business_request_offers_viewed_at_moved check (viewed_at is null);

create or replace function public.mark_business_offer_viewed(offer_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into business_offer_views (offer_id)
  select bro.id
  from business_request_offers bro
  join business_requests br on br.id = bro.request_id
  where bro.id = offer_id_param
    and br.requester_id = auth.uid()
  on conflict (offer_id) do nothing;
end;
$function$;

revoke all on function public.mark_business_offer_viewed(uuid) from public, anon;
grant execute on function public.mark_business_offer_viewed(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.get_business_opportunities(partner_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'Not authorized for this business';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      bro.id, bro.request_id, bro.partner_id, bro.offer_type, bro.offer_price, bro.price_is_per_person,
      bro.offer_description, bro.proposed_time, bro.proposed_time_alt, bro.proposed_party_size_alt, bro.proposed_party_size, bro.created_at, bro.expires_at,
      bro.offer_title, bro.included_items, bro.discount_pct, bro.valid_until, bro.available_from, bro.available_until,
      bro.auto_reply, bro.revision, bro.revised_at,
      bro.responded_at, bro.accepted_at, bro.completed_at, bro.status,
      bro.availability_id, bro.decline_reason, bro.decline_note,
      bro.experience_id, bro.media_path, bro.media_type, bro.cancelled_at, bro.package_id, bro.is_directed,
      jsonb_build_object(
        'category', br.category,
        -- Item 119b: a booking made for fewer people shows the headcount booked (summary too), never the 6 asked for.
        'party_size', coalesce(bro.proposed_party_size, br.party_size),
        'budget_min', br.budget_min,
        'budget_max', br.budget_max,
        'date', br.date,
        'time_window_start', br.time_window_start,
        'time_window_end', br.time_window_end,
        'status', br.status,
        'expires_at', br.expires_at,
        'summary', case when bro.proposed_party_size is not null and br.party_size is not null
          then replace(public.business_safe_request_summary(br.id), 'party of ' || br.party_size, 'party of ' || bro.proposed_party_size)
          else public.business_safe_request_summary(br.id) end,
        'is_match_request', br.match_id is not null,
        'attributes', br.attributes,
        'dietary', case when cardinality(br.dietary) > 0 then to_jsonb(br.dietary) else null end,
        'cuisine', br.cuisine,
        'requested_items', case when cardinality(br.requested_items) > 0 then to_jsonb(br.requested_items) else null end,
        'occasion', br.occasion,
        'experience_level', br.experience_level,
        'surprise_mode', br.surprise_mode,
        'addon_type', br.addon_type,
        'is_addon', br.parent_request_id is not null,
        'plan_time', br.plan_time,
        'note', case when bro.is_directed then br.note_for_business else null end,
        'gatherings', case when g.id is not null then jsonb_build_object(
          'interest_tag', g.interest_tag,
          'title', case when bro.is_directed and public._title_safe_for_business(g.title) then g.title else null end,
          'scheduled_at', g.scheduled_at,
          'price_level', g.price_level
        ) else null end,
        'requester_display_name', case
          when bro.status in ('accepted', 'completed') and br.match_id is null
          then req.display_name
          else null
        end
      ) as business_requests,
      case when bres.id is not null then jsonb_build_object(
        'status', bres.status,
        'business_payments', case when bp.id is not null then jsonb_build_object('status', bp.status) else null end
      ) else null end as business_reservations
    from public.business_request_offers bro
    join public.business_requests br on br.id = bro.request_id
    left join public.gatherings g on g.id = br.gathering_id
    left join public.profiles req on req.id = br.requester_id
    left join public.business_reservations bres on bres.offer_id = bro.id
    left join public.business_payments bp on bp.reservation_id = bres.id
    where bro.partner_id = partner_id_param
  ) t;

  return v_result;
end;
$function$;

drop function public.get_partner_offer_performance(uuid);
create function public.get_partner_offer_performance(partner_id_param uuid)
returns table (
  group_key text,
  group_label text,
  offer_count bigint,
  accepted_count bigint,
  completed_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    return;
  end if;

  return query
  select
    coalesce(bro.experience_id::text, 'offer_type:' || coalesce(bro.offer_type, 'standard')) as group_key,
    coalesce(be.title, initcap(replace(coalesce(min(bro.offer_type), 'standard'), '_', ' '))) as group_label,
    count(*)::bigint as offer_count,
    count(*) filter (where bro.status in ('accepted', 'completed'))::bigint as accepted_count,
    count(*) filter (where bro.status = 'completed')::bigint as completed_count
  from business_request_offers bro
  left join business_experiences be on be.id = bro.experience_id
  where bro.partner_id = partner_id_param
    and bro.status in ('offered', 'accepted', 'declined', 'expired', 'cancelled', 'completed')
  group by
    coalesce(bro.experience_id::text, 'offer_type:' || coalesce(bro.offer_type, 'standard')),
    be.title
  order by offer_count desc;
end;
$$;

revoke all on function public.get_partner_offer_performance(uuid) from public, anon;
grant execute on function public.get_partner_offer_performance(uuid) to authenticated;
