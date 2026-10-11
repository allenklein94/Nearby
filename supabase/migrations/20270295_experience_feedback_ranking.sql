-- Owner item 35 (2026-10-11): "How was it?" feedback improves recommendations, both ways. Explicit feedback > guessing.
-- Replaces get_my_positive_experience_signals (positive only) with get_my_experience_feedback: the caller's LATEST word on each
-- host, business and kind of experience, from the two tables that already hold it (gathering_feedback, business_offer_outcomes).
-- No new feedback mechanism, no new table, nothing stored.
--
--   loved       = Loved it / Good, unless the person also said they would NOT go again (gathering would_attend_again = false;
--                 offer would_repeat = 'no' or match_fit = 'no'). Item 34's inline "How was it?" saves only the rating, so
--                 would_attend_again is null there: the old function required it to be TRUE, so since item 34 no gathering
--                 rating counted at all. Null now reads as "not said" (the rating alone speaks).
--   not_for_me  = Not for me.
--   anything else (Okay, or loved-but-would-not-repeat) is a neutral word: it counts as the latest word, so it clears an older
--   loved / not_for_me on the same key. A skipped prompt (no rating) is not a word and is ignored.
-- Keys: the host (never the caller themself), the business (an offer's partner, or a gathering's hosting_partner_id) and the
-- kind (gathering interest_tag / request category). Never-learned categories (_category_never_learned) are never returned:
-- a rating on one is kept as feedback but never shapes ranking. Owner-only (auth.uid()), no caller-supplied id.

drop function if exists public.get_my_positive_experience_signals();

create function public.get_my_experience_feedback()
 returns table(
   loved_host_ids uuid[], loved_partner_ids uuid[], loved_categories text[],
   not_for_me_host_ids uuid[], not_for_me_partner_ids uuid[], not_for_me_categories text[]
 )
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with words as (
    select g.host_id as host_id, g.hosting_partner_id as partner_id, g.interest_tag as category, gf.created_at as at,
      case
        when gf.satisfaction_rating = 'not_for_me' then 'not_for_me'
        when gf.satisfaction_rating in ('loved_it', 'good') and gf.would_attend_again is distinct from false then 'loved'
        else 'neutral'
      end as word
    from gathering_feedback gf
    join gatherings g on g.id = gf.gathering_id
    where gf.reviewer_id = auth.uid() and gf.satisfaction_rating is not null
    union all
    select null::uuid, bro.partner_id, br.category, boo.created_at,
      case
        when boo.satisfaction_rating = 'not_for_me' then 'not_for_me'
        when boo.satisfaction_rating in ('loved_it', 'good') and boo.would_repeat in ('yes', 'maybe')
             and boo.match_fit is distinct from 'no' then 'loved'
        else 'neutral'
      end
    from business_offer_outcomes boo
    join business_request_offers bro on bro.id = boo.offer_id
    join business_requests br on br.id = bro.request_id
    where boo.reviewer_id = auth.uid()
  ),
  keyed as (
    select 'host' as k, host_id::text as v, at, word from words where host_id is not null and host_id <> auth.uid()
    union all
    select 'partner', partner_id::text, at, word from words where partner_id is not null
    union all
    select 'category', category, at, word from words where category is not null and not public._category_never_learned(category)
  ),
  latest as (
    select distinct on (k, v) k, v, word from keyed order by k, v, at desc, word
  )
  select
    coalesce((select array_agg(v::uuid order by v) from latest where k = 'host' and word = 'loved'), array[]::uuid[]),
    coalesce((select array_agg(v::uuid order by v) from latest where k = 'partner' and word = 'loved'), array[]::uuid[]),
    coalesce((select array_agg(v order by v) from latest where k = 'category' and word = 'loved'), array[]::text[]),
    coalesce((select array_agg(v::uuid order by v) from latest where k = 'host' and word = 'not_for_me'), array[]::uuid[]),
    coalesce((select array_agg(v::uuid order by v) from latest where k = 'partner' and word = 'not_for_me'), array[]::uuid[]),
    coalesce((select array_agg(v order by v) from latest where k = 'category' and word = 'not_for_me'), array[]::text[]);
$function$;

revoke all on function public.get_my_experience_feedback() from public, anon;
grant execute on function public.get_my_experience_feedback() to authenticated;
