-- Idea "360" narrow fix (owner, 2026-10-23, option b): the gathering Invite sheet showed Invite for every friend, so it offered
-- Invite for a friend already going or already invited, and listed friends a women-only gathering (or a host block) refuses.
--
-- ONE rule, private._gathering_invitee_state(gathering, inviter, invitee), decides a friend's state for a gathering:
--   not_friend | blocked (inviter <-> invitee) | going (host or approved attendee) | women_only | host_blocked
--   | invited (the inviter's own invite is pending or accepted) | invite
-- Both readers use it, so the sheet and the server can't drift:
--   * get_gathering_invite_states(gathering) -> (friend_id, state) for the caller's accepted friends, collapsed to
--     going / invited / ineligible / invite (the sheet hides ineligible, shows Going / Invited without a button).
--     Only for a gathering the caller can see (item 147's _gathering_row_visible); otherwise no rows.
--   * invite_friend_to_gathering stays the final authority: it re-reads the rule at send time and refuses going / invited
--     (incl. a concurrent duplicate that loses the unique-index race) with hint 'invite_state:<state>', so the client never
--     shows a success it didn't get. Existing refusal messages are unchanged; they now also carry the hint.
-- "Invited" is only the caller's own invites (never reveals that someone else invited the friend).

create or replace function private._gathering_invitee_state(p_gathering uuid, p_inviter uuid, p_invitee uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_host uuid;
  v_women_only boolean;
begin
  if not exists (
    select 1 from friendships
    where status = 'accepted'
      and ((user_a = p_inviter and user_b = p_invitee) or (user_a = p_invitee and user_b = p_inviter))
  ) then
    return 'not_friend';
  end if;

  if exists (
    select 1 from blocks
    where (blocker_id = p_inviter and blocked_id = p_invitee) or (blocker_id = p_invitee and blocked_id = p_inviter)
  ) then
    return 'blocked';
  end if;

  select host_id, women_only into v_host, v_women_only from gatherings where id = p_gathering;

  if p_invitee = v_host
     or exists (select 1 from gathering_interest where gathering_id = p_gathering and user_id = p_invitee and status = 'approved') then
    return 'going';
  end if;

  if coalesce(v_women_only, false)
     and lower(coalesce((select gender from profiles where id = p_invitee), '')) not in ('female', 'woman') then
    return 'women_only';
  end if;

  if v_host is not null and exists (
    select 1 from blocks
    where (blocker_id = v_host and blocked_id = p_invitee) or (blocker_id = p_invitee and blocked_id = v_host)
  ) then
    return 'host_blocked';
  end if;

  if exists (
    select 1 from social_invites
    where inviter_id = p_inviter and invitee_id = p_invitee and invite_type = 'gathering' and target_id = p_gathering
      and status in ('pending', 'accepted')
  ) then
    return 'invited';
  end if;

  return 'invite';
end;
$$;

revoke all on function private._gathering_invitee_state(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.get_gathering_invite_states(gathering_id_param uuid)
returns table (friend_id uuid, state text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if not exists (
    select 1 from gatherings g
    where g.id = gathering_id_param
      and public._gathering_row_visible(g.id, g.host_id, g.visibility, g.women_only, g.community_id, g.hosting_partner_id)
  ) then
    return;
  end if;

  return query
    select f.fid,
           case s.st
             when 'going' then 'going'
             when 'invited' then 'invited'
             when 'invite' then 'invite'
             else 'ineligible'
           end
    from (
      select case when user_a = v_uid then user_b else user_a end as fid
      from friendships
      where status = 'accepted' and (user_a = v_uid or user_b = v_uid)
    ) f
    cross join lateral (select private._gathering_invitee_state(gathering_id_param, v_uid, f.fid) as st) s;
end;
$$;

revoke all on function public.get_gathering_invite_states(uuid) from public, anon;
grant execute on function public.get_gathering_invite_states(uuid) to authenticated;

create or replace function public.invite_friend_to_gathering(gathering_id_param uuid, friend_id_param uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_state text;
  v_invite_id uuid;
begin
  if not coalesce((select allow_attendee_invites from gatherings where id = gathering_id_param), true)
     and auth.uid() is distinct from (select host_id from gatherings where id = gathering_id_param) then
    raise exception 'The host has turned off invitations for this gathering.';
  end if;

  v_state := private._gathering_invitee_state(gathering_id_param, auth.uid(), friend_id_param);

  if v_state = 'not_friend' then
    raise exception using message = 'You can only invite accepted friends', hint = 'invite_state:ineligible';
  elsif v_state = 'blocked' then
    raise exception using message = 'This person cannot be invited', hint = 'invite_state:ineligible';
  elsif v_state = 'going' then
    raise exception using message = 'Already going', hint = 'invite_state:going';
  elsif v_state = 'women_only' then
    raise exception using message = 'This gathering is women-only', hint = 'invite_state:ineligible';
  elsif v_state = 'host_blocked' then
    raise exception using message = 'This person cannot be invited to this gathering', hint = 'invite_state:ineligible';
  elsif v_state = 'invited' then
    raise exception using message = 'Already invited', hint = 'invite_state:invited';
  end if;

  insert into social_invites (inviter_id, invitee_id, invite_type, target_id)
  values (auth.uid(), friend_id_param, 'gathering', gathering_id_param)
  on conflict (inviter_id, invitee_id, invite_type, target_id) where status = 'pending' do nothing
  returning id into v_invite_id;

  -- A concurrent invite of the same friend won the race: say so instead of a second success.
  if v_invite_id is null then
    raise exception using message = 'Already invited', hint = 'invite_state:invited';
  end if;

  -- Item 125: the invitation is an event; the notification layer decides the push.
  perform public._emit_event('INVITATION_SENT', 'social_invite', v_invite_id, auth.uid(), 'invite_friend_to_gathering',
    jsonb_build_object('invite_id', v_invite_id, 'gathering_id', gathering_id_param, 'invitee_id', friend_id_param),
    'INVITATION_SENT:' || v_invite_id);
end;
$function$;
