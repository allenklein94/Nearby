-- Verifies migration 20270198 (accessibility + family attributes; gatherings.features). Rolled back.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $t$
declare v_partner uuid; v_owner uuid; v_g uuid; v_val text[]; v_err text;
begin
  select managed_partner_id, id into v_partner, v_owner from profiles where managed_partner_id is not null limit 1;
  update brand_partners set attributes = array['wheelchair_accessible','stroller_friendly','kid_menu','quiet'] where id = v_partner;
  select attributes into v_val from brand_partners where id = v_partner;
  insert into r values ('business accepts the new keys', array_to_string(v_val, ','));
  begin update brand_partners set attributes = array['wheelchair'] where id = v_partner; exception when others then insert into r values ('unknown attribute refused', 'yes'); end;
  select id into v_g from gatherings limit 1;
  update gatherings set features = array['wheelchair_accessible','kid_friendly'] where id = v_g;
  insert into r values ('gathering accepts declared features', (select array_to_string(features, ',') from gatherings where id = v_g));
  begin update gatherings set features = array['kid_menu'] where id = v_g; exception when others then insert into r values ('feature outside the closed list refused', 'yes'); end;
  insert into r values ('default is empty', (select column_default from information_schema.columns where table_name='gatherings' and column_name='features'));
end $t$;
select * from r;
rollback;
