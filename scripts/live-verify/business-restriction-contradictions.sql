-- Verifies migrations 20270222 + 20270224 + 20270225 + 20270226 (item 86 save-time contradictions, profile, offerings AND availability
-- bundles; exact owner wording; structured refusal; the check-only call). Rolled back; results via the exception text.
-- Each case starts from a clean business, applies the two settings in BOTH orders, and expects REFUSED or ALLOWED.
begin;
do $$
declare out text := ''; base jsonb; b uuid; msg text;
  procedure_ok boolean;
begin
  select to_jsonb(bp) into base from brand_partners bp limit 1;
  b := gen_random_uuid();
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', b, 'name', 'T-Contra', 'active', false,
    'attributes', '[]'::jsonb, 'priority_attributes', '[]'::jsonb, 'priority_occasions', '[]'::jsonb, 'offered_occasions', '[]'::jsonb,
    'accommodates_party_types', '[]'::jsonb, 'not_accommodated', '[]'::jsonb, 'weather_setting', null, 'suited_age_min', null, 'suited_age_max', null,
    'max_group_size', null, 'outdoor_capacity', null, 'private_room_capacity', null))).*;

  create temp table cases (label text, a text, b text, expect text) on commit drop;
  insert into cases values
    -- newly blocked: No children
    ('No children + Family group',            'not_accommodated = array[''no_children'']', 'accommodates_party_types = array[''family'']', 'REFUSED'),
    ('No children + Group/Family occasion',   'not_accommodated = array[''no_children'']', 'offered_occasions = array[''family_gathering'']', 'REFUSED'),
    ('No children + want more families',      'not_accommodated = array[''no_children'']', 'priority_attributes = array[''kid_friendly'']', 'REFUSED'),
    ('No children + want more Family Gathering', 'not_accommodated = array[''no_children'']', 'priority_occasions = array[''family_gathering'']', 'REFUSED'),
    ('No children + want more Kids menu',     'not_accommodated = array[''no_children'']', 'priority_attributes = array[''kid_menu'']', 'REFUSED'),
    ('21+ + Family group',                    'not_accommodated = array[''adults_21_plus'']', 'accommodates_party_types = array[''family'']', 'REFUSED'),
    -- newly blocked: Indoor only
    ('Indoor only + Outdoor dining',          'weather_setting = ''indoor''', 'attributes = array[''outdoor_seating'']', 'REFUSED'),
    ('Indoor only + outdoor area size',       'weather_setting = ''indoor''', 'attributes = array[''outdoor_seating''], outdoor_capacity = 30', 'REFUSED'),
    -- existing, must stay blocked
    ('No children + Family-friendly',         'not_accommodated = array[''no_children'']', 'attributes = array[''kid_friendly'']', 'REFUSED'),
    ('No children + Kids menu',               'not_accommodated = array[''no_children'']', 'attributes = array[''kid_menu'']', 'REFUSED'),
    ('No children + Family seating',          'not_accommodated = array[''no_children'']', 'attributes = array[''family_seating'']', 'REFUSED'),
    ('No children + Stroller friendly',       'not_accommodated = array[''no_children'']', 'attributes = array[''stroller_friendly'']', 'REFUSED'),
    ('No children + suited ages',             'not_accommodated = array[''no_children'']', 'suited_age_min = 5', 'REFUSED'),
    ('No pets + Dog friendly',                'not_accommodated = array[''no_pets'']', 'attributes = array[''dog_friendly'']', 'REFUSED'),
    ('No pets + Pet friendly',                'not_accommodated = array[''no_pets'']', 'attributes = array[''pet_friendly'']', 'REFUSED'),
    -- must stay allowed
    ('21+ + No children',                     'not_accommodated = array[''adults_21_plus'']', 'not_accommodated = array[''adults_21_plus'', ''no_children'']', 'ALLOWED'),
    ('No children + Quiet',                   'not_accommodated = array[''no_children'']', 'attributes = array[''quiet'']', 'ALLOWED'),
    ('No children + Date-friendly',           'not_accommodated = array[''no_children'']', 'attributes = array[''date_friendly'']', 'ALLOWED'),
    ('No children + Private events',          'not_accommodated = array[''no_children'']', 'attributes = array[''private_dining'']', 'ALLOWED'),
    ('No children + Groups',                  'not_accommodated = array[''no_children'']', 'attributes = array[''group_friendly''], accommodates_party_types = array[''groups'']', 'ALLOWED'),
    ('No children + large group size',        'not_accommodated = array[''no_children'']', 'max_group_size = 200', 'ALLOWED'),
    ('No children + Baby Shower occasion',    'not_accommodated = array[''no_children'']', 'priority_occasions = array[''baby_shower'']', 'ALLOWED'),
    ('No children + family category tag',     'not_accommodated = array[''no_children'']', 'category = ''family_kids'', subcategory = ''Kids Museums''', 'ALLOWED'),
    ('No pets + service animals',             'not_accommodated = array[''no_pets'']', 'attributes = array[''service_animal_friendly'']', 'ALLOWED'),
    ('Outdoor only + Outdoor dining',         'weather_setting = ''outdoor''', 'attributes = array[''outdoor_seating'']', 'ALLOWED'),
    ('Indoor only + stale hidden outdoor size', 'weather_setting = ''indoor''', 'outdoor_capacity = 30', 'ALLOWED');

  declare c record; ord int; got text; first_set text; second_set text;
  begin
    for c in select * from cases loop
      for ord in 1..2 loop
        first_set := case when ord = 1 then c.a else c.b end;
        second_set := case when ord = 1 then c.b else c.a end;
        update brand_partners set attributes = '{}', priority_attributes = '{}', priority_occasions = '{}', offered_occasions = '{}',
          accommodates_party_types = '{}', not_accommodated = '{}', weather_setting = null, suited_age_min = null, suited_age_max = null,
          max_group_size = null, outdoor_capacity = null where id = b;
        begin
          execute format('update brand_partners set %s where id = %L', first_set, b);
          execute format('update brand_partners set %s where id = %L', second_set, b);
          got := 'ALLOWED'; msg := null;
        exception when others then got := 'REFUSED'; msg := sqlerrm;
        end;
        out := out || (case when got = c.expect then 'ok   ' else 'FAIL ' end) || c.label || ' (order ' || ord || '): ' || got
          || case when ord = 1 and msg is not null then ' -- ' || msg else '' end || E'\n';
      end loop;
    end loop;
  end;
  -- Offerings (20270225): each case in both save directions. dir 1 = No children first, then the offering; dir 2 = offering first.
  declare o record; dir int; got text; owner_id uuid; oid uuid;
  begin
    select id into owner_id from profiles limit 1;
    perform set_config('app.trusted_update', 'true', true);
    update profiles set managed_partner_id = b where id = owner_id;
    create temp table ocases (label text, restriction text, kind text, party text, attrs text[], occ text, active boolean, expect text) on commit drop;
    insert into ocases values
      ('No children + Family Signature Experience',          'no_children',    'experience', 'family', '{}', null, true, 'REFUSED'),
      ('21+ + Family Signature Experience',                  'adults_21_plus', 'experience', 'family', '{}', null, true, 'REFUSED'),
      ('No children + Family-friendly Signature Experience', 'no_children',    'experience', 'groups', '{kid_friendly}', null, true, 'REFUSED'),
      ('No children + Family Gathering package',             'no_children',    'package', null, null, 'family_gathering', true, 'REFUSED'),
      ('No children + paused Family Gathering package',      'no_children',    'package', null, null, 'family_gathering', false, 'REFUSED'),
      ('21+ + Family Gathering package',                     'adults_21_plus', 'package', null, null, 'family_gathering', true, 'REFUSED'),
      ('No children + Groups Signature Experience',          'no_children',    'experience', 'groups', '{private_dining}', null, true, 'ALLOWED'),
      ('No children + Date Signature Experience',            'no_children',    'experience', 'date', '{quiet}', null, true, 'ALLOWED'),
      ('No children + Birthday package',                     'no_children',    'package', null, null, 'birthday', true, 'ALLOWED'),
      ('No children + Baby Shower package',                  'no_children',    'package', null, null, 'baby_shower', true, 'ALLOWED'),
      ('No pets + Family Gathering package',                 'no_pets',        'package', null, null, 'family_gathering', true, 'ALLOWED'),
      -- 20270226: availability posting bundles (active = live window; false = a posting that has ended)
      ('No children + Family Gathering posting',             'no_children',    'availability', null, null, 'family_gathering', true, 'REFUSED'),
      ('21+ + Family Gathering posting',                     'adults_21_plus', 'availability', null, null, 'family_gathering', true, 'REFUSED'),
      ('No children + ended Family Gathering posting',       'no_children',    'availability', null, null, 'family_gathering', false, 'ALLOWED'),
      ('No children + Date night posting',                   'no_children',    'availability', null, null, 'date_night', true, 'ALLOWED'),
      ('No children + posting with no bundle',               'no_children',    'availability', null, null, null, true, 'ALLOWED'),
      ('No pets + Family Gathering posting',                 'no_pets',        'availability', null, null, 'family_gathering', true, 'ALLOWED');
    for o in select * from ocases loop
      for dir in 1..2 loop
        delete from business_experiences where partner_id = b;
        delete from business_occasion_packages where partner_id = b;
        delete from business_availability where partner_id = b;
        update brand_partners set attributes = '{}', priority_attributes = '{}', priority_occasions = '{}', offered_occasions = '{}',
          accommodates_party_types = '{}', not_accommodated = '{}', weather_setting = null, suited_age_min = null, suited_age_max = null,
          max_group_size = null, outdoor_capacity = null where id = b;
        msg := null;
        begin
          if dir = 1 then update brand_partners set not_accommodated = array[o.restriction] where id = b; end if;
          if o.kind = 'experience' then
            insert into business_experiences (partner_id, title, attributes, party_type, active) values (b, 'Test night', o.attrs, o.party, o.active);
          elsif o.kind = 'package' then
            insert into business_occasion_packages (partner_id, occasion_type, name, active) values (b, o.occ, 'Test package', o.active);
          else
            insert into business_availability (partner_id, title, starts_at, ends_at, status, bundle_occasion)
              values (b, 'Test posting', now() - interval '1 hour', case when o.active then now() + interval '3 hours' else now() - interval '10 minutes' end,
                      case when o.active then 'active' else 'expired' end, o.occ);
          end if;
          if dir = 2 then update brand_partners set not_accommodated = array[o.restriction] where id = b; end if;
          got := 'ALLOWED';
        exception when others then got := 'REFUSED'; msg := sqlerrm;
        end;
        out := out || (case when got = o.expect then 'ok   ' else 'FAIL ' end) || o.label || ' (' || case when dir = 1 then 'restriction first' else 'offering first' end || '): ' || got
          || case when msg is not null then ' -- ' || msg else '' end || E'\n';
      end loop;
    end loop;

    -- through the owner's real RPCs (the paths the app uses), both directions
    delete from business_experiences where partner_id = b;
    delete from business_occasion_packages where partner_id = b;
    delete from business_availability where partner_id = b;
    update brand_partners set not_accommodated = array['no_children'] where id = b;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
    begin
      perform create_business_experience(b, 'Family brunch', null, null, '{}', null, 'family', false, null, null);
      out := out || 'FAIL rpc create_business_experience family with No children: ALLOWED' || E'\n';
    exception when others then out := out || 'ok   rpc create_business_experience family with No children: REFUSED' || E'\n'; end;
    begin
      perform create_occasion_package('family_gathering', 'Sunday family table', null, '{}', null, null, null);
      out := out || 'FAIL rpc create_occasion_package Family Gathering with No children: ALLOWED' || E'\n';
    exception when others then out := out || 'ok   rpc create_occasion_package Family Gathering with No children: REFUSED' || E'\n'; end;
    perform set_business_not_accommodated(b, array[]::text[]);
    perform create_occasion_package('family_gathering', 'Sunday family table', null, '{}', null, null, null);
    begin
      perform set_business_not_accommodated(b, array['no_children']);
      out := out || 'FAIL rpc set No children with a Family Gathering package: ALLOWED' || E'\n';
    exception when others then out := out || 'ok   rpc set No children with a Family Gathering package: REFUSED -- ' || sqlerrm || E'\n'; end;
    perform set_config('request.jwt.claims', '', true);
  end;

  -- 20270226: exact wording, all conflicts in one refusal, structured DETAIL/HINT, check-only call
  declare v_msg text; v_detail text; v_hint text; owner_id uuid; got text[];
  begin
    delete from business_experiences where partner_id = b;
    delete from business_occasion_packages where partner_id = b;
    delete from business_availability where partner_id = b;
    update brand_partners set attributes = '{}', priority_attributes = '{}', priority_occasions = '{}', offered_occasions = '{}',
      accommodates_party_types = '{}', not_accommodated = '{}', weather_setting = null, suited_age_min = null, suited_age_max = null,
      max_group_size = null, outdoor_capacity = null where id = b;
    update brand_partners set attributes = array['kid_friendly', 'kid_menu', 'outdoor_seating'], priority_attributes = array['kid_friendly'],
      priority_occasions = array['family_gathering'], outdoor_capacity = 30 where id = b;
    insert into business_occasion_packages (partner_id, occasion_type, name, active) values (b, 'family_gathering', 'P', true);
    insert into business_availability (partner_id, title, starts_at, ends_at, status, bundle_occasion)
      values (b, 'A', now(), now() + interval '2 hours', 'active', 'family_gathering');
    begin
      update brand_partners set not_accommodated = array['no_children'], weather_setting = 'indoor' where id = b;
      out := out || 'FAIL multi-conflict save: ALLOWED' || E'\n';
    exception when others then
      get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
      out := out || (case when v_hint = 'setting_conflict' and v_detail::jsonb = jsonb_build_array(
          'No children conflicts with Family-friendly. Remove one of these settings to continue.',
          'No children conflicts with Kids menu. Remove one of these settings to continue.',
          'No children conflicts with wanting more families. Remove one of these settings to continue.',
          'No children conflicts with Family Gathering. Remove one of these settings to continue.',
          'Indoor only conflicts with Outdoor dining. Remove one of these settings to continue.',
          'Indoor only conflicts with the outdoor area size. Remove one of these settings to continue.')
        and v_msg = array_to_string(array(select jsonb_array_elements_text(v_detail::jsonb)), E'\n')
        then 'ok   ' else 'FAIL ' end) || 'multi-conflict save: every line once (package + posting = one Family Gathering), hint + detail -- ' || v_detail || E'\n';
    end;
    -- 21+ alone names itself
    update brand_partners set attributes = array['kid_friendly'], priority_attributes = '{}', priority_occasions = '{}', outdoor_capacity = null where id = b;
    delete from business_occasion_packages where partner_id = b; delete from business_availability where partner_id = b;
    begin
      update brand_partners set not_accommodated = array['adults_21_plus'] where id = b;
      out := out || 'FAIL 21+ + Family-friendly: ALLOWED' || E'\n';
    exception when others then
      out := out || (case when sqlerrm = '21+ only conflicts with Family-friendly. Remove one of these settings to continue.' then 'ok   ' else 'FAIL ' end) || '21+ wording: ' || sqlerrm || E'\n';
    end;
    -- same message from the offering side
    update brand_partners set attributes = '{}', not_accommodated = array['no_children'] where id = b;
    begin
      insert into business_availability (partner_id, title, starts_at, ends_at, status, bundle_occasion) values (b, 'A', now(), now() + interval '2 hours', 'active', 'family_gathering');
      out := out || 'FAIL posting with No children: ALLOWED' || E'\n';
    exception when others then
      out := out || (case when sqlerrm = 'No children conflicts with Family Gathering. Remove one of these settings to continue.' then 'ok   ' else 'FAIL ' end) || 'posting-side wording: ' || sqlerrm || E'\n';
    end;
    -- through the real RPC the edge function uses (post_business_availability), and the check-only call
    select id into owner_id from profiles where managed_partner_id = b limit 1;
    update brand_partners set address = '1 Test St', latitude = 40.0, longitude = -75.0 where id = b;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
    begin
      perform post_business_availability(null, 'Sunday family table', null, null, null, null, now(), now() + interval '2 hours', 15, 'family_gathering', '{}', null);
      out := out || 'FAIL rpc post_business_availability Family Gathering with No children: ALLOWED' || E'\n';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      out := out || (case when v_hint = 'setting_conflict' then 'ok   ' else 'FAIL ' end) || 'rpc post_business_availability Family Gathering with No children: REFUSED -- ' || sqlerrm || E'\n';
    end;
    perform set_business_not_accommodated(b, array[]::text[]);
    perform post_business_availability(null, 'Sunday family table', null, null, null, null, now(), now() + interval '2 hours', 15, 'family_gathering', '{}', null);
    begin
      perform set_business_not_accommodated(b, array['no_children']);
      out := out || 'FAIL rpc set No children with a live Family Gathering posting: ALLOWED' || E'\n';
    exception when others then out := out || 'ok   rpc set No children with a live Family Gathering posting: REFUSED -- ' || sqlerrm || E'\n'; end;
    got := check_business_setting_conflicts(b, 'profile', '{"not_accommodated": ["no_children"]}');
    out := out || (case when got = array['No children conflicts with Family Gathering. Remove one of these settings to continue.'] then 'ok   ' else 'FAIL ' end) || 'check-only profile: ' || coalesce(array_to_string(got, ' | '), 'null') || E'\n';
    out := out || (case when (select not_accommodated from brand_partners where id = b) = '{}' then 'ok   ' else 'FAIL ' end) || 'check-only saved nothing' || E'\n';
    update business_availability set status = 'cancelled' where partner_id = b;
    got := check_business_setting_conflicts(b, 'profile', '{"not_accommodated": ["no_children"]}');
    out := out || (case when got = '{}' then 'ok   ' else 'FAIL ' end) || 'check-only clear once the posting is cancelled' || E'\n';
    perform set_business_not_accommodated(b, array['no_children']);
    got := check_business_setting_conflicts(b, 'availability', '{"bundle_occasion": "family_gathering"}');
    out := out || (case when got = array['No children conflicts with Family Gathering. Remove one of these settings to continue.'] then 'ok   ' else 'FAIL ' end) || 'check-only availability' || E'\n';
    got := check_business_setting_conflicts(b, 'experience', '{"party_type": "family", "attributes": []}');
    out := out || (case when got = array['No children conflicts with Family Signature Experience. Remove one of these settings to continue.'] then 'ok   ' else 'FAIL ' end) || 'check-only experience' || E'\n';
    got := check_business_setting_conflicts(b, 'package', '{"occasion_type": "birthday"}');
    out := out || (case when got = '{}' then 'ok   ' else 'FAIL ' end) || 'check-only package birthday clear' || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    begin
      perform check_business_setting_conflicts(b, 'profile', '{}');
      out := out || 'FAIL check-only by a non-owner: ALLOWED' || E'\n';
    exception when others then out := out || 'ok   check-only by a non-owner: REFUSED' || E'\n'; end;
    perform set_config('request.jwt.claims', '', true);
    out := out || (case when not has_function_privilege('anon', 'public.check_business_setting_conflicts(uuid,text,jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public._raise_setting_conflicts(text[])', 'execute') then 'ok   ' else 'FAIL ' end) || 'grants' || E'\n';
  end;
  raise exception E'RESULT\n%', out;
end $$;
rollback;
