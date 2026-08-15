-- Fixes for the two confirmed defects found in the independent V2
-- acceptance audit (see PRODUCT_AUDIT/V2_ACCEPTANCE_REPORT_2026-08-15.md,
-- Defect A and Defect B) against the "Nearby 2.0 partial build"
-- (20260815_group_intent_and_aggregated_demand.sql,
-- 20260815_group_intent_and_demand_notifications.sql,
-- 20260815_cross_user_intent_patterns.sql).

-- ============================================================
-- Defect A: get_my_group_intent_signals() (and its own push-trigger
-- counterpart) never checked profiles.intent_visibility, unlike the
-- sibling function it's explicitly modeled on
-- (get_connected_open_business_requests, Tier 2 of the resolver) --
-- reproduced live: a requester who set intent_visibility='nobody' still
-- had their real name surfaced to their connected network via this RPC.
-- Fix: apply the identical real predicate the sibling function already
-- uses, both in the read RPC and in the trigger's own crossing check (and
-- bail out of the trigger entirely up front if the NEW row's own
-- requester has opted out -- an opted-out row should never count toward
-- anyone else's threshold either).
-- ============================================================

create or replace function public.get_my_group_intent_signals()
returns table (
  category text,
  request_count bigint,
  requester_names text[],
  soonest_date date
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with connected as (
    select case when user_a = auth.uid() then user_b else user_a end as friend_id
    from friendships
    where status = 'accepted' and (user_a = auth.uid() or user_b = auth.uid())
    union
    select case when user_a = auth.uid() then user_b else user_a end as friend_id
    from matches
    where user_a = auth.uid() or user_b = auth.uid()
  ),
  open_reqs as (
    select br.category, br.date, p.display_name, br.requester_id
    from business_requests br
    join connected c on c.friend_id = br.requester_id
    join profiles p on p.id = br.requester_id
    where br.status = 'open'
    and br.expires_at > now()
    and br.category is not null
    and br.requester_id <> auth.uid()
    and p.intent_visibility = 'friends_and_matches'
  )
  select
    category,
    count(distinct requester_id) as request_count,
    (array_agg(display_name order by date nulls last))[1:5] as requester_names,
    min(date) as soonest_date
  from open_reqs
  group by category
  having count(distinct requester_id) >= 2
  order by count(distinct requester_id) desc, min(date) asc nulls last
  limit 5;
$$;

revoke all on function public.get_my_group_intent_signals() from public, anon;
grant execute on function public.get_my_group_intent_signals() to authenticated;

create or replace function public.notify_group_intent_threshold()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_service_key text;
  v_connected_user record;
  v_prior_count integer;
begin
  if new.status <> 'open' or new.category is null then
    return new;
  end if;

  -- An opted-out requester's own new row should never count toward
  -- crossing anyone else's group-intent threshold either -- mirrors the
  -- read RPC's own filter exactly, not a separate rule.
  if not exists (
    select 1 from profiles where id = new.requester_id and intent_visibility = 'friends_and_matches'
  ) then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_connected_user in
    select case when f.user_a = new.requester_id then f.user_b else f.user_a end as user_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = new.requester_id or f.user_b = new.requester_id)
    union
    select case when m.user_a = new.requester_id then m.user_b else m.user_a end as user_id
    from matches m
    where m.user_a = new.requester_id or m.user_b = new.requester_id
  loop
    -- How many of THIS connected user's own connections already have a
    -- real open request in this category, not counting the new row?
    -- Mirrors get_my_group_intent_signals()'s own connected-set + real
    -- open/expiry/category/intent_visibility filters exactly.
    select count(distinct br.requester_id) into v_prior_count
    from business_requests br
    join profiles p2 on p2.id = br.requester_id
    where br.status = 'open'
      and br.expires_at > now()
      and br.category = new.category
      and br.id <> new.id
      and br.requester_id <> v_connected_user.user_id
      and p2.intent_visibility = 'friends_and_matches'
      and (
        exists (
          select 1 from friendships f2
          where f2.status = 'accepted'
          and ((f2.user_a = v_connected_user.user_id and f2.user_b = br.requester_id)
            or (f2.user_a = br.requester_id and f2.user_b = v_connected_user.user_id))
        )
        or exists (
          select 1 from matches m2
          where (m2.user_a = v_connected_user.user_id and m2.user_b = br.requester_id)
            or (m2.user_a = br.requester_id and m2.user_b = v_connected_user.user_id)
        )
      );

    -- Fire exactly once, at the real 1 -> 2 crossing -- never again for
    -- the 3rd/4th/etc. request in the same category, so this can't nag.
    if v_prior_count = 1 then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
        body := jsonb_build_object(
          'recipient_id', v_connected_user.user_id,
          'title', 'A few people you know want this too',
          'body', '2 or more people you''re connected to are looking for ' || new.category || ' right now.',
          'data', jsonb_build_object('type', 'group_intent_signal', 'category', new.category)
        )
      );
    end if;
  end loop;

  return new;
end;
$function$;

revoke all on function public.notify_group_intent_threshold() from public, anon, authenticated;

-- ============================================================
-- Defect B: get_cross_user_intent_patterns() bucketed period from
-- extract(dow/hour from created_at), which Postgres evaluates in the
-- session's timezone (UTC) -- not the submitter's real local wall-clock
-- time, which is what the client's own getTimePeriod() actually uses.
-- Reproduced live: a real 8:15 PM US-Eastern submission (a textbook
-- "evening" ask) bucketed as "morning" in UTC.
--
-- There is no per-user timezone stored anywhere in this schema to
-- correct for after the fact -- the only honest fix is to capture the
-- real local period at the moment of submission, client-side, using the
-- exact same getTimePeriod() the rest of this app already uses (Home's
-- period-aware subtitle, Quick Picks, the per-user pattern detector in
-- intentPatterns.js) rather than recomputing it from a UTC timestamp
-- after the fact.
-- ============================================================

alter table public.intent_submissions
  add column if not exists local_period text;

alter table public.intent_submissions
  drop constraint if exists intent_submissions_local_period_check;

alter table public.intent_submissions
  add constraint intent_submissions_local_period_check
  check (local_period is null or local_period in ('weekend', 'morning', 'afternoon', 'evening'));

-- Rows written before this fix have no real local_period and are
-- correctly excluded below (nullif-style "unknown," not fabricated as
-- some default bucket) rather than backfilled with a guess.
create or replace function public.get_cross_user_intent_patterns()
returns table (
  category text,
  period text,
  submission_count bigint,
  distinct_users bigint,
  pct_with_result numeric,
  pct_reached_fallback numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can view cross-user intent patterns';
  end if;

  return query
  select
    s.category,
    s.local_period as period,
    count(*) as submission_count,
    count(distinct s.user_id) as distinct_users,
    round(100.0 * count(*) filter (where s.had_any_result) / nullif(count(*), 0), 1) as pct_with_result,
    round(100.0 * count(*) filter (where s.reached_business_fallback) / nullif(count(*), 0), 1) as pct_reached_fallback
  from intent_submissions s
  where s.category is not null
  and s.local_period is not null
  group by s.category, s.local_period
  having count(*) >= 10 and count(distinct s.user_id) >= 3
  order by count(*) desc
  limit 20;
end;
$$;

revoke all on function public.get_cross_user_intent_patterns() from public, anon;
grant execute on function public.get_cross_user_intent_patterns() to authenticated;
