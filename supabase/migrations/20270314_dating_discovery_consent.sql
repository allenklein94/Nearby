-- Item 121 follow-up (owner, 2026-10-16, approved): Dating discovery consent, cards AND counts. A person appears in Dating
-- discovery (Crossed Paths deck, Browse deck, Home's "You crossed paths with X" row, Activity's crossed-paths rows, and every
-- Dating count) ONLY if they explicitly chose Dating: their own "What are you looking for?" answer, Dating or Both, stored as
-- the 'Go on dates' token in profiles.onboarding_motivations (changeable in Settings). Attending the same gathering, shared
-- interests, proximity or past interactions are never consent.
--   * public.is_dating_discoverable(text[]): the ONE server rule (the client mirrors only its result, never the token).
--   * public.dating_candidates_visible_to_me: the authoritative read for every Dating card source. It is
--     people_visible_to_me (blocks either way, server-side) narrowed to opted-in people other than the caller, and only the
--     columns the Dating decks read (no tokens, no settings, no motivations). The client never filters consent on its own.
-- No new location data, no change to sightings or get_shared_gathering_partners (Friends discovery reads them unchanged).
-- Known residual (unchanged, listed in CLAUDE.md): profiles itself stays readable by any signed-in client by id.

create or replace function public.is_dating_discoverable(motivations text[])
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  select coalesce('Go on dates' = any(motivations), false);
$function$;

revoke all on function public.is_dating_discoverable(text[]) from public, anon;
grant execute on function public.is_dating_discoverable(text[]) to authenticated, service_role;

create or replace view public.dating_candidates_visible_to_me
  with (security_invoker = true)
as
  select v.id, v.display_name, v.photo_url, v.bio, v.discovery_gender, v.birthdate, v.ethnicity, v.interests, v.basics,
         v.height_inches, v.photo_verified, v.relationship_intention, v.gender_identity, v.interested_in_genders, v.show_me,
         v.wide_area,
         public.is_dating_discoverable(v.onboarding_motivations) as dating_opted_in
    from public.people_visible_to_me v
   where v.id <> auth.uid()
     and public.is_dating_discoverable(v.onboarding_motivations);

revoke all on public.dating_candidates_visible_to_me from public, anon, authenticated;
grant select on public.dating_candidates_visible_to_me to authenticated;

comment on view public.dating_candidates_visible_to_me is
  'Item 121 follow-up: the only read for Dating discovery cards and counts. Opted-in (Dating or Both) people other than the caller, blocks hidden both ways.';
