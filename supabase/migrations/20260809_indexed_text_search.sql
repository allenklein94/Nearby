-- Closes the "client-side non-indexed search" P1 item from the Aug 9 2026
-- post-refresh hardening pass (see CLAUDE.md). DiscoverHubScreen's unified
-- search previously downloaded every future gathering / public community and
-- filtered them client-side with a plain lowercase .includes() substring
-- match. This adds real trigram (pg_trgm) GIN indexes on the exact columns
-- that match — title/description on gatherings, name/description on
-- communities — so the equivalent server-side `ILIKE '%term%'` query (now
-- issued from searchGatherings()/searchPublicCommunities() in
-- src/services/gatherings.js / communities.js) is genuinely indexed rather
-- than a sequential scan, once the tables are large enough for the planner
-- to prefer the index over a seq scan (at today's tiny production row
-- counts — 5 gatherings, 0 communities — Postgres will correctly choose a
-- seq scan regardless of the index existing; that's expected planner
-- behavior, not a sign the index isn't working).

create extension if not exists pg_trgm;

create index if not exists gatherings_title_trgm_idx
  on gatherings using gin (title gin_trgm_ops);
create index if not exists gatherings_description_trgm_idx
  on gatherings using gin (description gin_trgm_ops);

create index if not exists communities_name_trgm_idx
  on communities using gin (name gin_trgm_ops);
create index if not exists communities_description_trgm_idx
  on communities using gin (description gin_trgm_ops);
