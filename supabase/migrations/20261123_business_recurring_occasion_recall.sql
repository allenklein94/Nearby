-- Item 102 (CLAUDE.md, "Businesses can participate in recurring occasions").
-- User's own example: a business could eventually see "This customer
-- celebrated here last year" and potentially offer "Welcome back --
-- anniversary package available" -- "subject to privacy and appropriate
-- consent."
--
-- Direct continuation of Item 101 ("Occasions can become recurring"),
-- which already built get_occasion_recall() -- a real, owner-only read of
-- what happened the last time a recurring occasion was fulfilled through a
-- real accepted business_request_offers row. This item is the same real
-- history read from the OTHER side, gated behind a brand-new, separate,
-- explicit consent the consumer controls -- never inferred from the
-- reservation itself, and never the same thing as get_business_
-- opportunities()'s existing post-acceptance requester_display_name reveal
-- (Item 69), which is about ONE already-confirmed booking, not a durable,
-- recurring "recognize me next year" relationship.
--
-- Two real, separate pieces:
--
-- (1) A new occasions.recall_shareable_with_business column (default
-- false, same "share this too, opt-in, default OFF" posture Item 62's own
-- connected_user_id checkbox and Item 101's own recall card both already
-- established) -- the consumer's own explicit, per-occasion consent that
-- the SPECIFIC business they were last fulfilled through may recognize
-- them as a returning customer next time this occasion comes around.
-- Consent is scoped to whichever business the real history already points
-- to -- there is no separate "which business" picker, because the whole
-- point is recognizing a real relationship that already exists, not
-- broadcasting to arbitrary nearby businesses.
--
-- (2) get_business_returning_occasion_customers(partner_id): a business-
-- owner-only read (same profiles.managed_partner_id ownership check every
-- other business RPC in this schema uses) that surfaces exactly the real
-- customers who (a) explicitly consented, (b) have a real recurring
-- occasion, and (c) were genuinely fulfilled through THIS business via a
-- real accepted/completed business_request_offers row -- never a
-- prospective/declined one, never a different business's customer.
-- Bounded to a real, disclosed judgment call (next occurrence within 60
-- days) so the dashboard reads as timely "reach out now" candidates, not a
-- year-round list. send_business_recall_outreach() is the real, rate-
-- limited (once per occurrence, mirroring send_occasion_planning_nudges()'
-- own once-per-year dedup shape) action a business can take on one of
-- these rows -- a real push to the real returning customer, optionally
-- naming one of the business's own already-built Occasion Packages (Item
-- 68) rather than inventing a second offer-content mechanism.
--
-- What is deliberately NOT exposed to the business, even with consent:
-- who_for_name (the occasion may be FOR a third party the requester
-- organized for -- e.g. a spouse's surprise anniversary dinner they
-- themselves booked; the business needs to recognize the returning
-- BOOKER, not learn who the occasion's who-for is), and any occasion
-- with surprise_mode set is not specially excluded (surprise_mode hides
-- an occasion from its own who_for person, an entirely different boundary
-- than this one, and the outreach push here only ever reaches the
-- requester who themselves opted in) but who_for_name is withheld
-- regardless, out of the same privacy-minimalism discipline as Item 69's
-- original "the business gets only what it needs" rule.

alter table public.occasions
  add column if not exists recall_shareable_with_business boolean not null default false,
  add column if not exists last_business_outreach_at timestamptz;

create or replace function public.get_business_returning_occasion_customers(partner_id_param uuid)
returns table(
  occasion_id uuid,
  occasion_type text,
  title text,
  requester_display_name text,
  next_occasion_date date,
  last_offer_price numeric,
  last_offer_price_is_per_person boolean,
  already_outreached_this_year boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  occ record;
  v_offer record;
  v_year int;
  v_month int;
  v_day int;
  v_next_date date;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    return;
  end if;

  for occ in
    select o.id, o.occasion_type, o.title, o.occasion_date, o.user_id,
           o.resulting_plan_id, o.last_business_outreach_at
    from occasions o
    where o.recall_shareable_with_business
      and o.recurs_annually
      and o.resulting_plan_id is not null
  loop
    -- Real fulfillment history, and specifically with THIS business --
    -- see this migration's own header comment. A row with no matching
    -- accepted/completed offer for partner_id_param (a different
    -- business, or a gathering-destined plan with no business at all) is
    -- silently skipped, never guessed at.
    select bro.* into v_offer
    from plans pl
    join business_request_offers bro on bro.request_id = pl.resulting_business_request_id
    where pl.id = occ.resulting_plan_id
      and bro.partner_id = partner_id_param
      and bro.status in ('accepted', 'completed')
    order by coalesce(bro.accepted_at, bro.completed_at) desc nulls last
    limit 1;

    if v_offer.id is null then
      continue;
    end if;

    -- Same recurrence roll-forward as send_occasion_planning_nudges() --
    -- see that function's own inline comment for why a Feb 29 anchor
    -- falls back to Feb 28 rather than erroring.
    v_year := extract(year from current_date)::int;
    v_month := extract(month from occ.occasion_date)::int;
    v_day := extract(day from occ.occasion_date)::int;
    begin
      v_next_date := make_date(v_year, v_month, v_day);
    exception when others then
      v_next_date := make_date(v_year, 2, 28);
    end;
    if v_next_date < current_date then
      begin
        v_next_date := make_date(v_year + 1, v_month, v_day);
      exception when others then
        v_next_date := make_date(v_year + 1, 2, 28);
      end;
    end if;

    -- A real, disclosed judgment call, not a measured fact: only surface a
    -- returning customer once their next real occurrence is within 60
    -- days -- close enough for a timely "welcome back," not a whole
    -- year's worth of dashboard clutter.
    if (v_next_date - current_date) > 60 then
      continue;
    end if;

    occasion_id := occ.id;
    occasion_type := occ.occasion_type;
    title := occ.title;
    select display_name into requester_display_name from profiles where id = occ.user_id;
    next_occasion_date := v_next_date;
    last_offer_price := v_offer.offer_price;
    last_offer_price_is_per_person := v_offer.price_is_per_person;
    already_outreached_this_year := occ.last_business_outreach_at is not null
      and occ.last_business_outreach_at > (now() - interval '350 days');

    return next;
  end loop;
end;
$function$;

revoke all on function public.get_business_returning_occasion_customers(uuid) from public, anon;
grant execute on function public.get_business_returning_occasion_customers(uuid) to authenticated;

create or replace function public.send_business_recall_outreach(
  occasion_id_param uuid,
  partner_id_param uuid,
  package_id_param uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_occasion record;
  v_offer record;
  v_partner record;
  v_package record;
  service_key text;
  v_body text;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  select * into v_occasion from occasions where id = occasion_id_param;
  if v_occasion.id is null then
    raise exception 'Occasion not found';
  end if;
  if not v_occasion.recall_shareable_with_business then
    raise exception 'This customer has not made this occasion shareable';
  end if;
  if not v_occasion.recurs_annually or v_occasion.resulting_plan_id is null then
    raise exception 'No real returning-customer history for this occasion';
  end if;

  -- Same real ownership check as get_business_returning_occasion_customers
  -- -- a business can only reach out about its OWN real fulfillment
  -- history with this customer, never borrow another business's.
  select bro.* into v_offer
  from plans pl
  join business_request_offers bro on bro.request_id = pl.resulting_business_request_id
  where pl.id = v_occasion.resulting_plan_id
    and bro.partner_id = partner_id_param
    and bro.status in ('accepted', 'completed')
  order by coalesce(bro.accepted_at, bro.completed_at) desc nulls last
  limit 1;

  if v_offer.id is null then
    raise exception 'No real fulfillment history with this business for this occasion';
  end if;

  -- Rate limit: once per real occurrence, mirroring send_occasion_
  -- planning_nudges()' own once-per-year dedup shape -- a business can't
  -- spam a returning customer with repeated "welcome back" pushes.
  if v_occasion.last_business_outreach_at is not null
     and v_occasion.last_business_outreach_at > (now() - interval '350 days') then
    raise exception 'Already reached out about this occasion recently';
  end if;

  select * into v_partner from brand_partners where id = partner_id_param;
  if v_partner.id is null then
    raise exception 'Business not found';
  end if;

  if package_id_param is not null then
    select * into v_package from business_occasion_packages
    where id = package_id_param and partner_id = partner_id_param;
    if v_package.id is null then
      raise exception 'Package not found';
    end if;
  end if;

  update occasions set last_business_outreach_at = now() where id = occasion_id_param;

  v_body := case
    when v_package.id is not null then 'Welcome back -- ask about our ' || v_package.name || '.'
    else 'Welcome back -- we would love to help you celebrate again.'
  end;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', v_occasion.user_id,
      'title', _occasion_emoji(v_occasion.occasion_type) || ' ' || v_partner.name || ' says hello!',
      'body', v_body,
      'data', jsonb_build_object(
        'type', 'business_recall_outreach',
        'occasion_id', v_occasion.id,
        'partner_id', partner_id_param,
        'partner_name', v_partner.name,
        'package_id', package_id_param,
        'package_name', v_package.name
      )
    )
  );
end;
$function$;

revoke all on function public.send_business_recall_outreach(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.send_business_recall_outreach(uuid, uuid, uuid) to authenticated;

-- get_occasion_recall() (Item 101, unchanged signature) now also returns
-- the consumer's own real consent state for the business it already
-- resolved -- so the client can render a real toggle right on the recall
-- card without a second round trip.
create or replace function public.get_occasion_recall(occasion_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_occasion record;
  v_plan record;
  v_offer record;
  v_outcome record;
  v_partner record;
  v_gathering record;
begin
  select * into v_occasion from occasions where id = occasion_id_param;
  if v_occasion.id is null or v_occasion.user_id <> auth.uid() then
    return null;
  end if;
  if v_occasion.resulting_plan_id is null then
    return null;
  end if;

  select * into v_plan from plans where id = v_occasion.resulting_plan_id;
  if v_plan.id is null then
    return null;
  end if;

  if v_plan.resulting_business_request_id is not null then
    select bro.* into v_offer
    from business_request_offers bro
    where bro.request_id = v_plan.resulting_business_request_id
      and bro.status in ('accepted', 'completed')
    order by coalesce(bro.accepted_at, bro.completed_at) desc nulls last
    limit 1;

    if v_offer.id is not null then
      select * into v_partner from brand_partners where id = v_offer.partner_id;
      select * into v_outcome from business_offer_outcomes where offer_id = v_offer.id;

      if v_partner.id is not null then
        return jsonb_build_object(
          'planType', 'business',
          'partnerId', v_offer.partner_id,
          'partnerName', v_partner.name,
          'category', v_partner.category,
          'offer_price', v_offer.offer_price,
          'price_is_per_person', v_offer.price_is_per_person,
          'offer_type', v_offer.offer_type,
          'proposedTime', v_offer.proposed_time,
          'satisfactionRating', v_outcome.satisfaction_rating,
          'wouldRepeat', v_outcome.would_repeat,
          -- Item 102: the real, owner-controlled consent this recall
          -- card's own share toggle reads and writes.
          'recall_shareable_with_business', v_occasion.recall_shareable_with_business
        );
      end if;
    end if;
  end if;

  if v_plan.resulting_gathering_id is not null then
    select * into v_gathering from gatherings where id = v_plan.resulting_gathering_id;
    if v_gathering.id is not null then
      return jsonb_build_object(
        'planType', 'gathering',
        'gatheringId', v_gathering.id,
        'gatheringTitle', v_gathering.title,
        'category', v_gathering.interest_tag
      );
    end if;
  end if;

  return null;
end;
$function$;

revoke all on function public.get_occasion_recall(uuid) from public, anon;
grant execute on function public.get_occasion_recall(uuid) to authenticated;
