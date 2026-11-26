-- Gathering ratings are private to the person who wrote them (owner, 2026-11-09). Staged; own deploy approval; deploy after 20270407,
-- once a released build no longer reads other people's rows (a build up to 87 keeps working but its "What people loved" and business
-- rating lines then read only the viewer's own rating).
--
-- Today any signed-in person can read every row, with its reviewer_id, through the API. After this:
--   - a signed-in person reads only their own rows (what saving a rating and "have I rated this?" need);
--   - hosts, businesses and everyone else read none, directly or by embedding the table from gatherings;
--   - signed-out callers lose the table grant they could never use (no policy ever gave them a row);
--   - get_my_experience_feedback and get_my_plans_this_month keep working: they are security definer and read only the caller's rows;
--   - the service role (server-side moderation) is unchanged. No row is changed or deleted.
-- Row security, not a column grant, on purpose: builds up to 87 save with upsert, and Postgres needs SELECT on every column an
-- ON CONFLICT DO UPDATE reads, so hiding the columns would break "How was it?" on those builds.
drop policy if exists "Anyone can view feedback" on public.gathering_feedback;
drop policy if exists "People can read their own feedback" on public.gathering_feedback;
create policy "People can read their own feedback"
  on public.gathering_feedback
  as permissive
  for select
  to authenticated
  using (reviewer_id = auth.uid());

revoke select on public.gathering_feedback from anon;
