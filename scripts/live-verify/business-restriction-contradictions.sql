-- Verifies migrations 20270222 + 20270224 + 20270225 (item 86 save-time contradictions, profile AND offerings). Rolled back; results via the exception text.
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
      ('No pets + Family Gathering package',                 'no_pets',        'package', null, null, 'family_gathering', true, 'ALLOWED');
    for o in select * from ocases loop
      for dir in 1..2 loop
        delete from business_experiences where partner_id = b;
        delete from business_occasion_packages where partner_id = b;
        update brand_partners set attributes = '{}', priority_attributes = '{}', priority_occasions = '{}', offered_occasions = '{}',
          accommodates_party_types = '{}', not_accommodated = '{}', weather_setting = null, suited_age_min = null, suited_age_max = null,
          max_group_size = null, outdoor_capacity = null where id = b;
        msg := null;
        begin
          if dir = 1 then update brand_partners set not_accommodated = array[o.restriction] where id = b; end if;
          if o.kind = 'experience' then
            insert into business_experiences (partner_id, title, attributes, party_type, active) values (b, 'Test night', o.attrs, o.party, o.active);
          else
            insert into business_occasion_packages (partner_id, occasion_type, name, active) values (b, o.occ, 'Test package', o.active);
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
  raise exception E'RESULT\n%', out;
end $$;
rollback;
