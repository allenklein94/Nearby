-- Owner item 188 (2026-10-04, LOCKED, option 1: declared fact only). A host can say "Ticket needed, bought separately".
-- Informational only: Nearby sells nothing, collects no money, links to no seller and holds no ticket inventory. Nothing
-- else reads this column: joining, capacity, the waitlist, ranking, routing, recommendations and business matching are
-- unchanged (guard: src/utils/ticketRequired.test.js). Hosts write their own row through the existing gatherings RLS
-- insert/update policies, like equipment_provided; no new function. Default false = the host did not say a ticket is needed.
alter table public.gatherings add column if not exists ticket_required boolean not null default false;
