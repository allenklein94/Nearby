-- Notification preferences for business owners. Owners used to get every alert with no control. Alerts are grouped the way an
-- owner thinks about them (requests, offers, reservations, demand signals) and each group can be muted. Applies to BOTH the
-- phone push and the email fallback: the single choke point (send-push Edge Function) reads this table. Account events
-- (partner approved, partnership responses) are never mutable. The type -> group map lives in
-- src/constants/businessNotificationGroups.js and is mirrored in send-push (a Jest test keeps the two identical).
-- Only owners have rows, so consumer pushes are untouched. Client access is RPC-only.

create table if not exists public.business_notification_prefs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  muted_groups text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.business_notification_prefs enable row level security;
revoke all on public.business_notification_prefs from public, anon, authenticated;

create or replace function public.get_my_business_notification_prefs()
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce((select muted_groups from business_notification_prefs where user_id = auth.uid()), '{}'::text[])
  where exists (select 1 from profiles where id = auth.uid() and managed_partner_id is not null);
$$;

create or replace function public.set_my_business_notification_group(group_param text, muted_param boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id is not null) then
    raise exception 'Only a business owner can change this.';
  end if;
  if group_param not in ('requests', 'offers', 'reservations', 'demand') then
    raise exception 'Unknown notification group.';
  end if;
  insert into business_notification_prefs (user_id, muted_groups)
  values (auth.uid(), case when muted_param then array[group_param] else '{}' end)
  on conflict (user_id) do update set
    muted_groups = case when muted_param then (select array(select distinct g from unnest(business_notification_prefs.muted_groups || group_param) g))
                        else array_remove(business_notification_prefs.muted_groups, group_param) end,
    updated_at = now();
end;
$$;

revoke all on function public.get_my_business_notification_prefs(), public.set_my_business_notification_group(text, boolean) from public, anon;
grant execute on function public.get_my_business_notification_prefs(), public.set_my_business_notification_group(text, boolean) to authenticated, service_role;
