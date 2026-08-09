-- send_social_invite (20260808_social_invites.sql) was missing a blocks
-- check — every other invite-adjacent write in this codebase checks it
-- (sendFriendRequest in friends.js, invite_friend_to_gathering's own
-- blocks check). Caught while comparing against invite_friend_to_gathering,
-- a real, already-deployed, already-wired gathering-invite RPC found after
-- writing the first version of this function — see CLAUDE.md correction.
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

  if exists (
    select 1 from blocks
    where (blocker_id = auth.uid() and blocked_id = invitee_id_param)
       or (blocker_id = invitee_id_param and blocked_id = auth.uid())
  ) then
    raise exception 'This person cannot be invited';
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
