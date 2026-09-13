-- Item 75 (CLAUDE.md, direct user request): "Connect occasions to the
-- user's calendar." Locked design: permission-driven (never blanket
-- access), read-only, and a hard structural distinction between private
-- calendar information and events the user is actually planning through
-- Nearby.
--
-- That distinction is enforced by NOT syncing any raw device-calendar data
-- to this database at all -- the device calendar is read entirely
-- on-device (src/services/deviceCalendar.js, via expo-calendar), and the
-- user's own selection of which calendars to share, plus which specific
-- events they've already acted on or dismissed, lives in AsyncStorage on
-- that device (calendar event ids are device-local identifiers with no
-- meaning on another device or on this server anyway). The ONLY moment
-- calendar-derived text ever reaches Nearby's servers is the existing,
-- already-real `occasions` table insert (services/occasions.js's
-- addOccasion()) -- and only when the user explicitly taps "Save as
-- Occasion" / "Plan Something" on a specific event they chose to act on.
-- At that point it's no longer "private calendar information" -- it's a
-- real, first-class Nearby Occasion the user deliberately created, exactly
-- like one typed by hand on OccasionsScreen's existing manual form.
--
-- This column is a pure, honest display marker distinguishing those two
-- provenances (so OccasionsScreen can show a small "📅 From your
-- calendar" badge) -- it carries no other behavior, and every existing
-- read path (getMyOccasions()'s `select('*')`, get_upcoming_occasions())
-- is unaffected: the former picks it up automatically, and the latter
-- (used for push logic / a connected friend's own view) doesn't need it
-- and is deliberately left untouched to avoid unnecessary risk to a
-- SECURITY DEFINER function's RETURNS TABLE column list.
alter table public.occasions
  add column if not exists imported_from_calendar boolean not null default false;

comment on column public.occasions.imported_from_calendar is
  'True only when this occasion was created via the on-device calendar-import flow (Item 75, CLAUDE.md) from an event the user explicitly chose to save/plan. Purely a provenance/display marker -- the calendar event''s own id is never stored here or anywhere server-side (it is device-local and meaningless elsewhere); on-device dedup of "already handled" events is tracked separately in AsyncStorage.';
