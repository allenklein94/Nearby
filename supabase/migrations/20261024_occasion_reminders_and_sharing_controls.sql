-- Items 62 & 63 (CLAUDE.md, direct user request): "Let users save important
-- dates for people" (grouped Occasions & Reminders per person, with strong
-- privacy controls) and "make the reminder useful immediately" (context
-- already populated when planning starts).
--
-- Real gap this closes: OccasionsScreen's manual "Add an occasion" form had
-- no way to name a person at all (who_for_name/who_for_friend_id, added by
-- 20261021_occasion_plan_linkage.sql, were only ever populated by the
-- CelebrateSomethingScreen wizard's own save-to-calendar step) -- so
-- grouping by person on that screen was previously impossible for anything
-- added there directly. That's a client-side fix (OccasionsScreen.js), not
-- a schema one.
--
-- What genuinely needs schema: "whether reminders are enabled" per the
-- user's own words means a per-occasion control, not just the existing
-- blanket notify_social category toggle (Settings) -- a new
-- reminder_enabled column, default true (matches this table's existing
-- default-on posture), checked by send_occasion_planning_nudges()
-- alongside the existing notify_social gate. Turning an individual
-- occasion's reminder off never deletes the record or affects any other
-- occasion or category.
--
-- "The user chooses what Nearby is allowed to remember... shouldn't imply
-- Nearby automatically knows sensitive information" is the other real
-- privacy control this item names -- occasions.connected_user_id already
-- exists and already grants the named person visibility into this record
-- via get_upcoming_occasions() (the original 20260914_occasions.sql design:
-- "optionally naming a real connected person it's shared with"), but every
-- real write path (celebrateSomething.js's 3 call sites) has always set it
-- unconditionally to whichever friend was picked for who_for_friend_id --
-- naming a friend for your own organizational/grouping purposes has always
-- silently also shared the record with them. That's a client-side fix too
-- (an explicit, separately-labeled "share this too" checkbox, default OFF,
-- in both CelebrateSomethingScreen.js and the new OccasionsScreen.js
-- person-picker) -- no schema change needed, since connected_user_id
-- already exists specifically to be set-or-not per this exact choice.

alter table public.occasions
  add column if not exists reminder_enabled boolean not null default true;

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
           who_for_name, who_for_friend_id, resulting_plan_id, last_planned_at,
           reminder_enabled
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

    if (v_next_date - current_date) <> v_lead_days then
      continue;
    end if;

    -- Already turned into a real plan for this upcoming date -- don't nag
    -- about something the user already handled. See the prior migration's
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

-- Real gap found while verifying this migration live: the prior migration
-- (20261022_occasion_planning_nudges_generalized.sql) revoked from public
-- and anon but not authenticated -- this repo's own standing "new function
-- defaults to PUBLIC execute" convention exists for exactly this reason.
-- A cron-only function with no auth.uid() check of its own (it iterates
-- every occasions row, not just the caller's) must never be callable by an
-- ordinary signed-in user -- that would let anyone trigger a mass push run
-- on demand. send_birthday_planning_nudges() has the same gap (same prior
-- migration) and is fixed here too, since it's the same family. Broader
-- cron-function grant audit beyond these two is a separate, larger task,
-- not done here.
revoke all on function public.send_occasion_planning_nudges() from public, anon, authenticated;
revoke all on function public.send_birthday_planning_nudges() from public, anon, authenticated;
