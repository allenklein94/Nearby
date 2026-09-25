-- Owner item 56 follow-up (2026-09-25, decision LOCKED: option 1 only -- no new onboarding step/screen).
-- Most of item 56 already existed under "What do you want more of?" (priority_attributes for Groups/Date nights/
-- Families, priority_time_windows for Weekday/Last-minute/Large groups, priority_occasions for specific occasions,
-- and Fulfillment Policy's party_size_min/max already scores a party-size fit). The one real gap: only COARSE
-- time-of-day buckets existed (morning/afternoon/evening/weekend), never an exact "4-7 PM" window. This adds that
-- as an ADDITIVE, optional refinement -- it supplements the coarse buckets, never replaces them, and a business
-- with none set behaves exactly as before. This is a PREFERENCE for the kind of opportunity the business wants to
-- see ranked higher, never an availability/hours promise (that stays the separate availability-posting system).
alter table public.brand_partners add column if not exists priority_time_start time without time zone;
alter table public.brand_partners add column if not exists priority_time_end time without time zone;
alter table public.brand_partners drop constraint if exists brand_partners_priority_time_range_check;
alter table public.brand_partners add constraint brand_partners_priority_time_range_check check (
  (priority_time_start is null and priority_time_end is null)
  or (priority_time_start is not null and priority_time_end is not null and priority_time_end > priority_time_start)
);

create or replace function public.set_business_priority_time_range(partner_id_param uuid, start_param time without time zone, end_param time without time zone)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  if (start_param is null) <> (end_param is null) then
    raise exception 'Set both a start and an end time, or clear both.';
  end if;
  if start_param is not null and end_param <= start_param then
    raise exception 'The end time must be after the start time.';
  end if;

  update brand_partners
  set priority_time_start = start_param,
      priority_time_end = end_param
  where id = partner_id_param;
end;
$function$;
revoke all on function public.set_business_priority_time_range(uuid, time without time zone, time without time zone) from public, anon;
grant execute on function public.set_business_priority_time_range(uuid, time without time zone, time without time zone) to authenticated;
