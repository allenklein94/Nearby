-- Place-count oracle removed (owner, 2026-10-17: Option A, final; PRODUCT_AUDIT/PLACE_COUNT_ORACLE_SCOPE_2026-10-17.md).
-- count_gatherings_near_batch counted public, discoverable future gatherings in a ±0.001 deg box around up to 20 caller-chosen
-- points, on the PRECISE point: a grid scan located such a gathering to ~110 m, which item 146 otherwise keeps to the host and
-- approved attendees. A truthful "gathering here" is the venue itself, so no counting form is safe: the function is dropped and
-- the Places "N gatherings here" line is gone. Revises item 146's compatibility change 3 (its section 4 of migration 20270320).
-- Nothing replaces it (no pin counts, place ids or rate-limited variant). Every other item 146 / 148 protection is unchanged.
drop function if exists public.count_gatherings_near_batch(double precision[], double precision[]);
drop function if exists public.count_gatherings_near(double precision, double precision);
