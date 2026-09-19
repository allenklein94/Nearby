-- _business_request_fanout is an internal helper called only by SECURITY DEFINER create_business_request* functions
-- (which run as the owner). It never had a revoke, so anon/authenticated could call it directly with any request id
-- and push-notify businesses. Clients get no access; the definer callers are unaffected.
revoke all on function public._business_request_fanout(uuid, double precision, double precision, double precision, text[], text) from public, anon, authenticated;
