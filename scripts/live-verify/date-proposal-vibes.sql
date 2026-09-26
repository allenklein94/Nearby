-- Verifies migration 20270221 (date vibes travel with the plan). Rolled back; the result is reported through the exception text.
--  * a proposal stores exactly the vibes the proposer picked (distinct); none picked = none (never Romantic by default)
--  * a vibe outside the date vibes is refused; one overload; anon cannot execute
--  * accepted -> the auto request (same call the app makes, proposal.attributes) carries them; the business's opportunity
--    payload shows them as attributes and carries no match id, proposal, plan text, names or relationship words
begin;
do $v$
declare out text := ''; a uuid; b uuid; owner uuid; p uuid; m uuid; m2 uuid; res jsonb; prop record; req uuid; payload jsonb; s text;
begin
  select id into a from profiles order by id limit 1;
  select id into b from profiles where id <> a order by id limit 1;
  update brand_partners set active = false;  -- keep the fan-out quiet
  insert into matches (user_a, user_b) values (a, b) returning id into m;
  insert into matches (user_a, user_b) values (b, a) returning id into m2;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  res := propose_date(m, 'live-verify: dinner friday?', null, 'Foodie', array['romantic','quiet','romantic']);
  select * into prop from date_proposals where id = (res->>'proposalId')::uuid;
  out := out || 'stored: ' || array_to_string(array(select unnest(prop.attributes) order by 1), ',') || E'\n';
  res := propose_date(m2, 'live-verify: coffee?', null, 'Coffee');
  out := out || 'none picked: ' || coalesce(nullif(array_to_string((select attributes from date_proposals where id = (res->>'proposalId')::uuid), ','), ''), '(empty)') || E'\n';
  begin perform propose_date(m2, 'x', null, null, array['kid_friendly']); out := out || 'kid_friendly: NOT REFUSED' || E'\n';
  exception when others then out := out || 'non-date vibe refused: ok' || E'\n'; end;
  -- match b accepts; the app then asks businesses with proposal.attributes
  update date_proposals set status = 'accepted', responded_at = now() where id = prop.id;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  res := create_business_request_for_match(m, prop.plan_text, 33.0, -117.0, 'Foodie', null, null, null, null, 15, null, null, prop.attributes);
  req := (res->>'requestId')::uuid;
  out := out || 'request attributes: ' || array_to_string(array(select x from business_requests br, unnest(br.attributes) x where br.id = req order by 1), ',') || E'\n';
  -- a business that got this request
  select id into p from brand_partners limit 1;
  select id into owner from profiles where id not in (a, b) order by id limit 1;
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = p where id = owner;
  insert into business_request_offers (request_id, partner_id, status) values (req, p, 'pending');
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  payload := get_business_opportunities(p);
  s := payload::text;
  out := out || 'payload has romantic+quiet: ' || (s like '%romantic%' and s like '%quiet%')::text || E'\n';
  out := out || 'payload leaks: ' || concat_ws(',',
    case when s like '%' || m::text || '%' then 'match_id' end,
    case when s like '%' || prop.id::text || '%' then 'proposal_id' end,
    case when s like '%' || a::text || '%' or s like '%' || b::text || '%' then 'user_id' end,
    case when s ilike '%match_id%' then 'match_id key' end,
    case when s ilike '%live-verify: dinner%' then 'plan text' end,
    case when s ~* '"(dating|matched|relationship|partner_name_of_requester)' then 'relationship word' end,
    case when s ilike '%' || coalesce((select display_name from profiles where id = a), '§§') || '%' then 'proposer name' end,
    case when s ilike '%' || coalesce((select display_name from profiles where id = b), '§§') || '%' then 'accepter name' end) || E'\n';
  out := out || 'overloads: ' || (select count(*) from pg_proc where proname = 'propose_date') || E'\n';
  out := out || 'anon execute: ' || has_function_privilege('anon', 'public.propose_date(uuid, text, uuid, text, text[])', 'execute')::text || E'\n';
  raise exception '%', out;
end $v$;
rollback;
