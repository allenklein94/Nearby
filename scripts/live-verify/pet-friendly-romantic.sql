-- Verifies migration 20270200 (pet_friendly, romantic attributes). Rolled back.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $t$
declare v_partner uuid; v_val text[];
begin
  select managed_partner_id into v_partner from profiles where managed_partner_id is not null limit 1;
  update brand_partners set attributes = array['pet_friendly','romantic','quiet','outdoor_seating','date_friendly'] where id = v_partner;
  select attributes into v_val from brand_partners where id = v_partner;
  insert into r values ('coffee-shop style business carries the four qualities', array_to_string(v_val, ','));
  begin update brand_partners set attributes = array['cat_friendly'] where id = v_partner; exception when others then insert into r values ('unknown attribute refused', 'yes'); end;
  insert into r values ('functions widened, single overload each', (select string_agg(proname || ':' || c || ':' || w, ' ') from (select p.proname, count(*) c, bool_or(pg_get_functiondef(p.oid) like '%''romantic''%') w from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('create_business_request','update_business_profile','answer_preference_poll','set_business_priority_attributes','create_business_experience','update_business_experience') group by 1) x));
end $t$;
select * from r;
rollback;
