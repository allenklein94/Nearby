-- Verifies migrations 20270222 + 20270224 (item 86 save-time contradictions). Rolled back; results via the exception text.
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
  raise exception E'RESULT\n%', out;
end $$;
rollback;
