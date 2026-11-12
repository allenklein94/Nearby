-- Rollback of 20270416 (offer evidence + admin offer history). Drops what it added; no other row is touched. Kept evidence rows
-- are DELETED with their table.
-- MANDATORY PRE-ROLLBACK SAFEGUARD (owner, 2026-11-12): first inspect the table, read-only:
--   select count(*) from private.offer_evidence;
-- If it holds any row, this rollback REFUSES (below) unless the owner has separately approved it AND a preservation / export
-- of those rows has been made and verified (row count + offer ids match). Only then set, in the same transaction:
--   set local nearby.offer_evidence_rollback_approved = '<owner approval reference>';
-- Never set it to get past the check without that approval and the verified export.
do $$
begin
  if to_regclass('private.offer_evidence') is not null
     and exists (select 1 from private.offer_evidence)
     and coalesce(current_setting('nearby.offer_evidence_rollback_approved', true), '') = '' then
    raise exception 'offer evidence present: rollback refused'
      using hint = 'evidence_present: inspect private.offer_evidence, get the owner''s separate approval + a verified export, then set nearby.offer_evidence_rollback_approved';
  end if;
end $$;
select cron.unschedule('purge-offer-evidence') where exists (select 1 from cron.job where jobname = 'purge-offer-evidence');
drop trigger if exists keep_offer_evidence on public.business_request_offers;
drop trigger if exists keep_partner_offer_evidence on public.brand_partners;
drop function if exists public.admin_business_offer_history(uuid, integer);
drop function if exists private.purge_offer_evidence();
drop function if exists private._keep_offer_evidence();
drop function if exists private._keep_partner_offer_evidence();
drop function if exists private.keep_offer_evidence(public.business_request_offers);
drop function if exists private.offer_evidence_reasons(uuid, uuid);
drop table if exists private.offer_evidence_purge_log;
drop table if exists private.offer_evidence_failures;
drop table if exists private.offer_evidence;
