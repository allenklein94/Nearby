-- Closes the biggest confirmed gap from the Aug 7 2026 vision-doc feedback:
-- "Invite people" doesn't exist as a feature at all — no way to invite a
-- specific person to a gathering or community anywhere. (Not to be confused
-- with InviteFriendsScreen.js/`InviteFriends` route, which is an app-referral
-- code screen — a different feature with a similar name, see CLAUDE.md.)
--
-- One polymorphic table rather than two (gathering_invites/community_invites)
-- since both shapes are identical (who invited whom, to what, still pending?)
-- and a single Inbox "Invites" list needs to read both without a union query.
create table if not exists social_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references profiles(id) on delete cascade,
  invitee_id uuid not null references profiles(id) on delete cascade,
  invite_type text not null check (invite_type in ('gathering', 'community')),
  target_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

-- Only one pending invite per (inviter, invitee, target) — resending after a
-- decline is allowed (partial index only covers 'pending' rows), re-sending
-- while already pending is just a harmless no-op the RPC below swallows.
create unique index if not exists social_invites_pending_unique
  on social_invites (inviter_id, invitee_id, invite_type, target_id)
  where status = 'pending';

create index if not exists social_invites_invitee_idx on social_invites (invitee_id, status);

alter table social_invites enable row level security;

-- Direct SELECT for both sides of the invite (recipient needs to see it in
-- their Inbox, sender may want their own sent-state) — same "each user sees
-- their own row" shape as friendships' own policy. No direct INSERT/UPDATE
-- policy: both go through SECURITY DEFINER RPCs below, matching this
-- codebase's convention for anything that needs a same-row-race-safe check
-- (e.g. set_community_member_role, check_in_to_gathering) rather than
-- trusting a client-supplied status transition via RLS alone.
create policy "Users can view invites they sent or received"
  on social_invites for select
  using (auth.uid() = inviter_id or auth.uid() = invitee_id);

-- SECURITY DEFINER so it can insert past the no-direct-INSERT policy above,
-- with its own real checks: caller must be the inviter, invitee must be an
-- accepted friend (same "no stalking vector" reasoning already applied
-- elsewhere in this codebase — e.g. Discover's unified search deliberately
-- excluding People search), and the target must actually exist. Re-sending
-- an already-pending invite is a harmless no-op (ON CONFLICT DO NOTHING
-- against the partial unique index above), not an error.
create or replace function public.send_social_invite(invite_type_param text, target_id_param uuid, invitee_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if invite_type_param not in ('gathering', 'community') then
    raise exception 'Invalid invite type';
  end if;

  if invitee_id_param = auth.uid() then
    raise exception 'Cannot invite yourself';
  end if;

  if not exists (
    select 1 from friendships
    where status = 'accepted'
      and ((user_a = auth.uid() and user_b = invitee_id_param)
        or (user_a = invitee_id_param and user_b = auth.uid()))
  ) then
    raise exception 'You can only invite friends';
  end if;

  if invite_type_param = 'gathering' and not exists (select 1 from gatherings where id = target_id_param) then
    raise exception 'Gathering not found';
  end if;

  if invite_type_param = 'community' and not exists (select 1 from communities where id = target_id_param) then
    raise exception 'Community not found';
  end if;

  insert into social_invites (inviter_id, invitee_id, invite_type, target_id)
  values (auth.uid(), invitee_id_param, invite_type_param, target_id_param)
  on conflict (inviter_id, invitee_id, invite_type, target_id) where status = 'pending' do nothing;
end;
$function$;

revoke all on function public.send_social_invite(text, uuid, uuid) from public, anon;
grant execute on function public.send_social_invite(text, uuid, uuid) to authenticated;

-- Only the recipient can respond, and only while still pending (no
-- re-accepting/re-declining a resolved invite). Accepting does not itself
-- join the gathering/community — the client deep-links to the existing
-- GatheringDetail/CommunityDetail join flow after this, same as tapping any
-- other card, so private/host-approval targets are unaffected.
create or replace function public.respond_to_social_invite(invite_id_param uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update social_invites
  set status = case when accept then 'accepted' else 'declined' end,
      responded_at = now()
  where id = invite_id_param and invitee_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'Invite not found or already responded to';
  end if;
end;
$function$;

revoke all on function public.respond_to_social_invite(uuid, boolean) from public, anon;
grant execute on function public.respond_to_social_invite(uuid, boolean) to authenticated;
