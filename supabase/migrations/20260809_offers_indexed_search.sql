-- Closes the second half of CLAUDE.md's item 5 ("non-indexed offers search"),
-- deliberately left out of 20260809_indexed_text_search.sql because it needs
-- more than an index: DiscoverHubScreen's Perks search matches
-- brand_offers.title/description AND brand_partners.name (a joined table),
-- which PostgREST's .or() can't express as a single cross-table request —
-- unlike gatherings/communities, this genuinely needs a real Postgres
-- function, not just a client-side .ilike() call.

-- pg_trgm was already enabled by 20260809_indexed_text_search.sql; repeated
-- here with if not exists so this migration is self-contained and safe to
-- replay in any order relative to that one.
create extension if not exists pg_trgm;

create index if not exists brand_offers_title_trgm_idx
  on brand_offers using gin (title gin_trgm_ops);
create index if not exists brand_offers_description_trgm_idx
  on brand_offers using gin (description gin_trgm_ops);
create index if not exists brand_partners_name_trgm_idx
  on brand_partners using gin (name gin_trgm_ops);

-- Mirrors get_nearby_offer_ids' own join shape (brand_offers left joined to
-- brand_partners on partner_id) and getActiveOffers()'s exact base filter
-- (active offer, not gathering-attached, not expired) so a search result can
-- never surface an offer plain browse would have excluded — same "search
-- reuses the browse filter" convention searchGatherings()/
-- searchPublicCommunities() already established. query_text is expected to
-- already have ILIKE's own %/_ wildcards escaped by the caller (same
-- convention those two functions' client-side callers use), not escaped
-- here, so this stays a plain parameterized query with no string-building.
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
    );
$function$;

revoke all on function public.search_offer_ids(text) from public, anon;
grant execute on function public.search_offer_ids(text) to authenticated;
