-- Crossed Paths sighting push notification (CLAUDE.md "IN PROGRESS" item, started
-- 2026-09-10, resumed and completed 2026-09-11). Item 12 of the Sep 6 2026
-- external UX critique asked for real push copy ("we'll let you know when you
-- cross paths with someone") -- as of this migration, no push was ever sent
-- for a sighting; report-presence silently upserted into `sightings` and
-- stopped there.
--
-- Design, re-derived this session by reading the real deployed report-presence
-- Edge Function body fresh via the Management API (not assumed from the paused
-- session's notes) plus the live `sightings` schema/constraints:
--   - report-presence upserts one row per (user_a, user_b) pair into
--     `sightings`, unique on (user_a, user_b) (sightings_user_a_user_b_key).
--     Blocking is already checked (via is_blocked) before that upsert, so a
--     sightings row between blocked users is never created -- no need to
--     re-check blocking here.
--   - The upsert's object only ever sets user_a/user_b/approx_area/
--     last_seen_at/expires_at -- first_seen_at (default now()) is never
--     touched again after the row's first insert. Combined with the
--     UNIQUE(user_a, user_b) constraint, a given pair can only ever fire a
--     genuine INSERT once (until/unless the row is later removed by
--     purge_expired_sightings(), which is not on any cron schedule --
--     confirmed via `select * from cron.job` against production). An
--     AFTER INSERT ONLY trigger therefore already gives the real dedup this
--     needs for free: every subsequent re-sighting of the same pair is an
--     UPDATE, which this trigger never fires on -- no extra "notified_at"
--     column or dedup key needed.
--   - Preference gate follows the exact same shape as every other category in
--     20260913_v5_notification_taxonomy.sql (a plain profiles boolean,
--     checked with coalesce(..., true) before the push). There is no separate
--     "quiet hours" mechanism anywhere in this codebase to reuse or duplicate
--     (confirmed by grep across src/ and supabase/migrations/ for quiet_hours/
--     quietHours/do_not_disturb/dnd -- none exists; the resume plan's
--     question about whether one existed is now answered). Crossed Paths is
--     its own genuine category (a proximity event, not a relationship-state
--     change like a match/friend-request/message), so it gets its own new
--     notify_crossed_paths column and its own Settings row, rather than being
--     folded into an unrelated existing toggle (notify_things_to_do is about
--     nearby businesses/gatherings, not a person you crossed paths with).
--   - Both users in the pair get their own independently-gated push (same
--     dual-notify shape as check_mutual_notice for a dating match), each
--     naming the OTHER person and carrying that other person's id for a
--     deep link to their profile -- the same real destination the existing
--     Crossed Paths Discover surfaces already open on a tap (see CLAUDE.md,
--     "Unified Crossed Paths across Dating and Friends").
--
-- Deliberately NOT done: re-deriving Dating/Friends discovery-pool
-- eligibility (gender/age matching, open_to_friend_discovery) inside this
-- trigger to further gate who gets notified. That logic already lives
-- client-side in getNearbyMatches()/getFriendCrossedPaths() for the in-app
-- Discover surfaces; duplicating it here would be a second, drifting copy of
-- it for little real benefit. The per-user notify_crossed_paths toggle is the
-- intended, precedented control surface (same as every other category), not
-- a silent re-derivation of eligibility.

alter table profiles
  add column if not exists notify_crossed_paths boolean not null default true;

create or replace function public.notify_sighting_crossed_paths()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  service_key text;
  name_a text;
  name_b text;
  a_wants_notif boolean;
  b_wants_notif boolean;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into name_a from profiles where id = new.user_a;
  select display_name into name_b from profiles where id = new.user_b;

  select coalesce(notify_crossed_paths, true) into a_wants_notif from profiles where id = new.user_a;
  select coalesce(notify_crossed_paths, true) into b_wants_notif from profiles where id = new.user_b;

  if a_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', new.user_a,
        'title', 'You crossed paths! 👋',
        'body', 'You and ' || coalesce(name_b, 'someone nearby') || ' were near each other just now.',
        'data', jsonb_build_object('type', 'crossed_paths_sighting', 'other_user_id', new.user_b)
      )
    );
  end if;

  if b_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', new.user_b,
        'title', 'You crossed paths! 👋',
        'body', 'You and ' || coalesce(name_a, 'someone nearby') || ' were near each other just now.',
        'data', jsonb_build_object('type', 'crossed_paths_sighting', 'other_user_id', new.user_a)
      )
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists on_sighting_created on sightings;
create trigger on_sighting_created
  after insert on sightings
  for each row execute function public.notify_sighting_crossed_paths();
