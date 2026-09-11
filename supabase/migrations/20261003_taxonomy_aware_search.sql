-- Taxonomy audit reply (CLAUDE.md, "Categories are actually a major
-- strategic issue," P1 item 15). The audit found one genuine engine-level
-- gap in an otherwise already-unified taxonomy (gatherings/communities/
-- business profiles/intent resolver/matching/personalization/
-- recommendations all verified live to already share the same
-- CATEGORY_GROUPS vocabulary, src/constants/gatheringCategories.js):
-- Search never referenced it at all. searchGatherings()/
-- searchPublicCommunities() (src/services/gatherings.js,
-- src/services/communities.js) were fixed client-side in this same pass
-- to also ILIKE interest_tag, exactly like their existing title/
-- description ILIKE queries. search_offer_ids() is the one search path
-- that's server-side (a SECURITY DEFINER RPC, src/services/brandOffers.js's
-- searchOffers()), so it needs its own migration.
--
-- Same real, disclosed indexing precedent this repo already established
-- for exactly this shape of ILIKE search (20260809_indexed_text_search.sql,
-- trigram GIN indexes on gatherings.title/description and
-- communities.name/description): interest_tag/target_interest_tag get the
-- same treatment, for the same reason -- ILIKE '%term%' is not a prefix
-- match, so a plain btree index wouldn't help it, and this repo's own
-- production row counts are still small enough that the planner will
-- correctly prefer a seq scan today regardless (same caveat that
-- migration's own header already disclosed) -- the index still needs to
-- exist now so the query is genuinely indexed once the table grows.

create index if not exists gatherings_interest_tag_trgm_idx
  on gatherings using gin (interest_tag gin_trgm_ops);
create index if not exists communities_interest_tag_trgm_idx
  on communities using gin (interest_tag gin_trgm_ops);
create index if not exists brand_offers_target_interest_tag_trgm_idx
  on brand_offers using gin (target_interest_tag gin_trgm_ops);

-- Same signature (query_text text) as the live function -- CREATE OR
-- REPLACE, not a new overload (this repo's own standing "check
-- pg_get_function_identity_arguments after any signature-adjacent change"
-- convention doesn't apply here since the argument list is genuinely
-- unchanged, only the body). Every existing line unchanged; only the new
-- `or o.target_interest_tag ilike ...` clause is added.
create or replace function public.search_offer_ids(query_text text)
 returns table(id uuid)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select o.id
  from brand_offers o
  left join brand_partners p on p.id = o.partner_id
  where o.active = true
    and o.gathering_id is null
    and (o.expires_at is null or o.expires_at > now())
    and (
      o.title ilike '%' || query_text || '%'
      or o.description ilike '%' || query_text || '%'
      or p.name ilike '%' || query_text || '%'
      or o.target_interest_tag ilike '%' || query_text || '%'
    );
$function$;
