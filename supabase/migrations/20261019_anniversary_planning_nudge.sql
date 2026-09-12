-- "Anniversaries could work the same way" (CLAUDE.md, direct follow-up to
-- the birthday planning nudge, send_birthday_planning_nudges()). Same real
-- mechanism, different real source and lead time: a birthday has a real
-- structural "connected Nearby user's own profiles.birthdate" source;
-- anniversary has no equivalent column anywhere in this schema (an
-- anniversary is a couple's shared date, not one person's own attribute),
-- so the ONLY real source here is a self-logged occasions row of type
-- 'anniversary' -- covers both a connected Nearby partner and someone who
-- isn't one at all, same as birthday's own self-logged path.
--
-- Lead time is 14 days, not birthday's 7 -- per the user's own example
-- ("Your anniversary is coming up in 14 days"), and a reasonable real
-- distinction: an anniversary dinner reservation genuinely benefits from
-- more advance notice than a birthday does.
--
-- occasions.connected_user_id (set only when the wizard's own "save to
-- calendar" step attached a real, explicitly-picked connected friend/match
-- -- see shouldOfferCalendarSave()'s own header comment in
-- celebrateSomething.js) is read here and, when present, carried in the
-- push payload alongside the connected partner's own real display_name --
-- lets the client deep-link straight past the wizard's "who's this for"
-- step the same rich way a connected friend's birthday already does,
-- rather than asking the user to re-type a name Nearby already has. When
-- absent (a manually-logged anniversary with no connected partner picked,
-- or one logged for a partner who isn't a Nearby user at all), the payload
-- carries no such id -- the client falls back to asking, same as
-- birthday's own self-logged-with-no-extractable-name fallback.
--
-- Gates on the recipient's own real notify_social preference (Item 29's
-- category taxonomy -- a reminder about a real personal relationship
-- fits Social, same bucket the birthday nudge already uses).
create or replace function public.send_anniversary_planning_nudges()
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  service_key text;
  v_lead_days constant int := 14;
  occasion_row record;
  v_next_date date;
  v_year int;
  v_month int;
  v_day int;
  v_connected_name text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for occasion_row in
    select id, user_id, title, occasion_date, recurs_annually, connected_user_id
    from occasions where occasion_type = 'anniversary'
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
        v_connected_name := null;
        if occasion_row.connected_user_id is not null then
          select display_name into v_connected_name from profiles where id = occasion_row.connected_user_id;
        end if;

        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', occasion_row.user_id,
            'title', '💑 Upcoming Anniversary',
            'body', occasion_row.title || ' is in ' || v_lead_days || ' days. Plan something together?',
            'data', jsonb_build_object(
              'type', 'anniversary_upcoming',
              'occasion_id', occasion_row.id,
              'occasion_title', occasion_row.title,
              'connected_user_id', occasion_row.connected_user_id,
              'connected_display_name', v_connected_name
            )
          )
        );
      end if;
    end if;
  end loop;
end;
$function$;

revoke all on function public.send_anniversary_planning_nudges() from public, anon;

select cron.schedule('send-anniversary-planning-nudges', '0 9 * * *', 'select send_anniversary_planning_nudges();');
