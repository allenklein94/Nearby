-- "Make Occasions proactive, not just user-created" (CLAUDE.md, direct
-- user follow-up to "Occasion architecture should not be a silo"). User's
-- own framing: "Nearby already knows you have an upcoming occasion because
-- you chose to save it... 🎂 Sarah's birthday is September 18. Want to
-- plan something?" -- and explicitly generalized past birthday/anniversary
-- ("Occasion -> Birthday -> Anniversary -> Graduation -> etc.").
--
-- send_birthday_planning_nudges() and send_anniversary_planning_nudges()
-- (20261017/20261019) already built exactly this mechanism, but as two
-- separate, occasion-type-specific functions -- and only for 2 of the 11
-- real values occasions.occasion_type actually allows
-- (20261016_celebrate_occasion_vocabulary_expansion.sql already widened
-- the column to also include graduation/milestone/life_event/baby_shower/
-- engagement/housewarming/promotion/farewell/other, but nothing ever
-- proactively nudged about those). This migration:
--
--   1. Consolidates every SELF-LOGGED occasions row (any of the 11 types)
--      into one new send_occasion_planning_nudges(), replacing the
--      duplicated self-logged-loop that used to live inside both
--      send_birthday_planning_nudges() and send_anniversary_planning_nudges().
--      A future occasion type added to the CHECK constraint now gets a
--      real proactive nudge automatically, without its own new migration.
--   2. send_birthday_planning_nudges() is trimmed down to ONLY its
--      structural Source 1 (a connected Nearby friend/match's own real
--      profiles.birthdate) -- the one source the new generic function
--      can't reach, since it has no occasions row behind it at all.
--   3. send_anniversary_planning_nudges() is fully retired (unscheduled +
--      dropped) -- it was 100% self-logged-occasion-based, now entirely
--      covered by the generic function.
--   4. Real, honest suppression: a recurring occasion (birthday/
--      anniversary) that was already turned into a real plan for its
--      current upcoming date (occasions.resulting_plan_id/last_planned_at,
--      added by "Occasion architecture should not be a silo") is skipped
--      -- don't nag about something the user already planned. The
--      ~350-day window is a deliberate approximation (this table has no
--      per-year-instance concept to check against precisely), not a
--      fabricated precise fact.
--
-- Lead time: 14 days for occasions that typically need more logistics/
-- coordination (anniversary, graduation, baby_shower, engagement,
-- housewarming -- the same reasoning the anniversary migration's own
-- comment already gave for its 14-day choice), 7 days for the rest
-- (birthday, milestone, promotion, farewell, life_event, other). A real
-- judgment call, not a measured fact -- disclosed as such.
--
-- Payload now carries who_for_name/who_for_friend_id (the structured
-- fields added by the prior migration) instead of birthday_upcoming's
-- narrower birthday_user_id/display_name or anniversary_upcoming's
-- connected_user_id/connected_display_name -- one consistent shape for
-- every occasion type, under a new push type, 'occasion_upcoming'.
-- notifications.js routes it generically rather than per-type.

create or replace function public.send_birthday_planning_nudges()
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  service_key text;
  v_lead_days constant int := 7;
  birthday_person record;
  connection record;
  v_today_in_their_tz date;
  v_next_bday date;
  v_year int;
  v_month int;
  v_day int;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  -- Source 1 only: a connected friend/match's real profiles.birthdate.
  -- Self-logged birthday occasions (a non-Nearby person, or a manual
  -- entry) are now covered by send_occasion_planning_nudges() below.
  for birthday_person in
    select id, display_name, birthdate, coalesce(timezone, 'UTC') as timezone from profiles
    where birthdate is not null
  loop
    begin
      v_today_in_their_tz := (now() at time zone birthday_person.timezone)::date;
    exception when others then
      v_today_in_their_tz := current_date;
    end;

    v_year := extract(year from v_today_in_their_tz)::int;
    v_month := extract(month from birthday_person.birthdate)::int;
    v_day := extract(day from birthday_person.birthdate)::int;

    begin
      v_next_bday := make_date(v_year, v_month, v_day);
    exception when others then
      v_next_bday := make_date(v_year, 2, 28);
    end;
    if v_next_bday < v_today_in_their_tz then
      begin
        v_next_bday := make_date(v_year + 1, v_month, v_day);
      exception when others then
        v_next_bday := make_date(v_year + 1, 2, 28);
      end;
    end if;

    if (v_next_bday - v_today_in_their_tz) = v_lead_days then
      for connection in
        select case when m.user_a = birthday_person.id then m.user_b else m.user_a end as connection_id
        from matches m
        where m.user_a = birthday_person.id or m.user_b = birthday_person.id
        union
        select case when f.user_a = birthday_person.id then f.user_b else f.user_a end as connection_id
        from friendships f
        where f.status = 'accepted' and (f.user_a = birthday_person.id or f.user_b = birthday_person.id)
      loop
        if coalesce((select notify_social from profiles where id = connection.connection_id), true) then
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', connection.connection_id,
              'title', '🎂 Upcoming Birthday',
              'body', coalesce(birthday_person.display_name, 'A connection') || '''s birthday is in ' || v_lead_days || ' days. Plan something?',
              'data', jsonb_build_object(
                'type', 'birthday_upcoming',
                'birthday_user_id', birthday_person.id,
                'display_name', birthday_person.display_name
              )
            )
          );
        end if;
      end loop;
    end if;
  end loop;
end;
$function$;

revoke all on function public.send_birthday_planning_nudges() from public, anon;

select cron.unschedule('send-anniversary-planning-nudges');
drop function if exists public.send_anniversary_planning_nudges();

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
  v_emoji text;
  v_noun text;
  v_body_suffix text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for occasion_row in
    select id, user_id, occasion_type, title, occasion_date, recurs_annually,
           who_for_name, who_for_friend_id, resulting_plan_id, last_planned_at
    from occasions
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

    if (v_next_date - current_date) <> v_lead_days then
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

    v_emoji := case occasion_row.occasion_type
      when 'birthday' then '🎂'
      when 'anniversary' then '💑'
      when 'graduation' then '🎓'
      when 'baby_shower' then '🍼'
      when 'engagement' then '💒'
      when 'housewarming' then '🏠'
      when 'promotion' then '📈'
      when 'farewell' then '👋'
      when 'milestone' then '🏆'
      when 'life_event' then '🌟'
      else '📅'
    end;
    v_noun := case occasion_row.occasion_type
      when 'birthday' then 'Birthday'
      when 'anniversary' then 'Anniversary'
      when 'graduation' then 'Graduation'
      when 'baby_shower' then 'Baby Shower'
      when 'engagement' then 'Engagement'
      when 'housewarming' then 'Housewarming'
      when 'promotion' then 'Promotion'
      when 'farewell' then 'Farewell'
      when 'milestone' then 'Milestone'
      when 'life_event' then 'Life Event'
      else 'Occasion'
    end;
    v_body_suffix := case occasion_row.occasion_type when 'anniversary' then 'together?' else '?' end;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', occasion_row.user_id,
        'title', v_emoji || ' Upcoming ' || v_noun,
        'body', occasion_row.title || ' is in ' || v_lead_days || ' days. Plan something' || v_body_suffix,
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

revoke all on function public.send_occasion_planning_nudges() from public, anon;

select cron.schedule('send-occasion-planning-nudges', '0 9 * * *', 'select send_occasion_planning_nudges();');
