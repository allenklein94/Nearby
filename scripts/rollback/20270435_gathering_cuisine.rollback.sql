-- Rollback of 20270435_gathering_cuisine.sql (newest first; run only with the owner's approval).
-- DATA: dropping the column discards every gathering's cuisine. Before running, count them
--   select count(*) from public.gatherings where cuisine is not null;
-- and, if any, export (id, cuisine) to the backup folder first. Requests already created keep their own cuisine (that column
-- existed before 20270435 and is not touched).
drop trigger if exists business_request_inherit_gathering_cuisine on public.business_requests;
drop function if exists private.business_request_inherit_gathering_cuisine();
drop trigger if exists gathering_cuisine_guard on public.gatherings;
drop function if exists private.gathering_cuisine_guard();
drop function if exists private._is_cuisine_parent_tag(text);
alter table public.gatherings drop constraint if exists gatherings_cuisine_check;
alter table public.gatherings drop column if exists cuisine;
