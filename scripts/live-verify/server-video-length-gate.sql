-- Server-side video length gate (20270289). Rolled back.
-- A video can only be ready in the library, or sit on an offer, once the server checked its length (business_video_checks,
-- service role only). On an offer it must ALSO have passed content screening (a ready creative for that file), unless an
-- admin publishes it through the review function. Direct API attempts by the owner are refused. Images are unchanged.
begin;
create temp table results (step text, ok boolean) on commit drop;
grant all on results to authenticated;

create or replace function pg_temp.p() returns uuid language sql as $$ select id from brand_partners where active order by created_at limit 1 $$;
create or replace function pg_temp.owner() returns uuid language sql as $$ select id from profiles where managed_partner_id = pg_temp.p() limit 1 $$;
create or replace function pg_temp.req() returns uuid language sql as $$ select id from business_requests order by created_at limit 1 $$;
create or replace function pg_temp.vpath(n text) returns text language sql as $$ select pg_temp.p()::text || '/verify-' || n || '.mp4' $$;
create or replace function pg_temp.checked(path text) returns void language sql as $$
  insert into business_video_checks (partner_id, media_path, duration_ms) values (pg_temp.p(), path, 29900) $$;
create or replace function pg_temp.creative(path text, st text) returns boolean language plpgsql as $$
begin
  insert into business_creatives (partner_id, media_type, media_path, poster_path, frame_paths, status, source, reviewing_since)
  values (pg_temp.p(), 'video', path, pg_temp.p()::text || '/f.jpg', array[pg_temp.p()::text || '/f.jpg'], st, 'library', now());
  return true;
exception when others then return false;
end $$;
-- each attempt undoes itself (raising rolls back the insert), so one attempt never decides the next
create or replace function pg_temp.offer_with(path text, mtype text default 'video') returns text language plpgsql as $$
begin
  insert into business_request_offers (request_id, partner_id, status, media_path, media_type, media_poster_path)
  values (pg_temp.req(), pg_temp.p(), 'pending', path, mtype, pg_temp.p()::text || '/f.jpg');
  raise exception 'ATTACHED';
exception when others then return sqlerrm;
end $$;

-- 0 nothing existing is affected
insert into results values ('no video creatives exist before', (select count(*) from business_creatives where media_type = 'video') = 0);
insert into results values ('no video offers exist before', (select count(*) from business_request_offers where media_type = 'video') = 0);

-- 1 library: a video cannot become ready without the length record
insert into results values ('unchecked video creative refused as ready', not pg_temp.creative(pg_temp.vpath('a'), 'ready'));
insert into results values ('unchecked video creative may wait as reviewing', pg_temp.creative(pg_temp.vpath('b'), 'reviewing'));
do $$ begin
  update business_creatives set status = 'ready' where media_path = pg_temp.vpath('b');
  insert into results values ('reviewing -> ready refused without the check', false);
exception when others then insert into results values ('reviewing -> ready refused without the check', sqlerrm = 'We couldn''t check this video''s length.');
end $$;
select pg_temp.checked(pg_temp.vpath('b'));
update business_creatives set status = 'ready' where media_path = pg_temp.vpath('b');
insert into results values ('checked video creative becomes ready', (select status from business_creatives where media_path = pg_temp.vpath('b')) = 'ready');

-- 2 offers: length record AND screening proof
insert into results values ('offer refuses an unchecked video', pg_temp.offer_with(pg_temp.vpath('c')) = 'We couldn''t check this video''s length.');
select pg_temp.checked(pg_temp.vpath('d'));
insert into results values ('offer refuses a checked but unscreened video', pg_temp.offer_with(pg_temp.vpath('d')) = 'That video has not been approved yet.');
insert into results values ('offer accepts a checked + screened video', pg_temp.offer_with(pg_temp.vpath('b')) = 'ATTACHED');
do $$ begin
  update business_creatives set archived_at = now() where media_path = pg_temp.vpath('b');
  insert into results values ('offer refuses once the creative is archived', pg_temp.offer_with(pg_temp.vpath('b')) = 'That video has not been approved yet.');
  update business_creatives set archived_at = null where media_path = pg_temp.vpath('b');
end $$;
insert into results values ('images are unchanged', pg_temp.offer_with(pg_temp.p()::text || '/verify-img.jpg', 'image') = 'ATTACHED');

-- 3 the record cannot exceed 30 s or be empty
do $$ begin
  insert into business_video_checks (partner_id, media_path, duration_ms) values (pg_temp.p(), pg_temp.vpath('e'), 30001);
  insert into results values ('record over 30 s refused', false);
exception when check_violation then insert into results values ('record over 30 s refused', true);
end $$;
do $$ begin
  insert into business_video_checks (partner_id, media_path, duration_ms) values (pg_temp.p(), pg_temp.vpath('e'), 30000);
  insert into results values ('record of exactly 30 s accepted', true);
exception when others then insert into results values ('record of exactly 30 s accepted', false);
end $$;

-- 4 direct API attempts by the signed-in owner
do $$
declare offer_id uuid; msg text;
begin
  -- a pending opportunity of this business, on an open request (made inside this transaction)
  update business_requests set status = 'open', expires_at = now() + interval '1 day' where id = pg_temp.req();
  insert into business_request_offers (request_id, partner_id, status) values (pg_temp.req(), pg_temp.p(), 'pending')
    on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.owner()::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into business_video_checks (partner_id, media_path, duration_ms) values (pg_temp.p(), pg_temp.vpath('x'), 1000);
    insert into results values ('owner cannot write a length record', false);
  exception when insufficient_privilege then insert into results values ('owner cannot write a length record', true);
  end;
  begin
    perform 1 from business_video_checks;
    insert into results values ('owner cannot read length records', false);
  exception when insufficient_privilege then insert into results values ('owner cannot read length records', true);
  end;
  begin
    insert into business_creatives (partner_id, media_type, media_path, status) values (pg_temp.p(), 'video', pg_temp.vpath('y'), 'ready');
    insert into results values ('owner cannot write the library', false);
  exception when insufficient_privilege then insert into results values ('owner cannot write the library', true);
  end;
  begin
    perform submit_business_offer(pg_temp.req(), 'standard', 'We can take you', null, null, null,
      pg_temp.vpath('z'), 'video', null, '{}'::text[], false, null, null, pg_temp.p()::text || '/f.jpg');
    insert into results values ('submit_business_offer refuses an unchecked video', false);
  exception when others then
    msg := sqlerrm;
    insert into results values ('submit_business_offer refuses an unchecked video (' || msg || ')', msg = 'We couldn''t check this video''s length.');
  end;
  begin
    perform submit_business_offer(pg_temp.req(), 'standard', 'We can take you', null, null, null,
      pg_temp.vpath('d'), 'video', null, '{}'::text[], false, null, null, pg_temp.p()::text || '/f.jpg');
    insert into results values ('submit_business_offer refuses a checked but unscreened video', false);
  exception when others then
    msg := sqlerrm;
    insert into results values ('submit_business_offer refuses a checked but unscreened video (' || msg || ')', msg = 'That video has not been approved yet.');
  end;
  reset role;
end $$;

-- 4b the team publishing a held offer: its checked video goes out; an unchecked one is still refused
create or replace function pg_temp.review(path text) returns text language plpgsql as $$
declare s uuid;
begin
  insert into business_content_screening_results (partner_id, target_type, content_snapshot, risk_tier)
  values (pg_temp.p(), 'offer_response', jsonb_build_object('requestId', pg_temp.req(), 'offerType', 'standard',
    'offerDescription', 'We can take you', 'mediaPath', path, 'mediaType', 'video', 'posterPath', pg_temp.p()::text || '/f.jpg'), 'medium')
  returning id into s;
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where check_is_admin(id) limit 1)::text, 'role', 'authenticated')::text, true);
  perform admin_review_business_content_screening(s, true);
  raise exception 'PUBLISHED %', (select media_path from business_request_offers where request_id = pg_temp.req() and partner_id = pg_temp.p());
exception when others then return sqlerrm;
end $$;
insert into results values ('review publishes a checked held video', pg_temp.review(pg_temp.vpath('d')) = 'PUBLISHED ' || pg_temp.vpath('d'));
insert into results values ('review still refuses an unchecked video', pg_temp.review(pg_temp.vpath('q')) = 'We couldn''t check this video''s length.');
insert into results values ('no publishing flag left set', coalesce(current_setting('app.reviewed_offer_media', true), '') = '');

-- 5 grants and overloads
insert into results values ('authenticated has no table privilege', not has_table_privilege('authenticated', 'public.business_video_checks', 'select,insert,update,delete'));
insert into results values ('anon has no table privilege', not has_table_privilege('anon', 'public.business_video_checks', 'select,insert,update,delete'));
insert into results values ('review function has one overload', (select count(*) from pg_proc where proname = 'admin_review_business_content_screening') = 1);
insert into results values ('helper not client-executable', not has_function_privilege('authenticated', 'public._video_length_checked(uuid, text)', 'execute'));

select step, ok from results order by ok, step;
select case when bool_and(ok) then 'ALL OK' else 'FAILURES' end as verdict, count(*) as checks from results;
rollback;
