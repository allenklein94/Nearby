-- Rollback of 20270399 (admin-controlled temporary restrictions). Every active restriction ends at once and the record goes with
-- its tables: copy private.account_restrictions + private.account_restriction_events out first if the record is needed.
-- Nothing else changes (no suspension, profile or content is touched by 20270399). Defect only; owner decides.
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'purge-ended-account-restrictions') then
    perform cron.unschedule('purge-ended-account-restrictions');
  end if;
end
$do$;

drop trigger if exists zz_refuse_restricted_messages on public.messages;
drop trigger if exists zz_refuse_restricted_messages on public.gathering_messages;
drop trigger if exists zz_refuse_restricted_messages on public.community_messages;
drop trigger if exists zz_refuse_restricted_messages on public.plan_messages;
drop trigger if exists zz_refuse_restricted_messages on public.business_messages;
drop trigger if exists zz_refuse_restricted_messages on public.photo_comments;
drop trigger if exists zz_refuse_restricted_messages on public.gathering_questions;
drop trigger if exists zz_refuse_restricted_invitations on public.social_invites;
drop trigger if exists zz_refuse_restricted_friend_requests on public.friendships;
drop trigger if exists zz_refuse_restricted_friend_requests on public.friend_discovery_swipes;
drop trigger if exists zz_refuse_restricted_friend_requests on public.notices;
drop trigger if exists zz_refuse_restricted_gatherings on public.gatherings;
drop trigger if exists zz_refuse_restricted_gatherings on public.communities;
drop trigger if exists zz_refuse_restricted_offers on public.business_request_offers;
drop trigger if exists zz_refuse_restricted_offers on public.business_availability;
drop trigger if exists zz_refuse_restricted_offers on public.brand_offers;
drop trigger if exists zz_refuse_restricted_offers on public.business_updates;
drop trigger if exists zz_refuse_restricted_links on public.profiles;
drop trigger if exists zz_refuse_restricted_links on public.gatherings;
drop trigger if exists zz_refuse_restricted_links on public.communities;
drop trigger if exists zz_refuse_restricted_links on public.gathering_questions;
drop trigger if exists zz_refuse_restricted_links on public.photo_comments;
drop trigger if exists zz_refuse_restricted_links on public.messages;
drop trigger if exists zz_refuse_restricted_links on public.gathering_messages;
drop trigger if exists zz_refuse_restricted_links on public.community_messages;
drop trigger if exists zz_refuse_restricted_links on public.plan_messages;
drop trigger if exists zz_refuse_restricted_links on public.business_messages;

drop function if exists public.admin_list_account_restrictions(uuid);
drop function if exists public.admin_lift_account_restriction(uuid, text);
drop function if exists public.admin_restrict_account(uuid, text[], int, text, uuid, uuid);
drop function if exists private.purge_ended_account_restrictions();
drop function if exists private._refuse_restricted_actor();
drop function if exists private.refuse_restricted(uuid, text);
drop function if exists private.account_restricted_until(uuid, text);

drop table if exists private.account_restriction_events;
drop table if exists private.account_restrictions;
drop function if exists private._account_restriction_events_append_only();
drop function if exists private._account_restrictions_guard();
