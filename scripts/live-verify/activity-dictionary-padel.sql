-- Item 75 live check (rolled back): Padel is its own tag; padel is never a synonym of Pickleball; an admin cannot
-- redirect a canonical tag's own name; a normal synonym still works; a non-admin is refused; single overload.
begin;
do $$ begin
  if not exists (select 1 from category_tag_groups where tag = 'Padel' and group_key = 'activities_recreation') then raise exception 'FAIL padel tag'; end if;
  if exists (select 1 from category_synonyms where phrase like 'padel%' and tag = 'Pickleball') then raise exception 'FAIL padel->pickleball'; end if;
  if not exists (select 1 from category_synonyms where phrase = 'paddle board' and tag = 'Paddleboarding') then raise exception 'FAIL seed'; end if;
  if (select count(*) from pg_proc where proname = 'admin_add_category_synonym') <> 1 then raise exception 'FAIL overloads'; end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where is_admin limit 1), 'role','authenticated')::text, true);
set local role authenticated;
do $$
declare ok boolean;
begin
  begin perform admin_add_category_synonym('padel', 'Pickleball'); ok := false;
  exception when others then ok := sqlerrm = 'That phrase is already its own category'; end;
  if not ok then raise exception 'FAIL redirect not refused'; end if;
  begin perform admin_add_category_synonym('Pickleball', 'Tennis'); ok := false;
  exception when others then ok := sqlerrm = 'That phrase is already its own category'; end;
  if not ok then raise exception 'FAIL redirect 2 not refused'; end if;
  perform admin_add_category_synonym('padel league', 'Padel');
  perform admin_add_category_synonym('padel', 'Padel');  -- its own name for itself is allowed (no-op)
end $$;
reset role;
do $$ begin
  if not exists (select 1 from category_synonyms where phrase = 'padel league' and tag = 'Padel') then raise exception 'FAIL normal add'; end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where not coalesce(is_admin,false) limit 1), 'role','authenticated')::text, true);
set local role authenticated;
do $$
declare ok boolean;
begin
  begin perform admin_add_category_synonym('padel league 2', 'Padel'); ok := false;
  exception when others then ok := sqlerrm = 'Only an admin can add a synonym'; end;
  if not ok then raise exception 'FAIL non-admin'; end if;
end $$;
select 'PASS' as result;
rollback;
