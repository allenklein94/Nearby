-- Live verification for 20270320 + 20270324 + 20270325 (item 146, its Option A pin, place counts dropped; Management API). Read-only. Expected one row:
--   anon_table / auth_table = false; unreadable_anon = unreadable_auth = {precise_lat,precise_lng};
--   private_usage / secret / pin_fn = false; old_pin_fn = false (per-gathering pin dropped); count_single = false; count_batch = false;
--   one overload each of the two RPCs.
-- The per-role probes (direct read, select *, whole row, filter, lookup, RPC oracles) are journey `preciseLocation`.
select
  has_table_privilege('anon', 'public.gatherings', 'SELECT') anon_table,
  has_table_privilege('authenticated', 'public.gatherings', 'SELECT') auth_table,
  (select array_agg(attname::text order by attname) from pg_attribute where attrelid = 'public.gatherings'::regclass and attnum > 0
     and not attisdropped and not has_column_privilege('anon', 'public.gatherings', attname, 'SELECT')) unreadable_anon,
  (select array_agg(attname::text order by attname) from pg_attribute where attrelid = 'public.gatherings'::regclass and attnum > 0
     and not attisdropped and not has_column_privilege('authenticated', 'public.gatherings', attname, 'SELECT')) unreadable_auth,
  has_schema_privilege('authenticated', 'private', 'USAGE') or has_schema_privilege('anon', 'private', 'USAGE') private_usage,
  has_table_privilege('authenticated', 'private.pin_secret', 'SELECT') or has_table_privilege('anon', 'private.pin_secret', 'SELECT') secret,
  has_function_privilege('authenticated', 'private.gathering_location_pin(uuid, uuid, double precision, double precision)', 'execute') pin_fn,
  exists (select 1 from pg_proc where proname = 'gathering_pin' and pronamespace = 'private'::regnamespace) old_pin_fn,
  exists (select 1 from pg_proc where proname = 'count_gatherings_near' and pronamespace = 'public'::regnamespace) count_single,
  exists (select 1 from pg_proc where proname = 'count_gatherings_near_batch' and pronamespace = 'public'::regnamespace) count_batch,
  (select jsonb_object_agg(proname, n) from (select proname, count(*) n from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('get_gathering_distances', 'get_bounded_nearby_gathering_ids') group by 1) o) overloads;
