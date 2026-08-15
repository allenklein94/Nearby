-- Real, previously-undetected production bug found while building the
-- Aug 15 2026 connectivity audit's §F fix (GroupPlanScreen realtime
-- subscription): the `supabase_realtime` publication only ever had
-- `messages` added to it (confirmed live via pg_publication_tables /
-- pg_publication -- puballtables is false, and no migration in this
-- repo's history ever ran an ALTER PUBLICATION ... ADD TABLE for any
-- table -- `messages` itself was added by hand, outside any migration,
-- at some point in this project's early history). Every *other* screen in
-- this codebase that subscribes to a real Supabase Realtime
-- `postgres_changes` channel -- gathering chat, community chat, business
-- conversation, message reactions, the relationship-tools collaborative
-- screens (Shared Decisions, Stress Test, Timeline Planner, Trip
-- Planning, Relationship Constitution, Shared Playlist, Memory Vault),
-- GatheringsScreen's live attendee-count subscription, and this same
-- pass's own new GroupPlanScreen channel -- has a client-side
-- subscription that has never actually been able to receive an event,
-- because Postgres's logical replication only streams changes for tables
-- genuinely included in the publication a slot subscribes to. CLAUDE.md's
-- own build history for several of these (e.g. the gathering/community/
-- business chat polling-to-realtime work) explicitly disclosed "not
-- verified: an actual live message arriving on a second device" as a
-- standing gap -- this is that gap's real root cause, not a coincidence.
--
-- Fix: add every table any real client channel subscribes to (grepped
-- exhaustively across src/ for `.channel(` + `postgres_changes` call
-- sites, not guessed) to the publication, `messages` included so a
-- from-scratch replay of this repo alone reproduces the real, currently-
-- live production state exactly rather than depending on a manual
-- dashboard step. Written as a conditional loop, not a bare `ALTER
-- PUBLICATION ... ADD TABLE` list, since Postgres 15 has no `ADD TABLE IF
-- NOT EXISTS` clause and `messages` is already a real member on
-- production -- a bare unconditional add would fail there with "table is
-- already a member of publication" on re-apply. Purely additive, safe
-- DDL otherwise -- no RLS/schema/client change needed; Realtime's own
-- postgres_changes delivery already respects each table's existing RLS
-- policies independently of this.
do $$
declare
  t text;
begin
  foreach t in array array[
    'messages', 'business_messages', 'community_messages', 'constitution_entries',
    'gathering_interest', 'gathering_messages', 'group_plan_offer_confirmations',
    'group_plan_participants', 'group_plan_proposals', 'memory_vault_items',
    'message_reactions', 'shared_decisions', 'shared_playlist_items',
    'stress_test_notes', 'timeline_notes', 'trip_ideas'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
