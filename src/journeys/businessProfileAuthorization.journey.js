// Business Profile authorization (owner, 2026-11-15; with migration 20270423): every save the Business Profile screen makes
// (shared by the app and the business website) goes through a server function that checks the caller manages THAT
// business. This proves it through the real roles the API uses: the business's own manager can save the profile, hours,
// map pin, every other profile setting and the new private phone + website; another business's manager, an ordinary
// signed-in account, a signed-out caller, an account that sets itself as manager, a suspended manager (contact details),
// and direct table writes cannot, and a refused change leaves the rows exactly as they were. Also: phone + website carried
// from the approved application, normalised, readable only by the business's managers and admins, never on brand_partners,
// and the migration's backfill fills a business only from exactly ONE approved application.
// One rolled-back transaction. Not covered here (phone/browser): the form itself, refresh on a device, website <-> app sync
// beyond both reading the same function.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const fs = require('fs');
const path = require('path');
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;
const as = (sub) => `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;`;
const asAnon = `perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;`;
const rec = (step, expr) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', ${expr}));`;
const attempt = (step, sql) => `begin
    ${sql}
    ${rec(step, `jsonb_build_object('result', 'allowed')`)}
  exception when others then
    ${rec(step, `jsonb_build_object('result', 'refused', 'msg', sqlerrm)`)}
  end;`;
// a direct write: allowed only if it really changed a row
const directWrite = (step, sql) => `begin
    ${sql}
    get diagnostics v_n = row_count;
    ${rec(step, `jsonb_build_object('result', case when v_n > 0 then 'allowed' else 'no_rows' end)`)}
  exception when others then
    ${rec(step, `jsonb_build_object('result', 'refused', 'msg', sqlerrm)`)}
  end;`;
const snapshot = (step) => rec(step, `jsonb_build_object(
    'a', (select to_jsonb(b) from brand_partners b where b.id = v_pa),
    'b', (select to_jsonb(b) from brand_partners b where b.id = v_pb),
    'contact', (select coalesce(jsonb_agg(to_jsonb(c) order by c.partner_id), '[]'::jsonb) from private.business_contact_details c where c.partner_id in (v_pa, v_pb)),
    'outsider_manages', (select managed_partner_id from profiles where id = v_out))`);

const HOURS = `jsonb_build_object('timezone', 'America/New_York', 'week', jsonb_build_object('sun', 'closed', 'mon', jsonb_build_array(jsonb_build_array('07:00', '18:00')),
    'tue', jsonb_build_array(jsonb_build_array('07:00', '18:00')), 'wed', jsonb_build_array(jsonb_build_array('07:00', '18:00')),
    'thu', jsonb_build_array(jsonb_build_array('07:00', '18:00')), 'fri', jsonb_build_array(jsonb_build_array('07:00', '18:00')), 'sat', 'closed'))`;

// Every save the Business Profile screen (and its Settings group) makes, with values the manager may save.
const SAVES = (p) => ({
  profile: `perform update_business_profile(partner_id_param => ${p}, name_param => 'Renamed Cafe', description_param => 'New description',
      address_param => '2 New St', latitude_param => 40.001, longitude_param => -75.001, logo_url_param => null, category_param => 'food_drink',
      attributes_param => array['outdoor_seating'], cuisine_param => null, differentiator_param => 'Fresh bread', subcategory_param => 'Coffee',
      categories_param => '{}'::text[]);`,
  hours: `perform set_business_operating_hours(${p}, ${HOURS});`,
  pin: `perform set_business_location(${p}, 40.002, -75.002, 'host_pin', null);`,
  contact: `perform set_business_contact_details(${p}, '(561) 555-0142', 'Example-Cafe.test/menu');`,
  accommodations: `perform set_business_accommodations(${p}, '{}'::text[]);`,
  booking_mode: `perform set_business_booking_mode(${p}, 'walk_in');`,
  dietary: `perform set_business_dietary_options(${p}, '{}'::text[]);`,
  max_group: `perform set_business_max_group_size(${p}, 12);`,
  not_accommodated: `perform set_business_not_accommodated(${p}, '{}'::text[]);`,
  occasions: `perform set_business_offered_occasions(${p}, '{}'::text[]);`,
  price_level: `perform set_business_price_level(${p}, '$$');`,
  priority_attributes: `perform set_business_priority_attributes(${p}, '{}'::text[]);`,
  priority_occasions: `perform set_business_priority_occasions(${p}, '{}'::text[]);`,
  priority_range: `perform set_business_priority_time_range(${p}, time '17:00', time '21:00');`,
  priority_windows: `perform set_business_priority_time_windows(${p}, '{}'::text[]);`,
  suited_ages: `perform set_business_suited_ages(${p}, null::int, null::int);`,
  typical_spend: `perform set_business_typical_spend(${p}, 20);`,
  want_more: `perform set_business_want_more(${p}, '{}'::text[], '{}'::text[], null::time, null::time, '{}'::text[]);`,
  weather: `perform set_business_weather_setting(${p}, 'outdoor');`,
  pulse: `perform set_business_availability_pulse(${p}, 'open', null);`,
  ai_trust: `perform set_business_ai_trust_level(${p}, 0);`,
  outdoor_space: `perform set_business_space_capacity(${p}, 'outdoor', 10);`,
});
const SAVE_KEYS = Object.keys(SAVES('x'));
const AUTH_REFUSAL = /manage this business|business owner can change|not authori|permission denied/i;

// The migration's own backfill statement, run against this journey's fixtures (the real migration ran before them).
const MIGRATION = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270423_business_contact_details.sql'), 'utf8');
const BACKFILL = MIGRATION.slice(MIGRATION.indexOf('-- Backfill:')).trim();

d('journey: only a business’s own managers can change its profile, hours, pin and contact details', () => {
  let s;
  beforeAll(async () => {
    const people = ['v_admin', 'v_ma', 'v_ma2', 'v_mb', 'v_out', 'v_cust'];
    const log = await runJourney(`${actorDeclares(people)} v_pa uuid; v_pb uuid; v_req uuid; v_n int;
      v_b1 uuid := gen_random_uuid(); v_b2 uuid := gen_random_uuid(); v_b3 uuid := gen_random_uuid();`, `
  ${actorsSql({ people })}
  update profiles set is_admin = true where id = v_admin;

  -- business A comes from an approved application that carried a phone + website (as the sign-up form stores them)
  ${as('v_ma')}
  insert into business_partner_requests (requester_id, business_name, category, subcategory, address, latitude, longitude, location_source, phone, website)
    values (auth.uid(), 'Journey Auth Cafe', 'food_drink', 'Coffee', '1 Journey St', 40.0, -75.0, 'host_pin', '+1 561-555-0100', 'journeycafe.test')
    returning id into v_req;
  reset role;
  ${as('v_admin')}
  v_pa := approve_business_partner_request(v_req);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.trusted_update', 'on', true);
  update profiles set managed_partner_id = v_pa where id = v_ma2;
  insert into brand_partners (id, name, active, latitude, longitude, address, category, subcategory, categories, max_group_size)
    values (gen_random_uuid(), 'Journey Other Cafe', true, 40.1, -75.1, '9 Other St', 'food_drink', 'Coffee', '{}', 40) returning id into v_pb;
  update profiles set managed_partner_id = v_pb where id = v_mb;
  perform set_config('app.trusted_update', 'off', true);

  ${rec('carried', `(select to_jsonb(c) - 'updated_at' - 'partner_id' from private.business_contact_details c where c.partner_id = v_pa)`)}
  ${rec('managed', `jsonb_build_object('ma', (select managed_partner_id = v_pa from profiles where id = v_ma), 'ma2', (select managed_partner_id = v_pa from profiles where id = v_ma2))`)}
  ${rec('no_public_columns', `(select coalesce(jsonb_agg(column_name), '[]'::jsonb) from information_schema.columns
      where table_schema = 'public' and table_name = 'brand_partners' and column_name in ('phone', 'website', 'contact_phone', 'contact_website'))`)}
  ${snapshot('before')}

  -- reads of the private phone + website
  ${as('v_ma')}  ${attempt('read_manager', `${rec('read_manager_row', `(select to_jsonb(r) - 'updated_at' from get_business_contact_details(v_pa) r)`)}`)}  reset role;
  ${as('v_admin')}  ${attempt('read_admin', `${rec('read_admin_row', `(select to_jsonb(r) - 'updated_at' from get_business_contact_details(v_pa) r)`)}`)}  reset role;
  ${as('v_mb')}  ${attempt('read_other_manager', `perform get_business_contact_details(v_pa);`)}  reset role;
  ${as('v_cust')}  ${attempt('read_customer', `perform get_business_contact_details(v_pa);`)}  reset role;
  ${as('v_cust')}  ${attempt('read_table_direct', `perform (select count(*) from private.business_contact_details);`)}  reset role;
  ${asAnon}  ${attempt('read_anon', `perform get_business_contact_details(v_pa);`)}  reset role;

  -- every save, attempted on business A by people who don't manage it
  ${SAVE_KEYS.map((k) => `${as('v_out')} ${attempt(`out_${k}`, SAVES('v_pa')[k])} reset role;`).join('\n  ')}
  ${SAVE_KEYS.map((k) => `${as('v_mb')} ${attempt(`other_${k}`, SAVES('v_pa')[k])} reset role;`).join('\n  ')}
  ${['profile', 'hours', 'pin', 'contact'].map((k) => `${asAnon} ${attempt(`anon_${k}`, SAVES('v_pa')[k])} reset role;`).join('\n  ')}
  -- admins review businesses, they don't edit their contact details
  ${as('v_admin')} ${attempt('admin_contact', SAVES('v_pa').contact)} reset role;

  -- direct writes through the API's table access, by an outsider and by the manager
  ${as('v_out')}
  ${directWrite('direct_out_update', `update brand_partners set name = 'Hijacked', operating_hours = null, latitude = 1, longitude = 1 where id = v_pa;`)}
  ${directWrite('direct_out_delete', `delete from brand_partners where id = v_pa;`)}
  ${directWrite('direct_out_contact', `update private.business_contact_details set phone = '5615550199' where partner_id = v_pa;`)}
  ${directWrite('direct_out_contact_insert', `insert into private.business_contact_details (partner_id, phone) values (v_pb, '5615550199');`)}
  reset role;
  ${as('v_ma')}
  ${directWrite('direct_manager_update', `update brand_partners set name = 'Direct Rename' where id = v_pa;`)}
  reset role;

  -- an outsider makes itself the manager, then tries to save
  ${as('v_out')}
  ${directWrite('self_manager', `update profiles set managed_partner_id = v_pa where id = auth.uid();`)}
  ${attempt('self_manager_profile', SAVES('v_pa').profile)}
  ${attempt('self_manager_hours', SAVES('v_pa').hours)}
  ${attempt('self_manager_contact', SAVES('v_pa').contact)}
  reset role;

  -- invalid values from the real manager: refused, nothing changed
  ${as('v_ma')}
  ${attempt('bad_phone', `perform set_business_contact_details(v_pa, 'call me', null);`)}
  ${attempt('bad_website', `perform set_business_contact_details(v_pa, null, 'javascript:alert(1)');`)}
  ${attempt('bad_website_login', `perform set_business_contact_details(v_pa, null, 'https://user:pw@evil.test');`)}
  reset role;

  ${snapshot('after_refusals')}

  -- a suspended second manager
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.trusted_update', 'on', true);
  update profiles set suspended_at = now() where id = v_ma2;
  perform set_config('app.trusted_update', 'off', true);
  ${as('v_ma2')} ${attempt('suspended_contact', SAVES('v_pa').contact)} reset role;
  ${snapshot('after_suspended')}

  -- the business's own manager saves everything
  ${SAVE_KEYS.map((k) => `${as('v_ma')} ${attempt(`manager_${k}`, SAVES('v_pa')[k])} reset role;`).join('\n  ')}
  ${rec('saved', `(select jsonb_build_object('name', name, 'description', description, 'address', address, 'lat', latitude, 'lng', longitude,
      'source', location_source, 'hours_mon', operating_hours->'week'->'mon', 'tz', operating_hours->>'timezone', 'max_group', max_group_size,
      'price', price_level, 'weather', weather_setting, 'booking', booking_mode) from brand_partners where id = v_pa)`)}
  -- a later read (what a refresh, or the other client, sees)
  ${as('v_ma')} ${rec('reread_contact', `(select to_jsonb(r) - 'updated_at' from get_business_contact_details(v_pa) r)`)} reset role;
  -- clearing both
  ${as('v_ma')} ${attempt('manager_clear', `perform set_business_contact_details(v_pa, '', '  ');`)}
  ${rec('cleared', `(select to_jsonb(r) - 'updated_at' from get_business_contact_details(v_pa) r)`)} reset role;
  ${snapshot('b_untouched')}

  -- the migration's backfill: one approved application -> filled; two approved applications for one business -> left
  -- empty (ambiguous); unusable values -> left empty
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.trusted_update', 'on', true);
  insert into brand_partners (id, name, active, category, categories) values
    (v_b1, 'Journey Backfill One', true, 'food_drink', '{}'), (v_b2, 'Journey Backfill Two', true, 'food_drink', '{}'),
    (v_b3, 'Journey Backfill Bad', true, 'food_drink', '{}');
  insert into business_partner_requests (requester_id, business_name, category, status, resulting_partner_id, phone, website) values
    (v_cust, 'Journey Backfill One', 'food_drink', 'approved', v_b1, '561.555.0111', 'https://One.test'),
    (v_cust, 'Journey Backfill Two', 'food_drink', 'approved', v_b2, '5615550122', 'two.test'),
    (v_out, 'Journey Backfill Two', 'food_drink', 'approved', v_b2, '5615550133', 'two-b.test'),
    (v_cust, 'Journey Backfill Bad', 'food_drink', 'approved', v_b3, 'n/a', 'not a site');
  ${BACKFILL}
  ${rec('backfill', `jsonb_build_object(
      'one', (select to_jsonb(c) - 'updated_at' - 'partner_id' - 'updated_by' from private.business_contact_details c where c.partner_id = v_b1),
      'two', (select count(*) from private.business_contact_details where partner_id = v_b2),
      'bad', (select count(*) from private.business_contact_details where partner_id = v_b3))`)}`);
    s = stepMap(log);
  }, 120000);

  test('approval carries the application’s phone + website, normalised; never as a column on brand_partners', () => {
    expect(s.carried.data).toMatchObject({ phone: '+15615550100', website: 'https://journeycafe.test' });
    expect(s.managed.data).toEqual({ ma: true, ma2: true });
    expect(s.no_public_columns.data).toEqual([]);
  });

  test('phone + website are read only by the business’s managers and admins', () => {
    expect(s.read_manager.data.result).toBe('allowed');
    expect(s.read_manager_row.data).toEqual({ phone: '+15615550100', website: 'https://journeycafe.test' });
    expect(s.read_admin.data.result).toBe('allowed');
    expect(s.read_admin_row.data).toEqual(s.read_manager_row.data);
    for (const k of ['read_other_manager', 'read_customer', 'read_table_direct', 'read_anon']) {
      expect([k, s[k].data.result]).toEqual([k, 'refused']);
    }
  });

  test('every Business Profile save is refused for an ordinary account and for another business’s manager', () => {
    for (const k of SAVE_KEYS) {
      for (const who of ['out', 'other']) {
        const r = s[`${who}_${k}`].data;
        expect([who, k, r.result]).toEqual([who, k, 'refused']);
        expect([who, k, AUTH_REFUSAL.test(r.msg)]).toEqual([who, k, true]);
      }
    }
  });

  test('signed-out callers and admins cannot save', () => {
    for (const k of ['profile', 'hours', 'pin', 'contact']) {
      expect([k, s[`anon_${k}`].data.result]).toEqual([k, 'refused']);
      expect([k, s[`anon_${k}`].data.msg]).toEqual([k, expect.stringMatching(/permission denied|manage this business|business owner/i)]);
    }
    expect(s.admin_contact.data.result).toBe('refused');
  });

  test('direct table writes change nothing, for an outsider or the manager', () => {
    expect(s.direct_out_update.data.result).not.toBe('allowed');
    expect(s.direct_out_delete.data.result).not.toBe('allowed');
    expect(s.direct_out_contact.data.result).toBe('refused');
    expect(s.direct_out_contact_insert.data.result).toBe('refused');
    expect(s.direct_manager_update.data.result).not.toBe('allowed');
  });

  test('an account that sets itself as manager still cannot save', () => {
    for (const k of ['self_manager_profile', 'self_manager_hours', 'self_manager_contact']) {
      expect([k, s[k].data.result]).toEqual([k, 'refused']);
    }
    expect(s.after_refusals.data.outsider_manages).toBeNull();
  });

  test('invalid phone / website values are refused', () => {
    expect(s.bad_phone.data.result).toBe('refused');
    expect(s.bad_website.data.result).toBe('refused');
    expect(s.bad_website_login.data.result).toBe('refused');
  });

  test('every refused change left both businesses and their contact rows exactly as they were', () => {
    expect(s.after_refusals.data).toEqual(s.before.data);
  });

  test('a suspended manager cannot change the contact details', () => {
    expect(s.suspended_contact.data.result).toBe('refused');
    expect(s.suspended_contact.data.msg).toMatch(/suspended/i);
    expect(s.after_suspended.data.contact).toEqual(s.before.data.contact);
  });

  test('the business’s own manager saves every profile setting, hours, pin and contact details', () => {
    for (const k of SAVE_KEYS) {
      expect([k, s[`manager_${k}`].data.result, s[`manager_${k}`].data.msg]).toEqual([k, 'allowed', undefined]);
    }
    expect(s.saved.data).toMatchObject({
      name: 'Renamed Cafe', description: 'New description', address: '2 New St', lat: 40.002, lng: -75.002, source: 'host_pin',
      hours_mon: [['07:00', '18:00']], tz: 'America/New_York', max_group: 12, price: '$$', weather: 'outdoor', booking: 'walk_in',
    });
    expect(s.reread_contact.data).toEqual({ phone: '5615550142', website: 'https://example-cafe.test/menu' });
  });

  test('empty values clear the contact details', () => {
    expect(s.manager_clear.data.result).toBe('allowed');
    expect(s.cleared.data).toEqual({ phone: null, website: null });
  });

  test('the other business was never touched', () => {
    expect(s.b_untouched.data.b).toEqual(s.before.data.b);
  });

  test('backfill fills only from exactly one approved application, with usable values', () => {
    expect(s.backfill.data).toEqual({ one: { phone: '5615550111', website: 'https://one.test' }, two: 0, bad: 0 });
  });
});
