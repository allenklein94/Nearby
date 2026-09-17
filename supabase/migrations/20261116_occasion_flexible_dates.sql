-- Item 98 (CLAUDE.md, "Don't require exact dates"): "Her birthday is
-- sometime next month" is a completely normal thing to know, and the app
-- currently can't hold it -- occasions.occasion_date is a plain NOT NULL
-- exact date, forced through a native day-picker with no other option,
-- and every reminder/nudge/display downstream treats it as gospel-exact
-- ("is in 7 days"). Especially useful when planning ahead, per the user's
-- own framing -- the further out an occasion is, the less likely anyone
-- actually knows the exact day yet.
--
-- Design: occasion_date stays a real, non-null anchor date (still needed
-- for sorting, next-occurrence math, and nudge timing -- making it
-- nullable would ripple through get_upcoming_occasions/
-- send_occasion_planning_nudges/getMyOccasions' own ORDER BY for no real
-- gain). A new `date_precision` column controls how that anchor is
-- INTERPRETED AND DISPLAYED, so the app never claims false precision it
-- doesn't have:
--   - 'exact'    -- the literal date (unchanged default/existing behavior).
--   - 'weekend'  -- anchor is rounded to that week's Saturday client-side
--                   (src/utils/occasionDatePrecision.js); shown as
--                   "Weekend of {date}".
--   - 'around'   -- anchor is the user's best guess; shown as
--                   "Around {date}".
--   - 'flexible' -- anchor is rounded to the 1st of the target month
--                   client-side; shown as "Sometime in {Month Year}" --
--                   this is the literal "sometime next month" case.
--
-- send_occasion_planning_nudges() is updated to match: 'exact'/'weekend'/
-- 'around' still fire at the same lead-time-before-the-anchor this
-- function already used, but with honest copy for the imprecise cases
-- (no fake day-count for 'around'/'weekend'); 'flexible' fires once, 5
-- days before the target month starts, with "sometime in {Month}" copy
-- rather than a specific day count that was never real to begin with.
--
-- A real, pre-existing regression was found and fixed in the same pass,
-- not hypothetical: send_occasion_planning_nudges() has ignored
-- occasions.reminder_enabled (Item 62's own per-occasion mute) since
-- 20261102_occasion_aware_notifications.sql's CREATE OR REPLACE silently
-- dropped the `where reminder_enabled` filter and the column from its own
-- SELECT list that 20261024/20261031 had correctly added -- confirmed
-- live via pg_get_functiondef before writing this migration. Restored
-- here, since this function is already being rewritten for date
-- precision anyway.
--
-- Deliberately scoped to `occasions` only (the personal reminder log) --
-- not gatherings/business_requests/occasion_group_plans.scheduled_date,
-- all of which represent something actually being scheduled/booked and
-- therefore need a real, concrete date once acted on. "Remembering a date
-- I don't know exactly yet" and "picking when to actually do something"
-- are different questions; this item is about the former.

alter table public.occasions
  add column if not exists date_precision text not null default 'exact';

alter table public.occasions drop constraint if exists occasions_date_precision_check;
alter table public.occasions
  add constraint occasions_date_precision_check
  check (date_precision in ('exact', 'weekend', 'around', 'flexible'));

-- ---- get_upcoming_occasions: also return date_precision ----
-- Column-list change on an unchanged argument list -- explicit drop
-- first, per this repo's own RETURNS TABLE gotcha.

drop function if exists public.get_upcoming_occasions(integer);

create or replace function public.get_upcoming_occasions(days_ahead_param integer default 30)
returns table(
  occasion_id uuid,
  owner_id uuid,
  owner_display_name text,
  connected_user_id uuid,
  occasion_type text,
  title text,
  who_for_name text,
  who_for_friend_id uuid,
  occasion_date date,
  date_precision text,
  days_until integer,
  resulting_plan_id uuid,
  last_planned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  r record;
  v_year int;
  v_month int;
  v_day int;
  v_next_date date;
  v_days_until int;
begin
  if v_caller is null then
    return;
  end if;

  for r in
    select o.id, o.user_id, p.display_name as owner_display_name, o.connected_user_id,
           o.occasion_type, o.title, o.who_for_name, o.who_for_friend_id,
           o.occasion_date, o.date_precision, o.recurs_annually, o.resulting_plan_id, o.last_planned_at
    from occasions o
    join profiles p on p.id = o.user_id
    where o.user_id = v_caller
       or (
         o.connected_user_id = v_caller
         and (
           exists (
             select 1 from friendships f
             where f.status = 'accepted'
               and ((f.user_a = v_caller and f.user_b = o.user_id) or (f.user_b = v_caller and f.user_a = o.user_id))
           )
           or exists (
             select 1 from matches m
             where (m.user_a = v_caller and m.user_b = o.user_id) or (m.user_b = v_caller and m.user_a = o.user_id)
           )
         )
       )
  loop
    if r.recurs_annually then
      v_year := extract(year from current_date)::int;
      v_month := extract(month from r.occasion_date)::int;
      v_day := extract(day from r.occasion_date)::int;

      begin
        v_next_date := make_date(v_year, v_month, v_day);
      exception when others then
        v_next_date := make_date(v_year, 2, 28);
      end;

      if v_next_date < current_date then
        begin
          v_next_date := make_date(v_year + 1, v_month, v_day);
        exception when others then
          v_next_date := make_date(v_year + 1, 2, 28);
        end;
      end if;

      v_days_until := v_next_date - current_date;
    else
      v_next_date := r.occasion_date;
      v_days_until := v_next_date - current_date;
      if v_days_until < 0 then
        continue;
      end if;
    end if;

    if v_days_until between 0 and days_ahead_param then
      occasion_id := r.id;
      owner_id := r.user_id;
      owner_display_name := r.owner_display_name;
      connected_user_id := r.connected_user_id;
      occasion_type := r.occasion_type;
      title := r.title;
      who_for_name := r.who_for_name;
      who_for_friend_id := r.who_for_friend_id;
      occasion_date := v_next_date;
      date_precision := r.date_precision;
      days_until := v_days_until;
      resulting_plan_id := r.resulting_plan_id;
      last_planned_at := r.last_planned_at;
      return next;
    end if;
  end loop;

  return;
end;
$$;

revoke all on function public.get_upcoming_occasions(integer) from public, anon;
grant execute on function public.get_upcoming_occasions(integer) to authenticated;

-- ---- send_occasion_planning_nudges: precision-aware trigger + copy,
-- plus the reminder_enabled regression fix above. Unchanged signature --
-- plain CREATE OR REPLACE is safe.

create or replace function public.send_occasion_planning_nudges()
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  service_key text;
  occasion_row record;
  v_next_date date;
  v_year int;
  v_month int;
  v_day int;
  v_lead_days int;
  v_body_suffix text;
  v_push_body text;
  v_trigger_today boolean;
  v_date_text text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for occasion_row in
    select id, user_id, occasion_type, title, occasion_date, date_precision, recurs_annually,
           who_for_name, who_for_friend_id, resulting_plan_id, last_planned_at, reminder_enabled
    from occasions
    where reminder_enabled
  loop
    if occasion_row.recurs_annually then
      v_year := extract(year from current_date)::int;
      v_month := extract(month from occasion_row.occasion_date)::int;
      v_day := extract(day from occasion_row.occasion_date)::int;
      begin
        v_next_date := make_date(v_year, v_month, v_day);
      exception when others then
        v_next_date := make_date(v_year, 2, 28);
      end;
      if v_next_date < current_date then
        begin
          v_next_date := make_date(v_year + 1, v_month, v_day);
        exception when others then
          v_next_date := make_date(v_year + 1, 2, 28);
        end;
      end if;
    else
      v_next_date := occasion_row.occasion_date;
    end if;

    v_lead_days := case occasion_row.occasion_type
      when 'anniversary' then 14
      when 'graduation' then 14
      when 'baby_shower' then 14
      when 'engagement' then 14
      when 'housewarming' then 14
      else 7
    end;

    -- A 'flexible' anchor is the 1st of the target month -- a "N days
    -- before this exact day" trigger would be meaningless (that day was
    -- never real). Fire once, a fixed 5 days before the month starts,
    -- giving the same kind of advance notice without claiming precision
    -- that doesn't exist. Every other precision keeps the original
    -- days-before-the-anchor trigger -- the anchor IS a real target day
    -- for those, just not a guaranteed-certain one.
    if occasion_row.date_precision = 'flexible' then
      v_trigger_today := current_date = (date_trunc('month', v_next_date)::date - 5);
    else
      v_trigger_today := (v_next_date - current_date) = v_lead_days;
    end if;

    if not v_trigger_today then
      continue;
    end if;

    -- Already turned into a real plan for this upcoming date -- don't nag
    -- about something the user already handled. See this migration's own
    -- header comment for why ~350 days is an honest approximation, not an
    -- exact per-year-instance check this table has no way to make.
    if occasion_row.resulting_plan_id is not null
       and occasion_row.last_planned_at is not null
       and occasion_row.last_planned_at > (v_next_date - interval '350 days') then
      continue;
    end if;

    if not coalesce((select notify_social from profiles where id = occasion_row.user_id), true) then
      continue;
    end if;

    v_body_suffix := case occasion_row.occasion_type when 'anniversary' then 'together?' else '?' end;
    v_date_text := to_char(v_next_date, 'FMMonth FMDD');

    v_push_body := case occasion_row.date_precision
      when 'weekend' then occasion_row.title || ' is coming up the weekend of ' || v_date_text || '. Plan something' || v_body_suffix
      when 'around' then occasion_row.title || ' is coming up around ' || v_date_text || '. Plan something' || v_body_suffix
      when 'flexible' then occasion_row.title || ' is coming up sometime ' || to_char(v_next_date, 'FMMonth') || '. Plan ahead' || v_body_suffix
      else occasion_row.title || ' is in ' || v_lead_days || ' days. Plan something' || v_body_suffix
    end;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', occasion_row.user_id,
        'title', _occasion_emoji(occasion_row.occasion_type) || ' Upcoming ' || _occasion_noun(occasion_row.occasion_type),
        'body', v_push_body,
        'data', jsonb_build_object(
          'type', 'occasion_upcoming',
          'occasion_id', occasion_row.id,
          'occasion_type', occasion_row.occasion_type,
          'occasion_title', occasion_row.title,
          'who_for_name', occasion_row.who_for_name,
          'who_for_friend_id', occasion_row.who_for_friend_id
        )
      )
    );
  end loop;
end;
$function$;

-- Already revoked from `authenticated` by a prior fix (Items 62/63's own
-- "a cron-only mass-push function left callable by any signed-in user"
-- lesson) -- CREATE OR REPLACE preserves an existing function's ACL, but
-- naming it here explicitly too so this migration is self-documenting
-- rather than relying on that not being reset.
revoke all on function public.send_occasion_planning_nudges() from public, anon, authenticated;
