-- Owner (2026-10-02): video (and voice) call notifications get their own switch, split out of Dating, like Messages
-- (20270260).
--
-- The one call push, 'video_call' (notify_video_call_started; call_kind video or voice), is sent for EVERY match, dating
-- and friend matches alike, so the Dating switch used to silence friends' calls. It now belongs to its own group
-- 'video_calls'. Same store, same one check (_send_push via notification_type_groups). No sender is changed, and call
-- eligibility, permissions and the call itself are untouched.
--
-- 'video_calls' sits in the Dating STORAGE area, like 'messages': notify_dating is derived as off only when 'dating',
-- 'messages' AND 'video_calls' are all muted, so notify_video_call_started's older notify_dating check can never block a
-- call the person left on (and with Video calls muted, _send_push drops it). Onboarding's "Dating" answer ("Matches,
-- messages, waves and calls") and the older notify_dating key keep meaning what they meant: dating + messages + calls.

alter table public.profiles drop constraint if exists profiles_notification_mutes_known;

create or replace function public._canonical_notification_mutes(m text[])
returns text[] language sql immutable set search_path to 'public' as $$
  select coalesce(array(select g from unnest(array[
    'plans_invitations', 'plans_changes', 'plans_reminders', 'friends_activity', 'friends_occasions', 'dating', 'messages', 'video_calls',
    'business_offers', 'business_responses', 'discover_recommendations', 'discover_nearby_people', 'communities',
    'owner_requests', 'owner_offers', 'owner_reservations', 'owner_demand']) with ordinality u(g, i)
    where g = any (m) order by i), '{}');
$$;
revoke all on function public._canonical_notification_mutes(text[]) from public, anon, authenticated;

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
  new.notify_dating := not (m @> array['dating', 'messages', 'video_calls']);
  new.notify_business := not (m @> array['business_offers', 'business_responses']);
  new.notify_discovery := not (m @> array['discover_recommendations']);
  new.notify_proximity := not (m @> array['discover_nearby_people']);
  new.notify_community := not (m @> array['communities']);
  return new;
end;
$fn$;
revoke all on function public._derive_legacy_notify_columns() from public, anon, authenticated;

-- Keep what people chose. Opt-out migration state, exactly: a person whose mutes contain 'dating' gets 'video_calls'
-- added (Dating controlled calls until now). Nothing is removed and nothing else is added: 'messages' stays as it is
-- (on or off as they left it after 20270260), every other group is untouched, and no one gains a notification.
update public.profiles set notification_mutes = public._canonical_notification_mutes(notification_mutes || array['video_calls'])
 where 'dating' = any (notification_mutes);

alter table public.profiles add constraint profiles_notification_mutes_known check (notification_mutes <@ array[
  'plans_invitations', 'plans_changes', 'plans_reminders', 'friends_activity', 'friends_occasions', 'dating', 'messages', 'video_calls',
  'business_offers', 'business_responses', 'discover_recommendations', 'discover_nearby_people', 'communities',
  'owner_requests', 'owner_offers', 'owner_reservations', 'owner_demand']::text[]);

update public.notification_type_groups set group_key = 'video_calls' where type = 'video_call';

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
      'dating', 'messages', 'video_calls', 'business_offers', 'business_responses', 'discover_recommendations', 'discover_nearby_people', 'communities',
      'owner_requests', 'owner_offers', 'owner_reservations', 'owner_demand') then
    raise exception 'Unknown notification type';
  end if;
  -- Owner groups are a business owner's own setting (same rule as before item 143).
  if group_param like 'owner\_%' and not exists (select 1 from profiles where id = auth.uid() and managed_partner_id is not null) then
    raise exception 'Only a business owner can change this.';
  end if;
  update profiles set notification_mutes = case
      when enabled_param then array_remove(notification_mutes, group_param)
      else public._canonical_notification_mutes(notification_mutes || group_param) end
    where id = auth.uid()
    returning notification_mutes into v;
  return v;
end;
$fn$;
revoke all on function public.set_my_notification_group(text, boolean) from public, anon;
grant execute on function public.set_my_notification_group(text, boolean) to authenticated;
