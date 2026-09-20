-- Lock down anonymous access to gathering_interest.
--
-- Before: all three policies applied to role `public` and `anon` held every table privilege (SELECT, INSERT,
-- UPDATE, DELETE, TRUNCATE, ...), so an unauthenticated caller could read approved attendee rows (user ids +
-- join times) and RLS was the only thing standing between anon and writes (TRUNCATE ignores RLS entirely).
--
-- Now: the policies apply to `authenticated` only, so anon reads ZERO rows (not an error), and anon keeps only
-- SELECT. SELECT is kept on purpose: other tables' policies (storage objects, stories, chat, feedback, offers)
-- subquery this table, and dropping anon's SELECT would turn their empty result into "permission denied".
-- SECURITY DEFINER functions (join_gathering, get_public_gathering_invite_preview, the demand triggers) run as
-- their owner and are unaffected. Signed-in behavior is unchanged.

alter policy "Anyone can see approved attendees" on public.gathering_interest to authenticated;
alter policy "Users see own interest or gatherings they host" on public.gathering_interest to authenticated;
alter policy "Users can express interest, respecting women-only gatherings" on public.gathering_interest to authenticated;

revoke insert, update, delete, truncate, references, trigger on public.gathering_interest from anon;
