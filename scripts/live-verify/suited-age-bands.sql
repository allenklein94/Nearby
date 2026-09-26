-- Verifies the quick age bands (All ages / Kids / Teens) are the SAME suited-age range storage (no schema change),
-- that All ages is distinct from unset, and that No children / 21+ conflicts still hold. Rolled back.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $t$
declare v_partner uuid; v_owner uuid; v_g uuid; v_min int; v_max int; v_na text[];
begin
  select managed_partner_id, id into v_partner, v_owner from profiles where managed_partner_id is not null limit 1;
  select not_accommodated into v_na from brand_partners where id = v_partner;
  update brand_partners set not_accommodated = '{}' where id = v_partner;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into r values ('unset stored as', (select coalesce(suited_age_min::text,'null')||'/'||coalesce(suited_age_max::text,'null') from brand_partners where id = v_partner));
  perform set_business_suited_ages(v_partner, 0, null);
  select suited_age_min, suited_age_max into v_min, v_max from brand_partners where id = v_partner;
  insert into r values ('All ages stored as', v_min || '/' || coalesce(v_max::text, 'null'));
  perform set_business_suited_ages(v_partner, 0, 12);
  insert into r values ('Kids stored as', (select suited_age_min||'/'||suited_age_max from brand_partners where id = v_partner));
  perform set_business_suited_ages(v_partner, 13, 17);
  insert into r values ('Teens stored as', (select suited_age_min||'/'||suited_age_max from brand_partners where id = v_partner));
  perform set_business_suited_ages(v_partner, 3, 8);
  insert into r values ('exact 3-8 stored as', (select suited_age_min||'/'||suited_age_max from brand_partners where id = v_partner));
  -- conflicts: any declared range (bands included) vs No children / 21+
  perform set_business_suited_ages(v_partner, 0, null);
  reset role;
  begin update brand_partners set not_accommodated = array['no_children'] where id = v_partner; insert into r values ('All ages + No children', 'ALLOWED (bad)');
  exception when others then insert into r values ('All ages + No children refused', split_part(sqlerrm, E'\n', 1)); end;
  update brand_partners set suited_age_min = 13, suited_age_max = 17 where id = v_partner;
  begin update brand_partners set not_accommodated = array['adults_21_plus'] where id = v_partner; insert into r values ('Teens + 21+', 'ALLOWED (bad)');
  exception when others then insert into r values ('Teens + 21+ refused', split_part(sqlerrm, E'\n', 1)); end;
  update brand_partners set suited_age_min = null, suited_age_max = null where id = v_partner;
  update brand_partners set not_accommodated = array['no_children'] where id = v_partner;
  insert into r values ('unset + No children allowed', 'yes');
  update brand_partners set not_accommodated = coalesce(v_na, '{}') where id = v_partner;
  -- gatherings take the same pairs
  select id into v_g from gatherings limit 1;
  update gatherings set suited_age_min = 0, suited_age_max = null where id = v_g;
  insert into r values ('gathering All ages', (select suited_age_min||'/'||coalesce(suited_age_max::text,'null') from gatherings where id = v_g));
  update gatherings set suited_age_min = 13, suited_age_max = 17 where id = v_g;
  insert into r values ('gathering Teens', (select suited_age_min||'/'||suited_age_max from gatherings where id = v_g));
  insert into r values ('join/invite functions reading suited_age',
    (select count(*)::text from pg_proc where proname in ('join_gathering','approve_gathering_interest','_promote_from_waitlist','invite_friend_to_gathering','send_social_invite','_business_declines') and prosrc ilike '%suited_age%'));
  insert into r values ('any age_band column', (select count(*)::text from information_schema.columns where table_schema='public' and column_name ilike '%age_band%'));
end $t$;
select * from r;
rollback;
