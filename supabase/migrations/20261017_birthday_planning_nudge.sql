-- "Birthday reminders as a recurring retention mechanism" (CLAUDE.md,
-- direct user follow-up to Item 61). The real advance-notice signal this
-- needed already existed as a pull-only Home dashboard card
-- (get_upcoming_connected_birthdays(), "The Plan Engine" Phase 1, Aug 23
-- 2026 -- its own header comment already named exactly this: "there's
-- still real time to plan something... Home can surface it days ahead")
-- but was never turned into a push. send_birthday_reminders() (baseline)
-- is a different, narrower thing: it fires only on the actual day, with
-- no "plan something" framing and no deep link past a bare profile --
-- left completely untouched by this migration, same as the Aug 23 2026
-- migration's own explicit non-goal.
--
-- This is a NEW push, exactly seven days before a real birthday --
-- once per person per year, not a growing countdown of daily nags. Two
-- real sources, both real per-user facts, never fabricated:
--   1. A connected Nearby friend/match's own real profiles.birthdate,
--      same connected-set scoping (accepted friendships UNION matches)
--      and per-recipient-timezone date math send_birthday_reminders()
--      already established -- re-derived here rather than calling
--      get_upcoming_connected_birthdays() itself, since that RPC is
--      caller-scoped (auth.uid()) and this cron has no calling user.
--   2. A real, self-logged occasions row of type 'birthday' -- covers
--      exactly the case source 1 cannot: a real person who isn't a
--      Nearby user at all (a mother, say -- Item 61 follow-up, CLAUDE.md,
--      "don't require the celebrated person to be a Nearby user"). Same
--      per-occasion "next real date" math get_upcoming_occasions()
--      already established (Phase H, Sep 14 2026), re-derived here for
--      the identical caller-scoping reason.
--
-- Both gate on the recipient's own real notify_social preference (Social
-- already covers friends/dating/messages/waves per Item 29's category
-- taxonomy -- a birthday reminder about a real relationship or a real
-- self-logged personal date fits that bucket, not Discovery/Planning/
-- Business/Community/Proximity). The push's own data payload carries
-- everything the client needs to deep-link straight into the Celebrate
-- Something wizard's "What would you like to do?" step (notifications.js,
-- type 'birthday_upcoming') -- a real, non-arbitrary reason to open the
-- app, never a generic engagement ping.
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
  occasion_row record;
  v_today_in_their_tz date;
  v_next_bday date;
  v_next_date date;
  v_year int;
  v_month int;
  v_day int;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  -- Source 1: a connected friend/match's real profiles.birthdate.
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
      -- A Feb 29 birthdate in a non-leap current year -- same honest
      -- Feb 28 approximation send_birthday_reminders() already uses.
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

  -- Source 2: a real, self-logged occasions row of type 'birthday' --
  -- the owner is the recipient (reminding themselves), not a connection.
  for occasion_row in
    select id, user_id, title, occasion_date, recurs_annually from occasions where occasion_type = 'birthday'
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

    if (v_next_date - current_date) = v_lead_days then
      if coalesce((select notify_social from profiles where id = occasion_row.user_id), true) then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', occasion_row.user_id,
            'title', '🎂 Upcoming Birthday',
            'body', occasion_row.title || ' is in ' || v_lead_days || ' days. Plan something?',
            'data', jsonb_build_object(
              'type', 'birthday_upcoming',
              'occasion_id', occasion_row.id,
              'occasion_title', occasion_row.title
            )
          )
        );
      end if;
    end if;
  end loop;
end;
$function$;

revoke all on function public.send_birthday_planning_nudges() from public, anon;

select cron.schedule('send-birthday-planning-nudges', '0 9 * * *', 'select send_birthday_planning_nudges();');
