-- Item 101 (CLAUDE.md, "Occasions can become recurring"). User's own
-- example: after the first year, an anniversary nudge shouldn't just say
-- "your anniversary is coming up" again -- Nearby should remember what was
-- chosen, where, what was liked, approximate budget, and preferred time,
-- then offer a real "return to last year's restaurant or try something
-- new?" choice.
--
-- The recurrence and "already planned this occurrence" tracking already
-- existed (occasions.recurs_annually/resulting_plan_id/last_planned_at,
-- "Occasion architecture should not be a silo," 2026-09-12) -- what was
-- missing was using that real history for anything beyond a skip check.
-- Two real, separate pieces, both reading data this schema already
-- captures honestly (never fabricating a memory the app doesn't actually
-- have):
--
-- (1) get_occasion_recall(occasion_id): a new, owner-only read that
-- resolves an occasion's own resulting_plan_id -> plans -> (whichever real
-- object the plan actually produced) -> the real accepted/completed
-- business_request_offers row -> its brand_partners row (where you went,
-- what you paid, what time) -> its business_offer_outcomes row if one was
-- ever submitted (what you liked -- satisfaction_rating/would_repeat,
-- already a real, existing consumer feedback mechanism, "The Plan Engine"
-- Phase 4, 2026-08-23/30 -- never a new rating system). Returns null,
-- honestly, whenever any link in that chain isn't real (no resulting plan
-- yet, the plan produced a gathering with no business attached, the
-- business request never reached a real accepted offer) -- a recall card
-- can never be fabricated from a partial chain.
--
-- (2) send_occasion_planning_nudges() (CREATE OR REPLACE, unchanged
-- signature): when a real accepted-offer recall resolves for the occasion
-- about to be nudged, the push body itself names the real business
-- ("...is coming up. Want to return to {partner} or try something new?")
-- instead of the generic "...is coming up. Plan something?" -- honest
-- because the lookup is real, not because every occasion gets it (a
-- first-year occasion, or one that only ever produced a gathering, keeps
-- the exact original generic text).
--
-- A real, live bug was caught and fixed during verification, not
-- hypothetical: get_occasion_recall()'s first draft used plain
-- `record IS NOT NULL`/`IS NULL` checks to test "was a row found" for
-- v_offer/v_partner/v_plan/v_gathering/v_occasion -- but a Postgres
-- `record`'s IS [NOT] NULL uses SQL row-comparison semantics (true only
-- when EVERY field is null, or EVERY field is non-null), not "was a row
-- found" semantics. A real, fully-resolved accepted offer with an
-- ordinary null nullable column (expires_at, offer_type -- the common
-- case) silently made `v_offer IS NOT NULL` evaluate false, so the whole
-- function always returned null even for a genuinely complete recall
-- chain -- confirmed live via a disposable rolled-back transaction with
-- real fixtures before this was ever treated as working. Fixed by testing
-- each record's own always-populated `id` column instead (see the
-- function's own inline comment at the fix site).

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
  -- A `record IS NULL`/`IS NOT NULL` check uses SQL row-comparison
  -- semantics, not "was a row found" semantics: `IS NOT NULL` on a row is
  -- only true when EVERY field is non-null, and `IS NULL` is only true
  -- when EVERY field is null -- a real, found row with any ordinary
  -- nullable column left null (occasions.who_for_friend_id,
  -- business_request_offers.expires_at, etc. -- the common case, not the
  -- exception) silently fails both checks. Caught live during
  -- verification: `v_offer IS NOT NULL` evaluated false for a real,
  -- fully-resolved accepted offer purely because its own nullable
  -- expires_at/offer_type happened to be null. Every presence check below
  -- instead tests the row's own real, always-populated `id` column, which
  -- has none of this ambiguity -- null only when SELECT INTO truly found
  -- no row at all (confirmed live: accessing `.id` on a genuinely-empty
  -- record is safe, never a runtime error).
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

  -- Business-destined plan: the real accepted/completed offer is the
  -- authoritative "what actually happened" record -- a merely-pending or
  -- declined offer never counts as a genuine memory to recall.
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
          'wouldRepeat', v_outcome.would_repeat
        );
      end if;
    end if;
  end if;

  -- Gathering-destined plan: a real, honest fallback -- there's no single
  -- "business to return to," so the recall is just what it actually was.
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

create or replace function public.send_occasion_planning_nudges()
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  service_key text;
  occasion_row record;
  v_next_date date;
  v_year int;
  v_month int;
  v_day int;
  v_lead_days int;
  v_body_suffix text;
  v_push_body text;
  v_trigger_today boolean;
  v_date_text text;
  v_recall_partner_name text;
  v_has_recall boolean;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for occasion_row in
    select id, user_id, occasion_type, title, occasion_date, date_precision, recurs_annually,
           who_for_name, who_for_friend_id, resulting_plan_id, last_planned_at, reminder_enabled
    from occasions
    where reminder_enabled
  loop
    if occasion_row.recurs_annually then
      v_year := extract(year from current_date)::int;
      v_month := extract(month from occasion_row.occasion_date)::int;
      v_day := extract(day from occasion_row.occasion_date)::int;
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
    else
      v_next_date := occasion_row.occasion_date;
    end if;

    v_lead_days := case occasion_row.occasion_type
      when 'anniversary' then 14
      when 'graduation' then 14
      when 'baby_shower' then 14
      when 'engagement' then 14
      when 'housewarming' then 14
      else 7
    end;

    if occasion_row.date_precision = 'flexible' then
      v_trigger_today := current_date = (date_trunc('month', v_next_date)::date - 5);
    else
      v_trigger_today := (v_next_date - current_date) = v_lead_days;
    end if;

    if not v_trigger_today then
      continue;
    end if;

    -- Already turned into a real plan for this upcoming date -- don't nag
    -- about something the user already handled. See this migration's own
    -- header comment for why ~350 days is an honest approximation, not an
    -- exact per-year-instance check this table has no way to make.
    if occasion_row.resulting_plan_id is not null
       and occasion_row.last_planned_at is not null
       and occasion_row.last_planned_at > (v_next_date - interval '350 days') then
      continue;
    end if;

    if not coalesce((select notify_social from profiles where id = occasion_row.user_id), true) then
      continue;
    end if;

    -- Item 101: a real prior-year memory, resolved the exact same way
    -- get_occasion_recall() resolves it for the client -- when
    -- resulting_plan_id exists at all (this occasion has genuine history,
    -- not a first-time ask), look up the real business it was last
    -- fulfilled through. Deliberately inline rather than calling
    -- get_occasion_recall() itself: that function is STABLE and reads
    -- auth.uid(), which has no meaning inside this SECURITY DEFINER cron
    -- loop iterating over every user's own occasions.
    v_recall_partner_name := null;
    if occasion_row.resulting_plan_id is not null then
      select bp.name into v_recall_partner_name
      from plans pl
      join business_request_offers bro on bro.request_id = pl.resulting_business_request_id
      join brand_partners bp on bp.id = bro.partner_id
      where pl.id = occasion_row.resulting_plan_id
        and bro.status in ('accepted', 'completed')
      order by coalesce(bro.accepted_at, bro.completed_at) desc nulls last
      limit 1;
    end if;
    v_has_recall := v_recall_partner_name is not null;

    v_body_suffix := case occasion_row.occasion_type when 'anniversary' then 'together?' else '?' end;
    v_date_text := to_char(v_next_date, 'FMMonth FMDD');

    if v_has_recall and occasion_row.date_precision = 'exact' then
      v_push_body := occasion_row.title || ' is in ' || v_lead_days
        || ' days. Want to return to ' || v_recall_partner_name || ' or try something new?';
    else
      v_push_body := case occasion_row.date_precision
        when 'weekend' then occasion_row.title || ' is coming up the weekend of ' || v_date_text || '. Plan something' || v_body_suffix
        when 'around' then occasion_row.title || ' is coming up around ' || v_date_text || '. Plan something' || v_body_suffix
        when 'flexible' then occasion_row.title || ' is coming up sometime ' || to_char(v_next_date, 'FMMonth') || '. Plan ahead' || v_body_suffix
        else occasion_row.title || ' is in ' || v_lead_days || ' days. Plan something' || v_body_suffix
      end;
    end if;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', occasion_row.user_id,
        'title', _occasion_emoji(occasion_row.occasion_type) || ' ' || (case when v_has_recall then 'Plan Again?' else 'Upcoming ' || _occasion_noun(occasion_row.occasion_type) end),
        'body', v_push_body,
        'data', jsonb_build_object(
          'type', 'occasion_upcoming',
          'occasion_id', occasion_row.id,
          'occasion_type', occasion_row.occasion_type,
          'occasion_title', occasion_row.title,
          'who_for_name', occasion_row.who_for_name,
          'who_for_friend_id', occasion_row.who_for_friend_id,
          'has_recall', v_has_recall
        )
      )
    );
  end loop;
end;
$function$;

revoke all on function public.send_occasion_planning_nudges() from public, anon, authenticated;
