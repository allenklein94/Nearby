-- Phase 3 item 3 of the "Scorecard to 10" initiative: Community Area.
-- Optional, coarse-grained geographic identity for a community — never required, never a
-- gate, deliberately not the same precise-coordinate model gatherings use. See CLAUDE.md's
-- "Community Area" section for the full locked design and reasoning.

-- Three independently-optional layers, all nullable, zero behavior change for every existing
-- row: (1) city/region text, (2) an optional label, (3) an optional coarse map point.
alter table communities
  add column area_city text,
  add column area_region text,
  add column area_label text,
  add column area_lat double precision,
  add column area_lng double precision;

comment on column communities.area_city is 'Optional, coarse city/town name for this community''s Community Area — e.g. "Princeton". Never a precise address.';
comment on column communities.area_region is 'Optional state/province paired with area_city, e.g. "NJ" — disambiguates same-named cities.';
comment on column communities.area_label is 'Optional short neighborhood/general-area description, e.g. "Downtown".';
comment on column communities.area_lat is 'Optional coarse map point for this community''s Area. Independently optional even when area_city/area_region are set.';
comment on column communities.area_lng is 'Optional coarse map point for this community''s Area. Independently optional even when area_city/area_region are set.';

-- No RLS policy change needed: these are plain columns on an already-RLS-covered table.
-- Writes go through the new update_community_area() RPC below (creator or leader), matching
-- this table's own existing SELECT/UPDATE/INSERT policy shapes rather than opening a second,
-- broader raw-UPDATE surface.
create or replace function update_community_area(
  community_id_param uuid,
  area_city_param text,
  area_region_param text,
  area_label_param text,
  area_lat_param double precision,
  area_lng_param double precision
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from communities where id = community_id_param and creator_id = auth.uid()
  ) and not exists (
    select 1 from community_members
    where community_id = community_id_param and user_id = auth.uid() and role = 'leader'
  ) then
    raise exception 'Only the community creator or a leader can edit the Community Area';
  end if;

  update communities
  set
    area_city = nullif(trim(area_city_param), ''),
    area_region = nullif(trim(area_region_param), ''),
    area_label = nullif(trim(area_label_param), ''),
    area_lat = area_lat_param,
    area_lng = area_lng_param
  where id = community_id_param;
end;
$$;

revoke all on function update_community_area(uuid, text, text, text, double precision, double precision) from public, anon;
grant execute on function update_community_area(uuid, text, text, text, double precision, double precision) to authenticated;
