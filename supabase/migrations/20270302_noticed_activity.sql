-- Owner item 54 (2026-10-12): "Nearby is getting smarter". Home may say "You've been into Hiking and Pickleball lately." ONLY
-- when the person's own recent, explicit activity supports it. This is the ONE rule for which categories qualify:
--   * evidence = the person's own private behavior_events of the kinds that are DOING something: join, create, accept,
--     redeem (never an open/view, never a search); in the last 30 days ("lately"); on 2+ SEPARATE things (gatherings,
--     communities, requests), the same repeated-evidence bar as item 157;
--   * the category is also one Nearby has learned (get_my_behavior_categories: 90 days, item 157's floor, never-learned
--     categories like Faith & Spirituality excluded, Forget / Clear history apply) AND it is certainly listed in Settings >
--     "What Nearby has noticed" (fewer than 5 other learned categories weigh as much or more: that list shows the top 5), so
--     the line's destination always shows it;
--   * a live, canonical consumer category (category_tag_groups: not retired, not business-only); never a group or a made-up
--     combination;
--   * not already a declared interest (interests / monthly_interests): there is nothing to tell the person about those.
-- Nothing from the profile is inferred (no age, gender, job, photos, bio): profile is read only to EXCLUDE declared interests.
-- Returns at most 2 rows (what the line names), strongest first; owner-only (auth.uid() inside), authenticated only.
-- Read by services/behaviorSignals.js getMyNoticedCategories only.

create or replace function public.get_my_noticed_categories()
returns table (category text, did_count integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with learned as (
    select l.category, l.weight from public.get_my_behavior_categories(90) l
  ),
  surely_listed as (
    select a.category, a.weight from learned a
    where (select count(*) from learned b where b.category <> a.category and b.weight >= a.weight) < 5
  ),
  did as (
    select be.category, count(distinct be.entity_id)::integer as did_count
    from behavior_events be
    where be.user_id = auth.uid()
      and be.event_type in ('join', 'create', 'accept', 'redeem')
      and be.entity_id is not null
      and coalesce(be.redeemed_at, be.created_at) >= now() - interval '30 days'
    group by be.category
  )
  select s.category, d.did_count
  from surely_listed s
  join did d on d.category = s.category
  where auth.uid() is not null
    and d.did_count >= public.behavior_min_evidence()
    and not public._category_never_learned(s.category)
    and exists (select 1 from category_tag_groups t
                where t.tag = s.category and t.retired_at is null and not coalesce(t.business_only, false))
    and not exists (select 1 from profiles p
                    where p.id = auth.uid()
                      and s.category = any(coalesce(p.interests, '{}'::text[]) || coalesce(p.monthly_interests, '{}'::text[])))
  order by d.did_count desc, s.weight desc, s.category
  limit 2;
$function$;

revoke all on function public.get_my_noticed_categories() from public, anon;
grant execute on function public.get_my_noticed_categories() to authenticated;
