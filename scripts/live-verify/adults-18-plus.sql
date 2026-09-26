-- Verifies migrations 20270228 (18+ only, same treatment as 21+) + 20270229 (suited ages 0..17). The locked item 87 matrix. Rolled back.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $t$
declare v_partner uuid; v_owner uuid;
begin
  select managed_partner_id, id into v_partner, v_owner from profiles where managed_partner_id is not null limit 1;
  update brand_partners set not_accommodated = '{}', suited_age_min = null, suited_age_max = null,
    attributes = array(select a from unnest(coalesce(attributes, '{}')) a where a not in ('kid_friendly','kid_menu','family_seating','stroller_friendly')),
    accommodates_party_types = array(select a from unnest(coalesce(accommodates_party_types, '{}')) a where a <> 'family'),
    offered_occasions = array(select a from unnest(coalesce(offered_occasions, '{}')) a where a <> 'family_gathering'),
    priority_occasions = array(select a from unnest(coalesce(priority_occasions, '{}')) a where a <> 'family_gathering'),
    priority_attributes = array(select a from unnest(coalesce(priority_attributes, '{}')) a where a not in ('kid_friendly','kid_menu','family_seating','stroller_friendly'))
  where id = v_partner;
  delete from business_experiences where partner_id = v_partner;
  delete from business_occasion_packages where partner_id = v_partner;
  update business_availability set status = 'cancelled' where partner_id = v_partner and bundle_occasion = 'family_gathering';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform set_business_not_accommodated(v_partner, array['adults_18_plus']);
  insert into r values ('owner sets 18+', (select array_to_string(not_accommodated, ',') from brand_partners where id = v_partner));
  begin perform set_business_not_accommodated(v_partner, array['adults_18_plus', 'adults_21_plus']); insert into r values ('18+ and 21+ via setter', 'ALLOWED (bad)');
  exception when others then insert into r values ('18+ and 21+ via setter refused', sqlerrm); end;
  begin perform set_business_not_accommodated(v_partner, array['adults_16_plus']); exception when others then insert into r values ('unknown key refused', sqlerrm); end;
  reset role;
  begin update brand_partners set not_accommodated = array['adults_18_plus','adults_21_plus'] where id = v_partner; insert into r values ('both via direct write', 'ALLOWED (bad)');
  exception when others then insert into r values ('both via direct write refused (CHECK)', 'yes'); end;
  begin update brand_partners set suited_age_min = 13, suited_age_max = 17 where id = v_partner; insert into r values ('18+ + Teens', 'ALLOWED (bad)');
  exception when others then insert into r values ('18+ + Teens refused', split_part(sqlerrm, E'\n', 1)); end;
  begin update brand_partners set attributes = coalesce(attributes, '{}') || 'kid_menu'::text where id = v_partner; insert into r values ('18+ + Kids menu', 'ALLOWED (bad)');
  exception when others then insert into r values ('18+ + Kids menu refused', split_part(sqlerrm, E'\n', 1)); end;
  update brand_partners set not_accommodated = array['no_children','adults_18_plus'] where id = v_partner;
  insert into r values ('18+ + No children allowed (redundant)', 'yes');
  update brand_partners set not_accommodated = array['adults_18_plus'] where id = v_partner;
  insert into r values ('child ask declined by 18+', coalesce(public._business_declines(v_partner, null, true, false, false, false, false)::text, 'kept'));
  insert into r values ('ordinary ask at 18+', coalesce(public._business_declines(v_partner, null, false, false, false, false, false)::text, 'kept'));
  insert into r values ('says no children (18+)', public._business_says_no_children(v_partner)::text);
  -- 21+ side of the matrix
  update brand_partners set not_accommodated = array['adults_21_plus'] where id = v_partner;
  begin update brand_partners set suited_age_min = 13, suited_age_max = 17 where id = v_partner; insert into r values ('21+ + Teens', 'ALLOWED (bad)');
  exception when others then insert into r values ('21+ + Teens refused', split_part(sqlerrm, E'\n', 1)); end;
  begin update brand_partners set attributes = coalesce(attributes, '{}') || 'kid_menu'::text where id = v_partner; insert into r values ('21+ + Kids menu', 'ALLOWED (bad)');
  exception when others then insert into r values ('21+ + Kids menu refused', split_part(sqlerrm, E'\n', 1)); end;
  update brand_partners set not_accommodated = array['no_children','adults_21_plus'] where id = v_partner;
  insert into r values ('21+ + No children allowed (redundant)', 'yes');
  insert into r values ('child ask declined by 21+', coalesce(public._business_declines(v_partner, null, true, false, false, false, false)::text, 'kept'));
  insert into r values ('ordinary ask at 21+', coalesce(public._business_declines(v_partner, null, false, false, false, false, false)::text, 'kept'));
  -- 20270229: no "Ages 18+" anywhere (every range includes someone under 18)
  update brand_partners set not_accommodated = '{}' where id = v_partner;
  begin update brand_partners set suited_age_min = 18 where id = v_partner; insert into r values ('business suited 18+', 'ALLOWED (bad)');
  exception when others then insert into r values ('business suited 18+ refused (CHECK)', 'yes'); end;
  begin update gatherings set suited_age_min = 18, suited_age_max = null where id = (select id from gatherings limit 1); insert into r values ('gathering suited 18+', 'ALLOWED (bad)');
  exception when others then insert into r values ('gathering suited 18+ refused (CHECK)', 'yes'); end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  begin perform set_business_suited_ages(v_partner, 18, null); insert into r values ('setter 18+', 'ALLOWED (bad)');
  exception when others then insert into r values ('setter 18+ refused', sqlerrm); end;
  perform set_business_suited_ages(v_partner, 13, 17);
  insert into r values ('Teens band still saves', (select suited_age_min||'/'||suited_age_max from brand_partners where id = v_partner));
  insert into r values ('gathering columns with adult rules', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='gatherings' and (column_name ilike '%adult%' or column_name ilike '%21%' or column_name ilike '%18%')));
  insert into r values ('overloads', (select string_agg(proname || '=' || n, ',') from (select proname, count(*) n from pg_proc where proname in
    ('set_business_not_accommodated','_business_declines','_business_says_no_children','_child_restriction_name') group by proname) x));
end $t$;
select * from r;
rollback;
