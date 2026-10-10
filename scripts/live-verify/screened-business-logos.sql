-- get_screened_business_logos: an offer surface sees a logo only when its image was classified and approved.
-- Since 20270288 a logo must also be a file Nearby stores in business-logos/<partner>/ (external URLs are never shown).
-- Rolled back. Uses the first active business; acts as an authenticated user via request.jwt.claims.
begin;
create temp table results (step text, ok boolean) on commit drop;
grant all on results to authenticated;

create or replace function pg_temp.u(f text) returns text language sql as $$ select 'https://enmosvippabmuqslzrox.supabase.co/storage/v1/object/public/business-logos/' || (select id from brand_partners where active order by created_at limit 1)::text || '/' || f $$;

do $$
declare
  p uuid := (select id from brand_partners where active order by created_at limit 1);
  u uuid := (select id from profiles order by created_at limit 1);
begin
  delete from business_content_screening_results where partner_id = p and target_type = 'business_profile';
  perform set_config('app.trusted_update', 'true', true);
  update brand_partners set logo_url = null where id = p;
end $$;

create or replace function pg_temp.logo_seen() returns text language plpgsql as $$
declare r text; p uuid := (select id from brand_partners where active order by created_at limit 1);
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from profiles order by created_at limit 1)::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select logo_url into r from get_screened_business_logos(array[p]);
  reset role;
  return r;
end $$;

create or replace function pg_temp.screen(url text, screened boolean, tier text, outcome text, at timestamptz) returns void language sql as $$
  insert into business_content_screening_results (partner_id, target_type, content_snapshot, risk_tier, review_outcome, created_at)
  values ((select id from brand_partners where active order by created_at limit 1), 'business_profile',
          jsonb_build_object('logoUrl', url, 'logoScreened', screened), tier, outcome, at);
$$;
create or replace function pg_temp.set_logo(url text) returns void language plpgsql as $$
begin
  perform set_config('app.trusted_update', 'true', true);
  update brand_partners set logo_url = url where id = (select id from brand_partners where active order by created_at limit 1);
end $$;

-- 1 missing: no logo at all
insert into results values ('missing logo -> none', pg_temp.logo_seen() is null);
-- 2 written without screening (direct RPC bypass)
select pg_temp.set_logo(pg_temp.u('a.png'));
insert into results values ('unscreened logo -> none', pg_temp.logo_seen() is null);
-- 3 a text-only edit carried the same URL without classifying it
select pg_temp.screen(pg_temp.u('a.png'), false, 'low', null, now() - interval '5 min');
insert into results values ('text-only row does not count -> none', pg_temp.logo_seen() is null);
-- 4 classified, pending review (medium)
select pg_temp.screen(pg_temp.u('a.png'), true, 'medium', null, now() - interval '4 min');
insert into results values ('pending (medium) -> none', pg_temp.logo_seen() is null);
-- 5 classified uncertain
select pg_temp.screen(pg_temp.u('a.png'), true, 'uncertain', null, now() - interval '3 min 30 s');
insert into results values ('pending (uncertain) -> none', pg_temp.logo_seen() is null);
-- 6 reviewer approved
select pg_temp.screen(pg_temp.u('a.png'), true, 'medium', 'approved', now() - interval '3 min');
insert into results values ('reviewer approved -> shown', pg_temp.logo_seen() = pg_temp.u('a.png'));
-- 7 a later classification of the same URL was denied: the latest wins
select pg_temp.screen(pg_temp.u('a.png'), true, 'medium', 'denied', now() - interval '2 min');
insert into results values ('later denial -> none', pg_temp.logo_seen() is null);
-- 8 auto-blocked
select pg_temp.screen(pg_temp.u('a.png'), true, 'high', 'auto_blocked', now() - interval '90 s');
insert into results values ('auto_blocked -> none', pg_temp.logo_seen() is null);
-- 9 classified low on a different URL; current logo b is approved
select pg_temp.set_logo(pg_temp.u('b.png'));
select pg_temp.screen(pg_temp.u('b.png'), true, 'low', null, now() - interval '60 s');
insert into results values ('approved low -> shown', pg_temp.logo_seen() = pg_temp.u('b.png'));
-- 10 the owner swaps back to the blocked logo a without screening
select pg_temp.set_logo(pg_temp.u('a.png'));
insert into results values ('switch back to a blocked logo -> none', pg_temp.logo_seen() is null);
-- 11 anon cannot call it
insert into results values ('anon cannot execute', not has_function_privilege('anon', 'public.get_screened_business_logos(uuid[])', 'execute'));
-- 12 single overload
insert into results values ('single overload', (select count(*) from pg_proc where proname = 'get_screened_business_logos') = 1);

select step, ok from results;
select case when bool_and(ok) then 'ALL OK' else 'FAILED' end as verdict from results;
rollback;
