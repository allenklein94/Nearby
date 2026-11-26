-- Rollback of 20270428 (business message alerts): customer messages stop alerting the business again. Messages are
-- untouched; only the alert windows (timestamps per conversation, no content) are dropped. Queued pushes already in the
-- outbox are left as they are (they carry no message text).
drop trigger if exists zz_alert_business_message on public.business_messages;
drop function if exists private._alert_business_message();
drop function if exists private._business_message_recipients(uuid);
drop table if exists private.business_message_alert_windows;
delete from public.notification_type_groups where type = 'business_message_received';
-- The Messages switch goes too: drop it from everyone's saved choices (it controlled nothing else), then restore
-- 20270262's canonical list, known-groups check and set_my_notification_group exactly.
alter table public.profiles drop constraint if exists profiles_notification_mutes_known;
update public.profiles set notification_mutes = array_remove(notification_mutes, 'owner_messages') where 'owner_messages' = any (notification_mutes);
create or replace function public._canonical_notification_mutes(m text[])
returns text[] language sql immutable set search_path to 'public' as $$
  select coalesce(array(select g from unnest(array[
    'plans_invitations', 'plans_changes', 'plans_reminders', 'friends_activity', 'friends_occasions', 'dating', 'messages', 'video_calls', 'shared_playlists_trips',
    'business_offers', 'business_responses', 'discover_recommendations', 'discover_nearby_people', 'communities',
    'owner_requests', 'owner_offers', 'owner_reservations', 'owner_demand']) with ordinality u(g, i)
    where g = any (m) order by i), '{}');
$$;
revoke all on function public._canonical_notification_mutes(text[]) from public, anon, authenticated;

alter table public.profiles add constraint profiles_notification_mutes_known check (notification_mutes <@ array[
  'plans_invitations', 'plans_changes', 'plans_reminders', 'friends_activity', 'friends_occasions', 'dating', 'messages', 'video_calls', 'shared_playlists_trips',
  'business_offers', 'business_responses', 'discover_recommendations', 'discover_nearby_people', 'communities',
  'owner_requests', 'owner_offers', 'owner_reservations', 'owner_demand']::text[]);

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
      'dating', 'messages', 'video_calls', 'shared_playlists_trips', 'business_offers', 'business_responses', 'discover_recommendations', 'discover_nearby_people', 'communities',
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

