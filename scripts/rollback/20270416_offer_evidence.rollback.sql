-- Rollback of 20270416 (offer evidence + admin offer history). Drops what it added; no other row is touched. Kept evidence rows
-- are DELETED with their table: run only on an owner decision, after checking private.offer_evidence is empty or exported.
select cron.unschedule('purge-offer-evidence') where exists (select 1 from cron.job where jobname = 'purge-offer-evidence');
drop trigger if exists keep_offer_evidence on public.business_request_offers;
drop function if exists public.admin_business_offer_history(uuid, integer);
drop function if exists private.purge_offer_evidence();
drop function if exists private._keep_offer_evidence();
drop function if exists private.offer_evidence_reasons(uuid, uuid);
drop table if exists private.offer_evidence_purge_log;
drop table if exists private.offer_evidence_failures;
drop table if exists private.offer_evidence;
