-- Rollback for migration 20270384 (crossed paths safeguards). Restores 20270383's pair rule, write guard and purge and
-- 20270382's viewer_may_read_profile exactly; drops the consent, consent log, probe record and encounter memory (their rows are lost: nobody
-- could have opted in before 0384, and after it a rollback means re-asking). Sightings removed by 0384 are not restored.
drop trigger if exists zz_presence_probe_record on public.presence_reports;
drop trigger if exists zz_sighting_new_encounter_push on public.sightings;
drop trigger if exists zz_sighting_encounter_memory on public.sightings;
drop function if exists private.sighting_encounter_memory();
drop function if exists private.presence_probe_record();

create or replace function private.crossed_paths_pair_allowed(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a is not null and b is not null and a <> b
    and public.person_discoverable(a) and public.person_discoverable(b)
    and not exists (select 1 from blocks k where (k.blocker_id = a and k.blocked_id = b)
                                             or (k.blocker_id = b and k.blocked_id = a))
    and exists (
      select 1 from profiles pa, profiles pb
       where pa.id = a and pb.id = b
         and coalesce(pa.photo_verified, false) and not coalesce(pa.profile_hidden, false)
         and coalesce(pb.photo_verified, false) and not coalesce(pb.profile_hidden, false)
         and ((public.is_dating_discoverable(pa.onboarding_motivations) and public.is_dating_discoverable(pb.onboarding_motivations))
              or (coalesce(pa.open_to_friend_discovery, false) and coalesce(pb.open_to_friend_discovery, false))));
$function$;
revoke all on function private.crossed_paths_pair_allowed(uuid, uuid) from public, anon, authenticated;

create or replace function private.sighting_consent_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not private.crossed_paths_pair_allowed(new.user_a, new.user_b) then
    return null;
  end if;
  return new;
end;
$function$;
revoke all on function private.sighting_consent_guard() from public, anon, authenticated;

create or replace function public.purge_expired_sightings()
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  delete from sightings where expires_at <= now() or not private.crossed_paths_pair_allowed(user_a, user_b);
$function$;
revoke execute on function public.purge_expired_sightings() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.viewer_may_read_profile(target uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v uuid := auth.uid();
  v_partner uuid;
begin
  if v is null or target is null then return false; end if;
  if target = v then return true; end if;
  if check_is_admin(v) then return true; end if;
  -- your own block list shows the person you blocked; otherwise a block hides both ways
  if exists (select 1 from blocks b where b.blocker_id = v and b.blocked_id = target) then return true; end if;
  if viewer_blocked_either_way(target) then return false; end if;

  -- shown to you by a capped discovery function recently
  if exists (select 1 from private.profile_served s
              where s.viewer_id = v and s.target_id = target
                and s.last_served_at > now() - make_interval(days => (select l.grant_days from private.profile_read_limits l where l.id))) then
    return true;
  end if;
  -- people you are connected with, or who reached out to you / you to them
  if exists (select 1 from friendships f where (f.user_a = v and f.user_b = target) or (f.user_a = target and f.user_b = v))
     or exists (select 1 from matches m where (m.user_a = v and m.user_b = target) or (m.user_a = target and m.user_b = v))
     or exists (select 1 from notices n where (n.from_user = v and n.to_user = target) or (n.from_user = target and n.to_user = v))
     or exists (select 1 from social_invites i where (i.inviter_id = v and i.invitee_id = target) or (i.inviter_id = target and i.invitee_id = v))
     or exists (select 1 from sightings s where (s.user_a = v and s.user_b = target) or (s.user_a = target and s.user_b = v))
     or exists (select 1 from referral_redemptions r where (r.referrer_id = v and r.referred_id = target) or (r.referrer_id = target and r.referred_id = v))
     or exists (select 1 from preference_polls pp where (pp.asker_id = v and pp.target_id = target) or (pp.asker_id = target and pp.target_id = v))
     or exists (select 1 from photo_comments pc where (pc.photo_owner_id = v and pc.commenter_id = target) or (pc.photo_owner_id = target and pc.commenter_id = v)) then
    return true;
  end if;
  -- gatherings: fellow approved attendees; the host and anyone in their gathering (any request state); the host of a
  -- current gathering you can see; someone who asked a question on a current gathering you can see
  if exists (select 1 from gathering_interest a join gathering_interest b on b.gathering_id = a.gathering_id
              where a.user_id = v and b.user_id = target and a.status = 'approved' and b.status = 'approved')
     or exists (select 1 from gatherings g join gathering_interest gi on gi.gathering_id = g.id
                 where (g.host_id = v and gi.user_id = target) or (g.host_id = target and gi.user_id = v))
     or exists (select 1 from gatherings g
                 where g.host_id = target and g.scheduled_at > now() - interval '1 day'
                   and _gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id))
     or exists (select 1 from gathering_questions q join gatherings g on g.id = q.gathering_id
                 where q.asker_id = target and g.scheduled_at > now() - interval '1 day'
                   and _gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id)) then
    return true;
  end if;
  -- communities, group plans, plans you share
  if exists (select 1 from community_members a join community_members b on b.community_id = a.community_id
              where a.user_id = v and b.user_id = target)
     or exists (select 1 from group_plan_participants a join group_plan_participants b on b.proposal_id = a.proposal_id
                 where a.user_id = v and b.user_id = target)
     or exists (select 1 from group_plan_proposals gp join group_plan_participants pa on pa.proposal_id = gp.id
                 where (gp.initiator_id = v and pa.user_id = target) or (gp.initiator_id = target and pa.user_id = v))
     or exists (select 1 from occasion_group_plan_participants a join occasion_group_plan_participants b on b.group_plan_id = a.group_plan_id
                 where a.user_id = v and b.user_id = target)
     or exists (select 1 from occasion_group_plans op join occasion_group_plan_participants pa on pa.group_plan_id = op.id
                 where (op.host_id = v and pa.user_id = target) or (op.host_id = target and pa.user_id = v))
     or exists (select 1 from plans pl
                 where (pl.created_by = v and (exists (select 1 from plan_organizers o where o.plan_id = pl.id and o.user_id = target)
                                               or exists (select 1 from plan_shares sh where sh.plan_id = pl.id and sh.user_id = target)))
                    or (pl.created_by = target and (exists (select 1 from plan_organizers o where o.plan_id = pl.id and o.user_id = v)
                                                    or exists (select 1 from plan_shares sh where sh.plan_id = pl.id and sh.user_id = v))))
     or exists (select 1 from plan_organizers a join plan_organizers b on b.plan_id = a.plan_id where a.user_id = v and b.user_id = target) then
    return true;
  end if;
  -- stories: a current public story of theirs; someone who viewed your story
  if exists (select 1 from stories st where st.user_id = target and st.is_public and st.expires_at > now())
     or exists (select 1 from story_views sv join stories st on st.id = sv.story_id where st.user_id = v and sv.viewer_id = target) then
    return true;
  end if;
  -- business: the business you manage talking with this person or asked by them; the owner of a business talking with you
  v_partner := my_managed_partner_id();
  if v_partner is not null and (
       exists (select 1 from business_partnership_requests r where r.partner_id = v_partner and r.requester_id = target)
       or exists (select 1 from business_messages bm where bm.partner_id = v_partner and bm.conversation_with_id = target)) then
    return true;
  end if;
  if exists (select 1 from business_messages bm where bm.conversation_with_id = v and bm.sender_id = target and bm.from_business) then
    return true;
  end if;
  return false;
end;
$function$;
revoke all on function public.viewer_may_read_profile(uuid) from public, anon;
grant execute on function public.viewer_may_read_profile(uuid) to authenticated, service_role;

drop function if exists public.set_crossed_paths_sharing(boolean);
drop function if exists public.get_my_crossed_paths_sharing();
drop function if exists private.cells_within_one_tile(text, text);
drop function if exists private.crossed_paths_probe_limits();
drop table if exists private.crossed_paths_encounters;
drop table if exists private.crossed_paths_probe;
drop table if exists private.crossed_paths_consent_log;
drop table if exists private.crossed_paths_consent;
