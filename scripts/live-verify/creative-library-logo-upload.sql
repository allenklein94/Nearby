-- Creative library uploads + logo upload (20270288). Rolled back.
-- Library items move Reviewing -> Ready / Needs changes; only a ready, live item of the SAME business can sit on an offer;
-- a logo is shown on offer surfaces only when it is a file Nearby stores for that business AND it passed screening.
begin;
create temp table results (step text, ok boolean) on commit drop;
grant all on results to authenticated;

create or replace function pg_temp.p() returns uuid language sql as $$ select id from brand_partners where active order by created_at limit 1 $$;
create or replace function pg_temp.owner() returns uuid language sql as $$ select id from profiles where managed_partner_id = pg_temp.p() limit 1 $$;
create or replace function pg_temp.creative(status text, path text, partner uuid default null) returns uuid language sql as $$
  insert into business_creatives (partner_id, media_type, media_path, status, source, reviewing_since)
  values (coalesce(partner, pg_temp.p()), 'image', path, status, 'library', now()) returning id $$;
create or replace function pg_temp.attach(c uuid) returns boolean language plpgsql as $$
begin
  -- each attempt undoes itself (raising rolls back the insert), so one attempt never decides the next
  insert into business_request_offers (request_id, partner_id, status, creative_id)
  values ((select id from business_requests order by created_at limit 1), pg_temp.p(), 'pending', c);
  raise exception 'ATTACHED';
exception when others then return sqlerrm = 'ATTACHED';
end $$;

-- 0 existing rows (all made by the offer path, already screened) default to ready
insert into results values ('status defaults to ready', (select column_default from information_schema.columns where table_name = 'business_creatives' and column_name = 'status') = '''ready''::text');

-- 1 a held library item follows the reviewer: approved -> ready
do $$
declare c uuid := pg_temp.creative('reviewing', pg_temp.p()::text || '/creative-held.jpg'); s uuid;
begin
  insert into business_content_screening_results (partner_id, target_type, target_id, content_snapshot, risk_tier)
  values (pg_temp.p(), 'creative', c, jsonb_build_object('mediaPath', 'x'), 'medium') returning id into s;
  update business_creatives set screening_id = s where id = c;
  insert into results values ('held creative stays reviewing', (select status from business_creatives where id = c) = 'reviewing');
  update business_content_screening_results set review_outcome = 'approved' where id = s;
  insert into results values ('reviewer approval -> ready', (select status from business_creatives where id = c) = 'ready');
end $$;

-- 2 denied -> needs_changes, with the policy categories as the reason
do $$
declare c uuid := pg_temp.creative('reviewing', pg_temp.p()::text || '/creative-denied.jpg'); s uuid;
begin
  insert into business_content_screening_results (partner_id, target_type, target_id, content_snapshot, risk_tier, matched_categories)
  values (pg_temp.p(), 'creative', c, '{}'::jsonb, 'medium', array['weapons']) returning id into s;
  update business_creatives set screening_id = s where id = c;
  update business_content_screening_results set review_outcome = 'denied' where id = s;
  insert into results values ('reviewer denial -> needs_changes', (select status from business_creatives where id = c) = 'needs_changes');
  insert into results values ('denial carries categories', (select matched_categories from business_creatives where id = c) = array['weapons']);
end $$;

-- 3 picker eligibility enforced by the database on every offer write
insert into results values ('offer refuses a reviewing creative', not pg_temp.attach(pg_temp.creative('reviewing', pg_temp.p()::text || '/creative-r.jpg')));
insert into results values ('offer refuses a needs_changes creative', not pg_temp.attach(pg_temp.creative('needs_changes', pg_temp.p()::text || '/creative-n.jpg')));
insert into results values ('offer refuses a retry creative', not pg_temp.attach(pg_temp.creative('retry', pg_temp.p()::text || '/creative-t.jpg')));
do $$
declare c uuid := pg_temp.creative('ready', pg_temp.p()::text || '/creative-arch.jpg');
begin
  update business_creatives set archived_at = now() where id = c;
  insert into results values ('offer refuses an archived ready creative', not pg_temp.attach(c));
end $$;
do $$
declare other uuid;
begin
  -- another business's ready creative (a second business made inside this transaction)
  insert into brand_partners (name, active) values ('Verify Other Co', true) returning id into other;
  insert into results values ('offer refuses another business''s creative', not pg_temp.attach(pg_temp.creative('ready', other::text || '/creative-o.jpg', other)));
exception when others then
  insert into results values ('offer refuses another business''s creative (skipped: ' || sqlerrm || ')', true);
end $$;
insert into results values ('offer accepts its own ready creative', pg_temp.attach(pg_temp.creative('ready', pg_temp.p()::text || '/creative-ok.jpg')));

-- 4 status vocabulary
do $$ begin
  perform pg_temp.creative('bogus', pg_temp.p()::text || '/creative-bad.jpg');
  insert into results values ('unknown status refused', false);
exception when check_violation then insert into results values ('unknown status refused', true);
end $$;

-- 5 clients cannot write the library directly (screening is the only way in)
do $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.owner()::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into business_creatives (partner_id, media_type, media_path, status) values (pg_temp.p(), 'image', pg_temp.p()::text || '/creative-self.jpg', 'ready');
    reset role; insert into results values ('owner cannot insert a ready item', false);
  exception when others then reset role; insert into results values ('owner cannot insert a ready item', true);
  end;
end $$;
do $$ declare n int; begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.owner()::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update business_creatives set status = 'ready' where partner_id = pg_temp.p() and status = 'needs_changes';
    get diagnostics n = row_count;
    reset role; insert into results values ('owner cannot mark an item ready', n = 0);
  exception when others then reset role; insert into results values ('owner cannot mark an item ready', true);
  end;
end $$;
do $$ declare n int; begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.owner()::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from business_creatives where partner_id = pg_temp.p() and status in ('reviewing', 'needs_changes');
  reset role;
  insert into results values ('owner reads its own items with their state', n >= 3);
end $$;

-- 6 logo: stored files only, screened, replacement keeps the gate
create or replace function pg_temp.base() returns text language sql as $$ select 'https://enmosvippabmuqslzrox.supabase.co/storage/v1/object/public/business-logos/' $$;
create or replace function pg_temp.set_logo(url text) returns void language plpgsql as $$
begin perform set_config('app.trusted_update', 'true', true); update brand_partners set logo_url = url where id = pg_temp.p(); end $$;
create or replace function pg_temp.screen(url text, tier text, outcome text, at timestamptz) returns void language sql as $$
  insert into business_content_screening_results (partner_id, target_type, content_snapshot, risk_tier, review_outcome, created_at)
  values (pg_temp.p(), 'business_profile', jsonb_build_object('logoUrl', url, 'logoScreened', true), tier, outcome, at) $$;
create or replace function pg_temp.logo_seen() returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.owner()::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select logo_url into r from get_screened_business_logos(array[pg_temp.p()]);
  reset role;
  return r;
end $$;
do $$ begin delete from business_content_screening_results where partner_id = pg_temp.p() and target_type = 'business_profile'; end $$;

select pg_temp.set_logo('https://cdn.example.com/logo.png');
select pg_temp.screen('https://cdn.example.com/logo.png', 'low', null, now() - interval '10 min');
insert into results values ('external URL, even screened low -> not shown', pg_temp.logo_seen() is null);

select pg_temp.set_logo(pg_temp.base() || pg_temp.p()::text || '/logo-1.png');
select pg_temp.screen(pg_temp.base() || pg_temp.p()::text || '/logo-1.png', 'low', null, now() - interval '9 min');
insert into results values ('stored + screened low -> shown', pg_temp.logo_seen() = pg_temp.base() || pg_temp.p()::text || '/logo-1.png');

select pg_temp.set_logo(pg_temp.base() || gen_random_uuid()::text || '/logo-x.png');
select pg_temp.screen((select logo_url from brand_partners where id = pg_temp.p()), 'low', null, now() - interval '8 min');
insert into results values ('a file in another business''s folder -> not shown', pg_temp.logo_seen() is null);

-- replacement: a new file that is held for review is not shown; once approved it is
select pg_temp.set_logo(pg_temp.base() || pg_temp.p()::text || '/logo-2.png');
select pg_temp.screen(pg_temp.base() || pg_temp.p()::text || '/logo-2.png', 'medium', null, now() - interval '7 min');
insert into results values ('replacement pending review -> not shown', pg_temp.logo_seen() is null);
select pg_temp.screen(pg_temp.base() || pg_temp.p()::text || '/logo-2.png', 'medium', 'approved', now() - interval '6 min');
insert into results values ('replacement approved -> shown', pg_temp.logo_seen() = pg_temp.base() || pg_temp.p()::text || '/logo-2.png');
select pg_temp.set_logo(null);
insert into results values ('logo removed -> none', pg_temp.logo_seen() is null);

-- 7 storage: logo bucket public + write-once, owner folder only; offer media no longer overwritable
insert into results values ('logo bucket exists and is public', (select public from storage.buckets where id = 'business-logos'));
insert into results values ('logo bucket image-only', (select allowed_mime_types from storage.buckets where id = 'business-logos') @> array['image/png'] and not ((select allowed_mime_types from storage.buckets where id = 'business-logos') @> array['video/mp4']));
insert into results values ('no update/delete policy on logos', not exists (select 1 from pg_policies where tablename = 'objects' and cmd in ('UPDATE', 'DELETE') and (qual ilike '%business-logos%' or with_check ilike '%business-logos%')));
insert into results values ('offer media no longer overwritable', not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'Business owners can replace their own offer media'));
do $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.owner()::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into storage.objects (bucket_id, name, owner) values ('business-logos', pg_temp.p()::text || '/logo-verify.png', pg_temp.owner());
    reset role; insert into results values ('owner can store a logo in its own folder', true);
  exception when others then reset role; insert into results values ('owner can store a logo in its own folder (' || sqlerrm || ')', false);
  end;
end $$;
do $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.owner()::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into storage.objects (bucket_id, name, owner) values ('business-logos', gen_random_uuid()::text || '/logo-verify.png', pg_temp.owner());
    reset role; insert into results values ('owner cannot store in another folder', false);
  exception when others then reset role; insert into results values ('owner cannot store in another folder', true);
  end;
end $$;

-- 8 single overloads / grants
insert into results values ('logo reader single overload', (select count(*) from pg_proc where proname = 'get_screened_business_logos') = 1);
insert into results values ('trigger helpers not client-executable',
  not has_function_privilege('authenticated', 'public._offer_creative_must_be_ready()', 'execute')
  and not has_function_privilege('authenticated', 'public._creative_follows_review()', 'execute'));

select step, ok from results;
select case when bool_and(ok) then 'ALL OK' else 'FAILED' end as verdict from results;
rollback;
