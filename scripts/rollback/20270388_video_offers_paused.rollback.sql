-- Rollback of 20270388 (video offers paused). Removes the enforcement: business videos are accepted again as before, so it is
-- only for a defect in the pause itself and never while outside businesses are onboarded without the owner's decision.
-- screen-business-content needs no change: it treats the missing function as "no early refusal" (PGRST202).
drop trigger if exists aa_business_video_paused on public.business_request_offers;
drop trigger if exists aa_business_video_paused on public.business_creatives;
drop trigger if exists aa_business_video_paused on public.business_experiences;
drop trigger if exists aa_business_video_paused on public.stories;
drop function if exists private._refuse_paused_business_video();
drop function if exists public.business_video_enabled();
drop table if exists private.business_video_settings;
