-- Owner idea "153" (2026-10-17, LOCKED): "Not interested" on a recommended gathering card.
-- The person's own explicit word, private to them:
--   * that gathering is hidden from THEIR recommendations (Home Picked For You / Nearby Right Now, Discover browse);
--   * its category ranks lower, as one more word in get_my_experience_feedback's "latest word per kind" (a later "How was it?"
--     on that kind replaces it, and it replaces an older one). Never the host or the business: only the kind is keyed.
-- Stored in gathering_dismissals: no client grants, RLS on with no policy; only the SECURITY DEFINER functions below touch it,
-- each scoped to auth.uid(). No host, business, other person, count, push, analytics event or AI service ever reads it.
--
-- Changed gathering (the dismissal must never transfer to something the person did not see):
--   * edited time / place / title: still hidden (same gathering, same kind);
--   * edited kind (interest_tag): no longer hidden (it is not what they dismissed); the down-rank stays on the ORIGINAL kind;
--   * cancelled (= deleted): the row keeps the kind word (gathering_id set null), nothing left to hide;
--   * recreated (a new id): not hidden; only the kind down-rank applies.
-- Retention: 90 days, like the activity Nearby notices (older rows are ignored by every read and purged on the next dismissal).
-- Never-learned categories (_category_never_learned) and untagged gatherings: the gathering is hidden, no kind is down-ranked.

create table public.gathering_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gathering_id uuid references public.gatherings(id) on delete set null,
  interest_tag text,
  created_at timestamptz not null default now(),
  unique (user_id, gathering_id)
);
create index gathering_dismissals_user_idx on public.gathering_dismissals (user_id, created_at desc);
alter table public.gathering_dismissals enable row level security;
revoke all on table public.gathering_dismissals from public, anon, authenticated;

-- The one writer. Only a gathering the caller may see, that is not theirs and not already in their plans (joined, requested,
-- waitlisted or Interested): the card that offers it is a recommendation. Returns whether a kind is now down-ranked, so the
-- card says "We'll show you less like this." only when that is true.
create function public.dismiss_recommended_gathering(gathering_id_param uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  g record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select id, host_id, visibility, women_only, community_id, hosting_partner_id, interest_tag into g
    from gatherings where id = gathering_id_param;
  if g.id is null or not public._gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id) then
    raise exception 'Gathering not found';
  end if;
  if g.host_id = v_uid then raise exception 'This is your own gathering'; end if;
  if exists (select 1 from gathering_interest where gathering_id = g.id and user_id = v_uid)
     or exists (select 1 from gathering_interested where gathering_id = g.id and user_id = v_uid) then
    raise exception 'Already in your plans';
  end if;
  delete from gathering_dismissals where user_id = v_uid and created_at < now() - interval '90 days';
  insert into gathering_dismissals (user_id, gathering_id, interest_tag) values (v_uid, g.id, g.interest_tag)
    on conflict (user_id, gathering_id) do update set interest_tag = excluded.interest_tag, created_at = now();
  return jsonb_build_object('kind_down_ranked', g.interest_tag is not null and not public._category_never_learned(g.interest_tag));
end;
$function$;
revoke all on function public.dismiss_recommended_gathering(uuid) from public, anon;
grant execute on function public.dismiss_recommended_gathering(uuid) to authenticated;

-- Undo: removes that one dismissal, so the gathering and its kind rank exactly as before it.
create function public.undo_dismiss_recommended_gathering(gathering_id_param uuid)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  delete from gathering_dismissals where user_id = auth.uid() and gathering_id = gathering_id_param;
$function$;
revoke all on function public.undo_dismiss_recommended_gathering(uuid) from public, anon;
grant execute on function public.undo_dismiss_recommended_gathering(uuid) to authenticated;

-- Settings -> What Nearby has noticed -> Forget: every Not interested on that kind (its gatherings show again too).
create function public.forget_my_not_interested_category(category_param text)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  delete from gathering_dismissals where user_id = auth.uid() and interest_tag = category_param;
$function$;
revoke all on function public.forget_my_not_interested_category(text) from public, anon;
grant execute on function public.forget_my_not_interested_category(text) to authenticated;

-- Clear my activity history also clears every Not interested (everything listed under What Nearby has noticed).
create or replace function public.clear_my_behavior_history()
returns void language sql security definer set search_path to 'public' as $function$
  delete from behavior_events where user_id = auth.uid();
  delete from gathering_dismissals where user_id = auth.uid();
$function$;
revoke all on function public.clear_my_behavior_history() from public, anon;

-- The one feedback read gains two columns (a changed return type needs drop + create):
--   not_interested_categories = kinds whose LATEST word is a Not interested (within 90 days);
--   dismissed_gathering_ids    = gatherings to hide: dismissed within 90 days and still the kind that was dismissed.
drop function public.get_my_experience_feedback();
create function public.get_my_experience_feedback()
 returns table(
   loved_host_ids uuid[], loved_partner_ids uuid[], loved_categories text[],
   not_for_me_host_ids uuid[], not_for_me_partner_ids uuid[], not_for_me_categories text[],
   not_interested_categories text[], dismissed_gathering_ids uuid[]
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
    union all
    -- Not interested: a word on the KIND only (never the host or the business)
    select null::uuid, null::uuid, d.interest_tag, d.created_at, 'not_interested'
    from gathering_dismissals d
    where d.user_id = auth.uid() and d.interest_tag is not null and d.created_at >= now() - interval '90 days'
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
    coalesce((select array_agg(v order by v) from latest where k = 'category' and word = 'not_for_me'), array[]::text[]),
    coalesce((select array_agg(v order by v) from latest where k = 'category' and word = 'not_interested'), array[]::text[]),
    coalesce((select array_agg(d.gathering_id order by d.gathering_id)
              from gathering_dismissals d join gatherings g on g.id = d.gathering_id
              where d.user_id = auth.uid() and d.created_at >= now() - interval '90 days'
                and g.interest_tag is not distinct from d.interest_tag), array[]::uuid[]);
$function$;

revoke all on function public.get_my_experience_feedback() from public, anon;
grant execute on function public.get_my_experience_feedback() to authenticated;
