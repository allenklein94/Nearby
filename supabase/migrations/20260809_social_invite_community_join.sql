-- Flywheel trace audit (Aug 9 2026), leg "invitee responds -> resulting
-- conversation surfaces": found that accepting a *community* social_invites
-- row does nothing but flip its own status to 'accepted' -- it never grants
-- the invitee an actual path into community_members. For a PUBLIC community
-- that's harmless (anyone can already self-join), but a private community
-- is exactly the case this feature exists for, and community_members' own
-- INSERT policy only ever allowed `c.is_public = true OR c.creator_id =
-- auth.uid()` -- an invited-but-not-a-member friend accepting the invite and
-- tapping "Join Community" hits a real RLS rejection (CommunityDetailScreen
-- surfaces the raw Postgres error via Alert.alert). The invite could be sent
-- and accepted, but never actually redeemed -- no membership, no community
-- chat, nothing for "resulting conversation surfaces" to mean.
--
-- Fix: extend community_members' INSERT policy with a third path -- a real,
-- accepted social_invites row for this exact (community, invitee) pair --
-- alongside the two that already existed. Matches this schema's existing
-- privacy-enforcement convention for communities (real RLS, not just a
-- client-side gate, unlike gatherings' "RLS wide open" posture) and the same
-- shape of fix already applied to gatherings' join_gathering() invite_only
-- check earlier this same day, just expressed as an RLS clause instead of a
-- SECURITY DEFINER RPC branch, since community membership has no RPC of its
-- own (join is a plain client insert) to add the check to instead.

drop policy if exists "Users can join public communities, or their own community regar" on public.community_members;

create policy "Users can join public communities, invited communities, or thei"
  on public.community_members
  as permissive
  for insert
  to authenticated
  with check (
    (user_id = auth.uid())
    and (
      exists (
        select 1 from communities c
        where c.id = community_members.community_id
          and (c.is_public = true or c.creator_id = auth.uid())
      )
      or exists (
        select 1 from social_invites si
        where si.invite_type = 'community'
          and si.target_id = community_members.community_id
          and si.invitee_id = auth.uid()
          and si.status = 'accepted'
      )
    )
    and (
      (role = 'creator' and exists (
        select 1 from communities c
        where c.id = community_members.community_id and c.creator_id = auth.uid()
      ))
      or (role = 'member')
    )
  );
