-- Item 133 (owner, 2026-10-16): notification -> destination continuity. "{Name} accepted your friend request." carried no
-- person id, so its tap opened the Friends list (find the person yourself). The push now carries the accepter's id as
-- `user_id` and opens that friend's profile (navigation/notificationDestinations.js; action button 'view_profile').
-- Body, title, mute group (notify_social / friends_activity) and dedupe unchanged. They are accepted friends at this point
-- (status just became 'accepted'), so opening the profile shows nothing a friend could not already see.
CREATE OR REPLACE FUNCTION public.notify_friend_request_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_accepter_name text;
  v_accepter uuid;
  v_requester uuid;
  v_requester_wants_notif boolean;
begin
  if new.status = 'accepted' and old.status = 'pending' then
    v_requester := new.requested_by;
    select coalesce(notify_social, true) into v_requester_wants_notif from profiles where id = v_requester;
    if not v_requester_wants_notif then
      return new;
    end if;

    v_accepter := case when new.requested_by = new.user_a then new.user_b else new.user_a end;
    select display_name into v_accepter_name from profiles where id = v_accepter;

    perform public._send_push(v_requester, 'Friend request accepted', coalesce(v_accepter_name, 'Someone') || ' accepted your friend request.', jsonb_build_object('type', 'friend_accepted', 'user_id', v_accepter));
  end if;
  return new;
end;
$function$;
