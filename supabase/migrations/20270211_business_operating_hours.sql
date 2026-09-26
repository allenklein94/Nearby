-- Owner item 71 (2026-09-26): "Open now" as a universal Discover filter. Nearby businesses had no hours (a locked "never invent
-- hours" rule), so the owner now DECLARES weekly hours on the existing Profile tab. NULL = not said = "unknown" everywhere (never
-- "closed"). Evaluated on the client by the one resolver, src/utils/operatingStatus.js, in the business's own timezone.
--
-- Shape (validated here and by operatingHoursProblem() in that file; the rules must stay identical):
--   { "timezone": "America/Los_Angeles",
--     "week": { "sun".."sat": "closed" | "all_day" | [["09:00","14:00"],["17:00","22:00"]] },  -- all seven days required
--     "special": [ { "date": "2026-12-25", "hours": "closed" | "all_day" | [[...]] } ],       -- optional, max 60
--     "temporarily_closed": false }                                                          -- optional
-- A range whose close is at or before its open runs past midnight ("22:00"-"02:00"); 1-4 ranges a day; ranges may not overlap,
-- and last night's late range may not run into the next day's first range. Nothing is ever corrected silently.
alter table public.brand_partners add column if not exists operating_hours jsonb;

create or replace function public._operating_minutes(t text)
returns integer
language sql
immutable
as $$
  select case when t ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    then split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int end
$$;

-- The first problem with one day's value, or null. `label` names the day in the message.
create or replace function public._operating_day_problem(d jsonb, label text)
returns text
language plpgsql
immutable
as $$
declare
  iv jsonb;
  o int;
  c int;
  starts int[] := '{}';
  ends int[] := '{}';
  i int;
  j int;
begin
  if jsonb_typeof(d) = 'string' then
    if d #>> '{}' in ('closed', 'all_day') then return null; end if;
    return label || ': choose Closed, 24 hours, or add hours.';
  end if;
  if jsonb_typeof(d) is distinct from 'array' or jsonb_array_length(d) = 0 then
    return label || ': choose Closed, 24 hours, or add hours.';
  end if;
  if jsonb_array_length(d) > 4 then return label || ': at most 4 time ranges.'; end if;
  for iv in select * from jsonb_array_elements(d) loop
    if jsonb_typeof(iv) is distinct from 'array' or jsonb_array_length(iv) <> 2 then
      return label || ': pick an opening and a closing time.';
    end if;
    o := public._operating_minutes(iv ->> 0);
    c := public._operating_minutes(iv ->> 1);
    if o is null or c is null then return label || ': pick an opening and a closing time.'; end if;
    if o = c then return label || ': opening and closing can''t be the same time (use 24 hours instead).'; end if;
    if c <= o then c := c + 1440; end if;
    starts := starts || o;
    ends := ends || c;
  end loop;
  for i in 1 .. coalesce(array_length(starts, 1), 0) loop
    for j in 1 .. coalesce(array_length(starts, 1), 0) loop
      if i <> j and starts[i] < ends[j] and starts[j] < ends[i] then
        return label || ': time ranges overlap.';
      end if;
    end loop;
  end loop;
  return null;
end;
$$;

-- Latest close past midnight for a day (0 when none), used for the cross-day overlap rule.
create or replace function public._operating_day_tail(d jsonb)
returns integer
language sql
immutable
as $$
  select coalesce(max(
    case when public._operating_minutes(iv ->> 1) <= public._operating_minutes(iv ->> 0)
      then public._operating_minutes(iv ->> 1) end), 0)
  from jsonb_array_elements(case when jsonb_typeof(d) = 'array' then d else '[]'::jsonb end) iv
$$;

create or replace function public._operating_hours_problem(h jsonb)
returns text
language plpgsql
immutable
as $$
declare
  days text[] := array['sun','mon','tue','wed','thu','fri','sat'];
  labels text[] := array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  i int;
  p text;
  nxt jsonb;
  tail int;
  s jsonb;
  seen text[] := '{}';
begin
  if h is null then return null; end if;
  if jsonb_typeof(h) <> 'object' then return 'Hours are not readable.'; end if;
  if jsonb_typeof(h -> 'timezone') is distinct from 'string' or length(h ->> 'timezone') not between 1 and 64 then
    return 'Pick a valid time zone.';
  end if;
  if jsonb_typeof(h -> 'week') is distinct from 'object' then return 'Add hours for each day.'; end if;
  for i in 1 .. 7 loop
    p := public._operating_day_problem(h -> 'week' -> days[i], labels[i]);
    if p is not null then return p; end if;
  end loop;
  for i in 1 .. 7 loop
    tail := public._operating_day_tail(h -> 'week' -> days[i]);
    nxt := h -> 'week' -> days[(i % 7) + 1];
    if tail > 0 and jsonb_typeof(nxt) = 'array' and exists (
      select 1 from jsonb_array_elements(nxt) iv where public._operating_minutes(iv ->> 0) < tail
    ) then
      return labels[i] || '''s late hours run into the next day''s hours.';
    end if;
  end loop;
  if h ? 'special' then
    if jsonb_typeof(h -> 'special') <> 'array' or jsonb_array_length(h -> 'special') > 60 then
      return 'At most 60 special days.';
    end if;
    for s in select * from jsonb_array_elements(h -> 'special') loop
      if jsonb_typeof(s) <> 'object' or coalesce(s ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        return 'A special day needs a date.';
      end if;
      if (s ->> 'date') = any(seen) then return (s ->> 'date') || ' is listed twice.'; end if;
      seen := seen || (s ->> 'date');
      p := public._operating_day_problem(s -> 'hours', s ->> 'date');
      if p is not null then return p; end if;
    end loop;
  end if;
  if h ? 'temporarily_closed' and jsonb_typeof(h -> 'temporarily_closed') <> 'boolean' then
    return 'Temporary closure must be on or off.';
  end if;
  return null;
end;
$$;

alter table public.brand_partners drop constraint if exists brand_partners_operating_hours_check;
alter table public.brand_partners
  add constraint brand_partners_operating_hours_check
  check (public._operating_hours_problem(operating_hours) is null);

-- Owner-only. NULL clears the hours (the business goes back to "unknown", never "closed").
create or replace function public.set_business_operating_hours(partner_id_param uuid, hours_param jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  problem text;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  problem := public._operating_hours_problem(hours_param);
  if problem is not null then
    raise exception '%', problem;
  end if;
  if hours_param is not null and not exists (select 1 from pg_timezone_names where name = hours_param ->> 'timezone') then
    raise exception 'Pick a valid time zone.';
  end if;

  update brand_partners set operating_hours = hours_param where id = partner_id_param;
end;
$function$;

revoke all on function public._operating_minutes(text) from public, anon;
revoke all on function public._operating_day_problem(jsonb, text) from public, anon;
revoke all on function public._operating_day_tail(jsonb) from public, anon;
revoke all on function public._operating_hours_problem(jsonb) from public, anon;
-- The CHECK constraint runs these as whoever updates the row, so signed-in roles keep execute (pure validators, no data access).
grant execute on function public._operating_minutes(text) to authenticated, service_role;
grant execute on function public._operating_day_problem(jsonb, text) to authenticated, service_role;
grant execute on function public._operating_day_tail(jsonb) to authenticated, service_role;
grant execute on function public._operating_hours_problem(jsonb) to authenticated, service_role;
revoke all on function public.set_business_operating_hours(uuid, jsonb) from public, anon;
grant execute on function public.set_business_operating_hours(uuid, jsonb) to authenticated;
