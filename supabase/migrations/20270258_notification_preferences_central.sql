-- Item 142 (2026-10-02, owner): people control notification TYPES, centralized.
--   One store:  profiles.notification_mutes = the groups a person turned off (empty = everything on).
--   One check:  _send_push (the database's only push sender) drops a push whose type's group is muted; it is never queued.
--   One table:  notification_type_groups (type -> group) = src/constants/notificationPreferences.js NOTIFICATION_GROUP_BY_TYPE
--               (Jest asserts the seed below is identical).
-- The older on/off columns (notify_planning, notify_social, notify_dating, notify_business, notify_discovery,
-- notify_proximity, notify_community) become DERIVED: a trigger sets each to false only when every group of its area is
-- muted, and overrides any direct write. Each group sits in the area of the column its sender already checks, so the ~85
-- older per-function checks can never block a push the person left on. Exception fixed here: friend_joined_gathering moves
-- from Plans to Friends > Friend activity, so its sender stops reading notify_planning.
-- Existing choices are kept: a column that is false today becomes all of its area's groups muted.
-- Business-owner and account notifications have no group here (owner groups in send-push; account notices can't be muted).

alter table public.profiles add column if not exists notification_mutes text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_notification_mutes_known;
alter table public.profiles add constraint profiles_notification_mutes_known check (notification_mutes <@ array[
  'plans_invitations', 'plans_changes', 'plans_reminders', 'friends_activity', 'friends_occasions', 'dating',
  'business_offers', 'business_responses', 'discover_recommendations', 'discover_nearby_people', 'communities']::text[]);

create table if not exists public.notification_type_groups (
  type text primary key,
  group_key text not null
);
alter table public.notification_type_groups enable row level security;
revoke all on public.notification_type_groups from public, anon, authenticated;
delete from public.notification_type_groups;
insert into public.notification_type_groups (type, group_key) values
  ('gathering_invite', 'plans_invitations'),
  ('group_plan_invite', 'plans_invitations'),
  ('occasion_group_plan_invite', 'plans_invitations'),
  ('date_proposal', 'plans_invitations'),
  ('experience_shared', 'plans_invitations'),
  ('gathering_approved', 'plans_changes'),
  ('gathering_waitlisted', 'plans_changes'),
  ('gathering_interest', 'plans_changes'),
  ('gathering_updated', 'plans_changes'),
  ('gathering_cancelled', 'plans_changes'),
  ('date_proposal_response', 'plans_changes'),
  ('plan_organizer_added', 'plans_changes'),
  ('plan_confirmed', 'plans_changes'),
  ('plan_reservation_cancelled', 'plans_changes'),
  ('plan_cancelled', 'plans_changes'),
  ('plan_addon_removed', 'plans_changes'),
  ('plan_item_time_changed', 'plans_changes'),
  ('group_plan_response', 'plans_changes'),
  ('group_plan_confirmed', 'plans_changes'),
  ('group_plan_offer_pending', 'plans_changes'),
  ('group_plan_reservation_confirmed', 'plans_changes'),
  ('group_plan_removed', 'plans_changes'),
  ('social_offer_received', 'plans_changes'),
  ('social_offer_responded', 'plans_changes'),
  ('occasion_group_plan_decided', 'plans_changes'),
  ('occasion_group_plan_voting_business', 'plans_changes'),
  ('occasion_group_plan_stalled', 'plans_changes'),
  ('occasion_group_plan_date_set', 'plans_changes'),
  ('occasion_group_plan_cancelled', 'plans_changes'),
  ('occasion_group_plan_guest_rsvp', 'plans_changes'),
  ('occasion_surprise_revealed', 'plans_changes'),
  ('gathering_reminder', 'plans_reminders'),
  ('gathering_business_reminder', 'plans_reminders'),
  ('recurring_gathering', 'plans_reminders'),
  ('friend_request', 'friends_activity'),
  ('friend_accepted', 'friends_activity'),
  ('friend_discovery_match', 'friends_activity'),
  ('friend_joined_gathering', 'friends_activity'),
  ('new_story', 'friends_activity'),
  ('preference_poll_received', 'friends_activity'),
  ('birthday', 'friends_occasions'),
  ('birthday_upcoming', 'friends_occasions'),
  ('anniversary_upcoming', 'friends_occasions'),
  ('occasion_upcoming', 'friends_occasions'),
  ('match', 'dating'),
  ('new_match', 'dating'),
  ('message', 'dating'),
  ('wave', 'dating'),
  ('video_call', 'dating'),
  ('screenshot', 'dating'),
  ('match_reminder', 'dating'),
  ('playlist_addition', 'dating'),
  ('trip_idea_addition', 'dating'),
  ('shared_decision_addition', 'dating'),
  ('constitution_addition', 'dating'),
  ('memory_addition', 'dating'),
  ('stress_test_addition', 'dating'),
  ('timeline_addition', 'dating'),
  ('business_offer_received', 'business_offers'),
  ('business_update', 'business_offers'),
  ('business_recall_outreach', 'business_offers'),
  ('business_offer_withdrawn', 'business_responses'),
  ('business_offer_declined', 'business_responses'),
  ('business_request_all_declined', 'business_responses'),
  ('business_reservation_confirmed', 'business_responses'),
  ('business_reservation_cancelled', 'business_responses'),
  ('recommended_gathering', 'discover_recommendations'),
  ('recommended_business_availability', 'discover_recommendations'),
  ('group_intent_signal', 'discover_recommendations'),
  ('first_mission_reminder', 'discover_recommendations'),
  ('momentum_streak_nudge', 'discover_recommendations'),
  ('reward_tier_nudge', 'discover_recommendations'),
  ('crossed_paths_sighting', 'discover_nearby_people'),
  ('community_area_demand_growing', 'communities'),
  ('community_cancelled', 'communities');

-- Keep what people already chose.
update public.profiles set notification_mutes = array(select g from unnest(array[
  'plans_invitations', 'plans_changes', 'plans_reminders', 'friends_activity', 'friends_occasions', 'dating',
  'business_offers', 'business_responses', 'discover_recommendations', 'discover_nearby_people', 'communities']) g
  where (g in ('plans_invitations', 'plans_changes', 'plans_reminders') and notify_planning = false)
     or (g in ('friends_activity', 'friends_occasions') and notify_social = false)
     or (g = 'dating' and notify_dating = false)
     or (g in ('business_offers', 'business_responses') and notify_business = false)
     or (g = 'discover_recommendations' and notify_discovery = false)
     or (g = 'discover_nearby_people' and notify_proximity = false)
     or (g = 'communities' and notify_community = false))
where notify_planning = false or notify_social = false or notify_dating = false or notify_business = false
   or notify_discovery = false or notify_proximity = false or notify_community = false;

create or replace function public._derive_legacy_notify_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
declare
  m text[] := coalesce(new.notification_mutes, '{}');
begin
  new.notify_planning := not (m @> array['plans_invitations', 'plans_changes', 'plans_reminders']);
  new.notify_social := not (m @> array['friends_activity', 'friends_occasions']);
  new.notify_dating := not (m @> array['dating']);
  new.notify_business := not (m @> array['business_offers', 'business_responses']);
  new.notify_discovery := not (m @> array['discover_recommendations']);
  new.notify_proximity := not (m @> array['discover_nearby_people']);
  new.notify_community := not (m @> array['communities']);
  return new;
end;
$fn$;
revoke all on function public._derive_legacy_notify_columns() from public, anon, authenticated;
drop trigger if exists b_derive_legacy_notify_columns on public.profiles;
create trigger b_derive_legacy_notify_columns before insert or update on public.profiles
  for each row execute function public._derive_legacy_notify_columns();
-- The columns already match the store after the conversion above; only a NULL column (never set) needs deriving.
update public.profiles set notification_mutes = notification_mutes
where notify_planning is null or notify_social is null or notify_dating is null or notify_business is null
   or notify_discovery is null or notify_proximity is null or notify_community is null;

create or replace function public._push_muted(recipient_id_param uuid, type_param text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from notification_type_groups t join profiles p on p.id = recipient_id_param
    where t.type = type_param and t.group_key = any (p.notification_mutes));
$$;
revoke all on function public._push_muted(uuid, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._send_push(recipient_id_param uuid, title_param text, body_param text, data_param jsonb, dedupe_key_param text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint;
begin
  if recipient_id_param is null then
    return 'no_recipient';
  end if;
  -- Item 142: the person's own notification choices, decided here once for every push.
  if public._push_muted(recipient_id_param, data_param->>'type') then
    return 'muted';
  end if;
  insert into push_outbox (recipient_id, title, body, data, dedupe_key)
  values (recipient_id_param, title_param, body_param, coalesce(data_param, '{}'::jsonb), dedupe_key_param)
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    return 'duplicate';
  end if;
  return public._push_outbox_deliver(v_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public._notify_event_recipient(event_id_param bigint, recipient_id_param uuid, mute_ok_param boolean, title_param text, body_param text, data_param jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid;
  v_outcome text;
begin
  if recipient_id_param is null then
    return false;
  end if;
  if exists (select 1 from domain_event_notifications
             where event_id = event_id_param and recipient_id = recipient_id_param and channel = 'push') then
    return false;  -- this event already notified this person
  end if;
  select actor_id into v_actor from domain_events where id = event_id_param;
  if v_actor is not null and v_actor <> recipient_id_param and exists (
       select 1 from blocks
       where (blocker_id = v_actor and blocked_id = recipient_id_param)
          or (blocker_id = recipient_id_param and blocked_id = v_actor)) then
    v_outcome := 'blocked';
  elsif not coalesce(mute_ok_param, true) then
    v_outcome := 'muted';
  else
    -- Item 142: _send_push may also refuse for the person's own group choices; record that as muted, not sent.
    v_outcome := case public._send_push(recipient_id_param, title_param, body_param, data_param,
                                        'event:' || event_id_param || ':' || recipient_id_param)
                   when 'retry' then 'retrying' when 'muted' then 'muted' else 'sent' end;
  end if;
  insert into domain_event_notifications (event_id, recipient_id, channel, notification_type, outcome)
  values (event_id_param, recipient_id_param, 'push', coalesce(data_param->>'type', 'unknown'), v_outcome);
  return v_outcome in ('sent', 'retrying');
end;
$function$;

create or replace function public.set_my_notification_group(group_param text, enabled_param boolean)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v text[];
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if group_param not in ('plans_invitations', 'plans_changes', 'plans_reminders', 'friends_activity', 'friends_occasions',
      'dating', 'business_offers', 'business_responses', 'discover_recommendations', 'discover_nearby_people', 'communities') then
    raise exception 'Unknown notification type';
  end if;
  update profiles set notification_mutes = case
      when enabled_param then array_remove(notification_mutes, group_param)
      when group_param = any (notification_mutes) then notification_mutes
      else notification_mutes || group_param end
    where id = auth.uid()
    returning notification_mutes into v;
  return v;
end;
$fn$;
revoke all on function public.set_my_notification_group(text, boolean) from public, anon;
grant execute on function public.set_my_notification_group(text, boolean) to authenticated;

-- friend_joined_gathering is Friends > Friend activity now; _send_push applies that choice, so the sender stops reading
-- notify_planning (otherwise muting all of Plans would also silence it).
CREATE OR REPLACE FUNCTION public.notify_interested_friend_joined()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g record;
  joiner_name text;
  r record;
begin
  if new.status <> 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') then
    return new;
  end if;

  select id, host_id, title, scheduled_at into g from gatherings where id = new.gathering_id;
  if g.id is null or g.scheduled_at <= now() or g.host_id = new.user_id then
    return new;
  end if;

  select display_name into joiner_name from profiles where id = new.user_id;

  for r in
    select gd.user_id from gathering_interested gd
     where gd.gathering_id = new.gathering_id
       and gd.user_id <> new.user_id
       -- accepted friends only (not matches, not strangers)
       and exists (select 1 from friendships f where f.status = 'accepted'
                    and ((f.user_a = gd.user_id and f.user_b = new.user_id) or (f.user_a = new.user_id and f.user_b = gd.user_id)))
       and not exists (select 1 from blocks b
                        where (b.blocker_id = gd.user_id and b.blocked_id = new.user_id)
                           or (b.blocker_id = new.user_id and b.blocked_id = gd.user_id)
                           or (b.blocker_id = g.host_id and b.blocked_id = gd.user_id)
                           or (b.blocker_id = gd.user_id and b.blocked_id = g.host_id))
  loop
    insert into gathering_interested_friend_pushes (gathering_id, user_id) values (new.gathering_id, r.user_id)
      on conflict do nothing;
    if not found then
      continue;
    end if;
    perform public._send_push(r.user_id, 'A friend is going', coalesce(joiner_name, 'A friend') || ' is going to "' || g.title || '". Want to join?', jsonb_build_object('type', 'friend_joined_gathering', 'gathering_id', g.id));
  end loop;
  return new;
end;
$function$;
