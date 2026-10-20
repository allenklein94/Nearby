-- Owner idea "244" follow-up (owner decision 2026-10-20, option 1 "Share button only"): a person can explicitly share a
-- gathering into one of their existing one-to-one chats as a compact card; tapping it opens that gathering.
--   - ONE way in: share_gathering_in_chat(). It is only ever called by the person's own tap on GatheringDetail's
--     "Share in a chat" (never automatically, never inferred from message text, item 131).
--   - The sender must be a participant of that chat (not blocked either way, as the messages insert policy) and must be
--     able to see the gathering themselves (_gathering_row_visible, item 147).
--   - The recipient sees the card's contents ONLY through their own read of gatherings (the item 147 SELECT policy): the
--     message carries just the id, never a title or time, and the push says "Shared a gathering" (no title), so nothing
--     leaks to a recipient who cannot already see it. No new reader of gathering rows.
--   - messages.gathering_id can't be written or changed by a direct client insert/update (guard trigger). It is a plain id,
--     deliberately NOT a foreign key: a deleted gathering must leave the message recognisable as a share, so the card reads
--     "no longer available" exactly as it does for a recipient who may not see it (their own read returns nothing).

alter table public.messages add column if not exists gathering_id uuid;

create or replace function public._messages_gathering_id_guard()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.gathering_id is not null and coalesce(current_setting('app.gathering_share', true), '') <> 'on' then
      raise exception 'A gathering can only be shared with Share in a chat' using errcode = '42501';
    end if;
  elsif new.gathering_id is distinct from old.gathering_id then
    raise exception 'A shared gathering can''t be changed' using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public._messages_gathering_id_guard() from public, anon, authenticated;

drop trigger if exists messages_gathering_id_guard on public.messages;
create trigger messages_gathering_id_guard
  before insert or update of gathering_id on public.messages
  for each row execute function public._messages_gathering_id_guard();

create or replace function public.share_gathering_in_chat(match_id_param uuid, gathering_id_param uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_g record;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from matches m where m.id = match_id_param
                 and (m.user_a = v_uid or m.user_b = v_uid) and not is_blocked(m.user_a, m.user_b)) then
    raise exception 'Chat not found' using errcode = '42501';
  end if;
  select id, host_id, visibility, women_only, community_id, hosting_partner_id into v_g
    from gatherings where id = gathering_id_param;
  if v_g.id is null or not public._gathering_row_visible(v_g.id, v_g.host_id, v_g.visibility, v_g.women_only,
                                                         v_g.community_id, v_g.hosting_partner_id) then
    raise exception 'Gathering not found' using errcode = '42501';
  end if;
  perform set_config('app.gathering_share', 'on', true);
  insert into messages (match_id, sender_id, body, gathering_id)
    values (match_id_param, v_uid, '', gathering_id_param)
    returning id into v_id;
  perform set_config('app.gathering_share', '', true);
  return v_id;
end;
$function$;

revoke all on function public.share_gathering_in_chat(uuid, uuid) from public, anon;
grant execute on function public.share_gathering_in_chat(uuid, uuid) to authenticated;

-- The new-message push names a shared gathering without its title (the recipient may not be able to see it).
create or replace function public.notify_new_message()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  recipient uuid;
  recipient_wants_notif boolean;
  sender_name text;
  notif_body text;
begin
  select case when m.user_a = new.sender_id then m.user_b else m.user_a end
  into recipient
  from matches m where m.id = new.match_id;
  select notify_dating into recipient_wants_notif from profiles where id = recipient;
  select display_name into sender_name from profiles where id = new.sender_id;

  notif_body := case
    when new.gathering_id is not null then 'Shared a gathering'
    when new.audio_url is not null then 'Sent a voice message'
    when new.media_url is not null then 'Sent a photo'
    when new.gif_url is not null then 'Sent a GIF'
    when new.body is not null and new.body != '' then left(new.body, 100)
    else 'Sent a message'
  end;

  if recipient_wants_notif then
    perform public._send_push(recipient, coalesce(sender_name, 'New message'), notif_body, jsonb_build_object('type', 'message', 'match_id', new.match_id));
  end if;
  return new;
end;
$function$;
