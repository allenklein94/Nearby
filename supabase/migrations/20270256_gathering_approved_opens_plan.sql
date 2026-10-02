-- Item 140 (2026-10-02, owner): "Claude accepted your gathering -> View Plan". The approval push (and the
-- "a spot opened up and you're in" push) carried only match_id and opened the gathering's chat ("Start chatting!"),
-- and opened nothing when match_id was null. It now also carries gathering_id, the app opens the plan
-- (GatheringDetail, where the group chat is one tap away), and the copy says what the tap does. match_id is kept so an
-- older app version still opens something. Only these two strings and the payload change; who is notified, when, and
-- the mute rules are unchanged. Patched from the live body (single overload).
CREATE OR REPLACE FUNCTION public.notify_gathering_approved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  gathering_title text;
  interested_user_wants_notif boolean;
  v_host_id uuid;
begin
  if new.status = 'approved' and old.status in ('pending', 'waitlisted') then

    select title into gathering_title from gatherings where id = new.gathering_id;
    select coalesce(notify_planning, true) into interested_user_wants_notif from profiles where id = new.user_id;

    if interested_user_wants_notif then
      perform public._send_push(new.user_id, case when old.status = 'waitlisted' then 'A spot opened up!' else 'You''re approved!' end, case when old.status = 'waitlisted'
            then 'A spot opened up in "' || gathering_title || '" and you''re in.'
            else 'The host of "' || gathering_title || '" approved your request. You''re in.' end, jsonb_build_object('type', 'gathering_approved', 'gathering_id', new.gathering_id, 'match_id', new.match_id));
    end if;
  elsif new.status = 'pending' and old.status = 'waitlisted' then
    -- Waitlist promotion on an approval-required gathering: the person moves to the SAME pending state a normal request
    -- has (20270120). Tell the host there is a request to review and tell the person a spot opened up.
    select title, host_id into gathering_title, v_host_id from gatherings where id = new.gathering_id;
    if coalesce((select notify_planning from profiles where id = v_host_id), true)
       and coalesce((select host_notifications from gatherings where id = new.gathering_id), true) then
      perform public._send_push(v_host_id, 'A spot opened up', 'Next on the waitlist for "' || gathering_title || '" is waiting for your approval.', jsonb_build_object('type', 'gathering_interest', 'gathering_id', new.gathering_id));
    end if;
    if coalesce((select notify_planning from profiles where id = new.user_id), true) then
      perform public._send_push(new.user_id, 'A spot opened up', 'A spot opened up in "' || gathering_title || '" — the host will review your request.', jsonb_build_object('type', 'gathering_updated', 'gathering_id', new.gathering_id));
    end if;
  elsif new.status = 'waitlisted' and old.status = 'pending' then

    select title into gathering_title from gatherings where id = new.gathering_id;
    select coalesce(notify_planning, true) into interested_user_wants_notif from profiles where id = new.user_id;

    if interested_user_wants_notif then
      perform public._send_push(new.user_id, 'Added to the waitlist', '"' || gathering_title || '" is full, but you''re on the waitlist — we''ll let you know if a spot opens.', jsonb_build_object('type', 'gathering_waitlisted', 'gathering_id', new.gathering_id));
    end if;
  end if;
  return new;
end;
$function$;
