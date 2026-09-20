-- Capture production's column-level UPDATE grants for `authenticated` so a from-scratch replay matches prod.
--
-- Found by the 2026-09-20 replay-vs-prod comparison: production restricts signed-in UPDATE to a short list of
-- columns on these tables (identity / privileged columns are NOT updatable by clients), but no migration in the
-- folder ever issued those column-level grants, so a database rebuilt from migrations was WIDER (table-wide UPDATE
-- from Supabase's default grants). The column lists below were read from production's pg_attribute.attacl.
--
-- Idempotent and a no-op on production: table-level UPDATE is already absent there, and re-granting the same
-- columns yields the same ACL. Revoking table-level UPDATE also drops any column-level UPDATE, hence the
-- revoke-then-grant order. SELECT/INSERT/DELETE are untouched. RLS policies still apply on top.
--
-- Also captures the one anon difference on live_tracking_sessions: prod grants anon no SELECT there (the public
-- tracking page reads it through the SECURITY DEFINER get_live_tracking_session RPC, not the table).

revoke update on public.brand_offers from authenticated;
grant update (active) on public.brand_offers to authenticated;

revoke update on public.business_partner_requests from authenticated;
grant update (reviewed_at, status) on public.business_partner_requests to authenticated;

revoke update on public.communities from authenticated;
grant update (cover_photo_url, description, interest_tag, is_public, name) on public.communities to authenticated;

revoke update on public.gathering_interest from authenticated;
grant update (status) on public.gathering_interest to authenticated;

revoke update on public.id_verification_submissions from authenticated;
grant update (reviewed_at, reviewed_by, status) on public.id_verification_submissions to authenticated;

revoke update on public.live_tracking_sessions from authenticated;
grant update (active, current_lat, current_lng, updated_at) on public.live_tracking_sessions to authenticated;

revoke update on public.matches from authenticated;
grant update (disappearing_messages_enabled, disappearing_mode, first_message_sent) on public.matches to authenticated;

revoke update on public.message_reactions from authenticated;
grant update (emoji) on public.message_reactions to authenticated;

revoke update on public.profile_photos from authenticated;
grant update (photo_url, position) on public.profile_photos to authenticated;

revoke update on public.reports from authenticated;
grant update (resolved) on public.reports to authenticated;

revoke select on public.live_tracking_sessions from anon;
