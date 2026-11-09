-- Rollback for migration 20270408: back to 20270407's state, which reopens every rating to every signed-in person. No row was changed.
drop policy if exists "People can read their own feedback" on public.gathering_feedback;
create policy "Anyone can view feedback"
  on public.gathering_feedback
  as permissive
  for select
  to authenticated
  using (true);

grant select on public.gathering_feedback to anon;
