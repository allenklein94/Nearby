// First real-phone session test data (owner, 2026-10-23): shared config, ids and SQL for seed.js + cleanup.js.
// Run order: PRODUCT_AUDIT/FIRST_PHONE_SESSION_RUN_ORDER_2026-10-23.md (setup S4-S6). Never adds product behaviour.
//
// Every seeded row has a FIXED id derived from md5('nearby-phone-session-2026-10-23/' || key) (idSql). That makes the seed idempotent
// (insert only when the id is absent) and lets cleanup find exactly what the seed made, nothing else.
// Visible markers: emails @phone-session.nearby.invalid (cannot receive mail, cannot sign in), names and titles end "(test)".
const { runSql } = require('../live-verify/lib/db');
const crypto = require('crypto');

const NAMESPACE = 'nearby-phone-session-2026-10-23';
const EMAIL_DOMAIN = 'phone-session.nearby.invalid';

const isLocal = () => !!process.env.NEARBY_LOCAL_DB_URL;
const target = () => (isLocal() ? `LOCAL test database (${process.env.NEARBY_LOCAL_DB_URL.replace(/:[^:@/]*@/, ':***@')})` : 'PRODUCTION (enmosvippabmuqslzrox)');

const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
// shaped as a version-4 uuid (version and variant nibbles fixed) so any client-side uuid check accepts it
const idSql = (key) => `overlay(overlay(md5('${NAMESPACE}/${key}') placing '4' from 13) placing '8' from 17)::uuid`;
const idOf = (key) => {
  const m = crypto.createHash('md5').update(`${NAMESPACE}/${key}`).digest('hex');
  const h = `${m.slice(0, 12)}4${m.slice(13, 16)}8${m.slice(17)}`;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const hash = (obj) => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 12);

// The three test people. They exist only as hosts/attendees/the friend; nobody signs in as them.
const PEOPLE = [
  { key: 'person/maya', name: 'Maya (test)', interests: ['Coffee', 'Pickleball'] },
  { key: 'person/jordan', name: 'Jordan (test)', interests: ['Live Music', 'Pickleball'] },
  { key: 'person/sam', name: 'Sam (test)', interests: ['Pickleball', 'Live Music', 'Coffee'] },
];

// Gatherings across the run order's S4 windows. day: 'today' | 'tomorrow' | 'friday' | 'saturday' | 'next_week' (that week's
// Wednesday); at: local 'HH:MM', or 'soon' = session start + 45 min (C10's "starting within the hour").
// north/east = miles from the seed point (spread so pins and "About x mi" differ).
const GATHERINGS = [
  { key: 'gathering/soon-coffee', host: 'person/maya', title: 'Coffee & chat (test)', tag: 'Coffee', day: 'today', at: 'soon', minutes: 60, cap: 6, north: 0.5, east: 0.3 },
  { key: 'gathering/tonight-music', host: 'person/jordan', title: 'Live music on the patio (test)', tag: 'Live Music', day: 'today', at: '19:30', minutes: 120, cap: 20, north: -0.8, east: 0.6 },
  { key: 'gathering/tomorrow-pickleball', host: 'person/sam', title: 'Morning pickleball (test)', tag: 'Pickleball', day: 'tomorrow', at: '09:00', minutes: 90, cap: 8, north: 1.2, east: -0.4 },
  { key: 'gathering/tomorrow-coffee', host: 'person/maya', title: 'Afternoon coffee meetup (test)', tag: 'Coffee', day: 'tomorrow', at: '15:00', minutes: 60, cap: 6, north: -0.3, east: -0.9 },
  { key: 'gathering/friday-pickleball', host: 'person/jordan', title: 'Friday afternoon pickleball (test)', tag: 'Pickleball', day: 'friday', at: '14:00', minutes: 90, cap: 8, north: 2.0, east: 1.0 },
  { key: 'gathering/saturday-pickleball', host: 'person/maya', title: 'Saturday pickleball, approval needed (test)', tag: 'Pickleball', day: 'saturday', at: '10:00', minutes: 90, cap: 6, north: -1.5, east: -1.2, approval: true },
  { key: 'gathering/saturday-music', host: 'person/sam', title: 'Saturday night live music (test)', tag: 'Live Music', day: 'saturday', at: '20:00', minutes: 120, cap: 30, north: 0.9, east: 1.8 },
  { key: 'gathering/next-week-coffee', host: 'person/jordan', title: 'Next week coffee (test)', tag: 'Coffee', day: 'next_week', at: '08:30', minutes: 60, cap: 6, north: -2.2, east: 0.4 },
];
// Joins (through join_gathering as the attendee), so a few "N attending" figures are real.
const JOINS = [
  ['person/jordan', 'gathering/tomorrow-pickleball'],
  ['person/maya', 'gathering/saturday-music'],
  ['person/sam', 'gathering/friday-pickleball'],
];
const BUSINESS_KEY = 'business/coffee';

function config() {
  const e = process.env;
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const c = {
    lat: num(e.SEED_LAT),
    lng: num(e.SEED_LNG),
    tz: e.SEED_TZ || 'America/New_York',
    sessionDate: e.SESSION_DATE || null, // YYYY-MM-DD, local; default = today in SEED_TZ
    sessionStart: e.SESSION_START || null, // HH:MM, local; default = now
    friendEmail: e.FRIEND_ACCOUNT_EMAIL || null, // the owner's S6 (b) account: becomes Sam's accepted friend
    ownerEmail: e.BUSINESS_OWNER_EMAIL || null, // the account that will run the test business (signed in on the web)
    businessName: e.BUSINESS_NAME || 'Harbor Coffee (test)',
    businessAddress: e.BUSINESS_ADDRESS || 'Test business, not a real address',
    businessLat: num(e.BUSINESS_LAT),
    businessLng: num(e.BUSINESS_LNG),
  };
  const problems = [];
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng) || Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180) problems.push('SEED_LAT and SEED_LNG (where the phone will be) are required');
  if (c.sessionDate && !/^\d{4}-\d{2}-\d{2}$/.test(c.sessionDate)) problems.push('SESSION_DATE must be YYYY-MM-DD');
  if (c.sessionStart && !/^\d{2}:\d{2}$/.test(c.sessionStart)) problems.push('SESSION_START must be HH:MM (24 h)');
  if (!isLocal() && (!c.sessionDate || !c.sessionStart)) problems.push('on production, SESSION_DATE and SESSION_START are required (so the approved plan cannot drift)');
  for (const em of [c.friendEmail, c.ownerEmail]) if (em && em.toLowerCase().endsWith(EMAIL_DOMAIN)) problems.push(`${em} is a test address, not a real account`);
  if (c.friendEmail && c.ownerEmail && c.friendEmail.toLowerCase() === c.ownerEmail.toLowerCase()) problems.push('FRIEND_ACCOUNT_EMAIL and BUSINESS_OWNER_EMAIL must be different accounts');
  if (problems.length) {
    console.error(`Missing or invalid settings:\n- ${problems.join('\n- ')}`);
    process.exit(2);
  }
  // business pin: given, else 0.6 mi north-east of the seed point
  if (!Number.isFinite(c.businessLat) || !Number.isFinite(c.businessLng)) {
    const o = offset(c, 0.45, 0.4);
    c.businessLat = o.lat;
    c.businessLng = o.lng;
  }
  return c;
}

function offset(c, northMiles, eastMiles) {
  const lat = c.lat + northMiles / 69.0;
  const lng = c.lng + eastMiles / (69.0 * Math.cos((c.lat * Math.PI) / 180));
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

// SQL expression for a gathering's start (timestamptz), computed in the database in the session's time zone.
function startSql(c, g) {
  const d0 = c.sessionDate ? `date ${q(c.sessionDate)}` : `(now() at time zone ${q(c.tz)})::date`;
  const s0 = c.sessionStart ? `(${d0} + time ${q(c.sessionStart)})` : `(now() at time zone ${q(c.tz)})::timestamp`;
  const dow = `extract(dow from ${d0})::int`;
  const day = {
    today: d0,
    tomorrow: `(${d0} + 1)`,
    friday: `(${d0} + ((5 - ${dow} + 7) % 7))`, // the next Friday incl. today (namedDayFromText's "Friday")
    saturday: `(${d0} + ((6 - ${dow} + 7) % 7))`,
    next_week: `(${d0} + (7 - ((${dow} + 6) % 7)) + 2)`, // Wednesday of the following Mon-Sun week
  }[g.day];
  const local = g.at === 'soon'
    ? `(date_trunc('hour', ${s0}) + interval '5 min' * ceil(extract(minute from ${s0}) / 5.0) + interval '45 min')`
    : `(${day} + time ${q(g.at)})`;
  return `(${local} at time zone ${q(c.tz)})`;
}

// Read-only: what the seed would create (and what already exists), as rows.
function planSql(c) {
  const gRows = GATHERINGS.map((g) => {
    const p = offset(c, g.north, g.east);
    return `select ${q(g.key)} as key, ${idSql(g.key)} as id, ${q(g.title)} as title, ${q(g.tag)} as tag,
      to_char(${startSql(c, g)} at time zone ${q(c.tz)}, 'Dy YYYY-MM-DD HH24:MI') as starts_local, ${startSql(c, g)} < now() + interval '10 min' as too_soon,
      ${q(PEOPLE.find((x) => x.key === g.host).name)} as host, ${g.cap} as capacity, ${g.approval ? "'approval'" : "'open'"} as joining, ${p.lat} as lat, ${p.lng} as lng,
      exists (select 1 from gatherings where id = ${idSql(g.key)}) as exists_already`;
  }).join('\nunion all\n');
  return `select jsonb_build_object(
  'now_local', to_char(now() at time zone ${q(c.tz)}, 'Dy YYYY-MM-DD HH24:MI'),
  'people', (select jsonb_agg(x) from (${PEOPLE.map((p) => `select ${q(p.key)} as key, ${idSql(p.key)} as id, ${q(p.name)} as name, ${q(`${p.key.split('/')[1]}@${EMAIL_DOMAIN}`)} as email, exists (select 1 from auth.users where id = ${idSql(p.key)}) as exists_already`).join(' union all ')}) x),
  'gatherings', (select jsonb_agg(x order by starts_local) from (${gRows}) x),
  'business', jsonb_build_object('id', ${idSql(BUSINESS_KEY)}, 'name', ${q(c.businessName)}, 'address', ${q(c.businessAddress)}, 'lat', ${c.businessLat}, 'lng', ${c.businessLng},
     'exists_already', exists (select 1 from brand_partners where id = ${idSql(BUSINESS_KEY)})),
  'friend_account', ${c.friendEmail ? `(select jsonb_build_object('email', ${q(c.friendEmail)}, 'found', count(*) = 1, 'id', min(id::text)) from auth.users where lower(email) = lower(${q(c.friendEmail)}))` : 'null'},
  'business_owner_account', ${c.ownerEmail ? `(select jsonb_build_object('email', ${q(c.ownerEmail)}, 'found', count(*) = 1, 'has_profile', bool_and(p.id is not null),
       'manages_other_business', bool_or(p.managed_partner_id is not null and p.managed_partner_id <> ${idSql(BUSINESS_KEY)}))
     from auth.users u left join profiles p on p.id = u.id where lower(u.email) = lower(${q(c.ownerEmail)}))` : 'null'}
) as plan`;
}

// The seed itself: ONE DO block (all or nothing). Rows that already exist are left exactly as they are.
function seedSql(c) {
  const people = PEOPLE.map((p, i) => `
  if not exists (select 1 from auth.users where id = ${idSql(p.key)}) then
    insert into auth.users (id, aud, role, email, created_at) values (${idSql(p.key)}, 'authenticated', 'authenticated', ${q(`${p.key.split('/')[1]}@${EMAIL_DOMAIN}`)}, now());
    insert into profiles (id, display_name, birthdate, terms_accepted_at, timezone, interests, bio)
      values (${idSql(p.key)}, ${q(p.name)}, date '${1988 + i}-04-1${i}', now(), ${q(c.tz)}, array[${p.interests.map(q).join(',')}]::text[],
              'Test account for the first phone session. Not a real person.');
    created := created || jsonb_build_array(${q(p.key)});
  end if;`).join('');
  const gatherings = GATHERINGS.map((g) => {
    const p = offset(c, g.north, g.east);
    return `
  if not exists (select 1 from gatherings where id = ${idSql(g.key)}) then
    if ${startSql(c, g)} < now() + interval '10 min' then
      skipped := skipped || jsonb_build_array(${q(g.key)});
    else
      perform set_config('request.jwt.claims', json_build_object('sub', ${idSql(g.host)}, 'role', 'authenticated')::text, true);
      set local role authenticated;
      -- the app's own insert (services/gatherings.js createGathering, a placed pin), as the host, through RLS and every trigger
      insert into gatherings (id, host_id, title, description, interest_tag, area, wide_area, precise_lat, precise_lng, location_source,
        scheduled_at, is_public, requires_approval, show_on_map, visibility, discoverable, capacity, duration_minutes)
      values (${idSql(g.key)}, ${idSql(g.host)}, ${q(g.title)}, 'Nearby test gathering for the first phone session. Not a real event.', ${q(g.tag)},
        ${q(`${Math.round(p.lat * 100) / 100},${Math.round(p.lng * 100) / 100}`)}, ${q(`${Math.round(p.lat * 10) / 10},${Math.round(p.lng * 10) / 10}`)},
        ${p.lat}, ${p.lng}, 'host_pin', ${startSql(c, g)}, true, ${g.approval ? 'true' : 'false'}, true, 'everyone', true, ${g.cap}, ${g.minutes});
      reset role;
      created := created || jsonb_build_array(${q(g.key)});
    end if;
  end if;`;
  }).join('');
  const joins = JOINS.map(([who, g]) => `
  if exists (select 1 from gatherings where id = ${idSql(g)})
     and not exists (select 1 from gathering_interest where gathering_id = ${idSql(g)} and user_id = ${idSql(who)}) then
    perform set_config('request.jwt.claims', json_build_object('sub', ${idSql(who)}, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform join_gathering(${idSql(g)});
    reset role;
    created := created || jsonb_build_array(${q(`join/${who}->${g}`)});
  end if;`).join('');
  const hours = JSON.stringify({ timezone: c.tz, week: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [['07:00', '21:00']]])) });
  return `do $seed$
declare created jsonb := '[]'; skipped jsonb := '[]'; v_owner uuid; v_friend uuid; v_fs uuid;
begin
  perform set_config('app.trusted_update', 'on', true);
  ${people}
  ${gatherings}
  ${joins}
  -- the test Coffee business (as the admin approval path would create it), open 7 AM - 9 PM every day, groups up to 10
  if not exists (select 1 from brand_partners where id = ${idSql(BUSINESS_KEY)}) then
    insert into brand_partners (id, name, description, active, latitude, longitude, location_source, address, category, subcategory, max_group_size, operating_hours)
    values (${idSql(BUSINESS_KEY)}, ${q(c.businessName)}, 'Test business for the first phone session. Not a real business.', true,
            ${c.businessLat}, ${c.businessLng}, 'host_pin', ${q(c.businessAddress)}, 'food_drink', 'Coffee', 10, ${q(hours)}::jsonb);
    created := created || jsonb_build_array(${q(BUSINESS_KEY)});
  end if;
  ${c.ownerEmail ? `
  select id into v_owner from auth.users where lower(email) = lower(${q(c.ownerEmail)});
  if v_owner is null or not exists (select 1 from profiles where id = v_owner) then
    raise exception 'BUSINESS_OWNER_EMAIL % has no Nearby account yet: sign in once with it first', ${q(c.ownerEmail)};
  end if;
  if exists (select 1 from profiles where id = v_owner and managed_partner_id is not null and managed_partner_id <> ${idSql(BUSINESS_KEY)}) then
    raise exception 'BUSINESS_OWNER_EMAIL % already manages another business; refusing to change it', ${q(c.ownerEmail)};
  end if;
  if exists (select 1 from profiles where managed_partner_id = ${idSql(BUSINESS_KEY)} and id <> v_owner) then
    raise exception 'the test business is already linked to a different account; run cleanup first';
  end if;
  if not exists (select 1 from profiles where id = v_owner and managed_partner_id = ${idSql(BUSINESS_KEY)}) then
    update profiles set managed_partner_id = ${idSql(BUSINESS_KEY)} where id = v_owner;
    created := created || jsonb_build_array('link/business-owner');
  end if;` : ''}
  ${c.friendEmail ? `
  select id into v_friend from auth.users where lower(email) = lower(${q(c.friendEmail)});
  if v_friend is null or not exists (select 1 from profiles where id = v_friend) then
    raise exception 'FRIEND_ACCOUNT_EMAIL % has no Nearby account yet: sign in once with it first', ${q(c.friendEmail)};
  end if;
  select id into v_fs from friendships where (user_a, user_b) in ((v_friend, ${idSql('person/sam')}), (${idSql('person/sam')}, v_friend));
  if v_fs is null then
    -- written as already accepted, so the real account gets no "wants to be friends" push for a request it never saw;
    -- then the chat row exactly as the accept trigger (create_match_on_friendship_accepted) makes it
    insert into friendships (id, user_a, user_b, status, requested_by) values (${idSql('friendship/sam')}, ${idSql('person/sam')}, v_friend, 'accepted', ${idSql('person/sam')});
    insert into matches (user_a, user_b, source_friendship_id)
      values (least(${idSql('person/sam')}, v_friend), greatest(${idSql('person/sam')}, v_friend), ${idSql('friendship/sam')})
      on conflict (user_a, user_b) do update set source_friendship_id = excluded.source_friendship_id where matches.source_friendship_id is null;
    created := created || jsonb_build_array('friendship/sam');
  elsif v_fs <> ${idSql('friendship/sam')} then
    raise exception 'that account already has a friendship row with Sam (test) that the seed did not make; refusing';
  end if;` : ''}
  perform set_config('phone_session.created', created::text, false);
  perform set_config('phone_session.skipped', skipped::text, false);
end $seed$;
select jsonb_build_object('created', current_setting('phone_session.created')::jsonb, 'skipped_time_passed', current_setting('phone_session.skipped')::jsonb) as result`;
}

// What exists now: every seeded row by its fixed id.
function statusSql() {
  const gIds = GATHERINGS.map((g) => idSql(g.key)).join(',');
  const pIds = PEOPLE.map((p) => idSql(p.key)).join(',');
  return `select jsonb_build_object(
  'people', (select count(*) from auth.users where id in (${pIds})),
  'profiles', (select count(*) from profiles where id in (${pIds})),
  'gatherings', (select count(*) from gatherings where id in (${gIds})),
  'gathering_titles', (select coalesce(jsonb_agg(title || ' @ ' || to_char(scheduled_at, 'YYYY-MM-DD HH24:MI TZ') order by scheduled_at), '[]') from gatherings where id in (${gIds})),
  'gatherings_by_test_hosts', (select count(*) from gatherings where host_id in (${pIds})),
  'business', (select count(*) from brand_partners where id = ${idSql(BUSINESS_KEY)}),
  'business_owner_links', (select count(*) from profiles where managed_partner_id = ${idSql(BUSINESS_KEY)}),
  'friendships_with_test_people', (select count(*) from friendships where user_a in (${pIds}) or user_b in (${pIds}))
) as status`;
}

// Cleanup. Deletes only: the seeded gatherings, the seeded business, the three seeded people (their profiles and every row
// that cascades from them), after un-linking the business owner. Measured, not guessed: every table's row count is taken
// before and after inside one REPEATABLE READ transaction, so the diff is exactly what the deletes (and their cascades /
// triggers) change. dryRun = always rolled back; otherwise it commits ONLY if the diff hashes to `expect`.
function cleanupSql({ dryRun, expect = null }) {
  const gIds = GATHERINGS.map((g) => idSql(g.key)).join(',');
  const pIds = PEOPLE.map((p) => idSql(p.key)).join(',');
  const B = idSql(BUSINESS_KEY);
  return `begin isolation level repeatable read;
create temp table _ps_before (cnt bigint, tbl text) on commit drop;
create temp table _ps_report (report jsonb) on commit drop;
do $clean$
declare r record; k bigint; diff jsonb := '{}'; swept jsonb := '{}'; real_activity jsonb; d text;
  ids uuid[] := array[${gIds}, ${pIds}, ${B}, ${idSql('friendship/sam')}];
begin
  for r in select c.oid::regclass::text as t from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where c.relkind in ('r', 'p') and not c.relispartition and s.nspname in ('public', 'private', 'auth', 'storage') loop
    execute format('select count(*) from %s', r.t) into k;
    insert into _ps_before values (k, r.t);
  end loop;

  -- rows REAL (non-test) accounts made on the test objects during the session; they go with those objects
  real_activity := jsonb_build_object(
    'joins_or_requests_on_test_gatherings', (select count(*) from gathering_interest where gathering_id in (${gIds}) and user_id not in (${pIds})),
    'interested_marks_on_test_gatherings', (select count(*) from gathering_interested where gathering_id in (${gIds}) and user_id not in (${pIds})),
    'requests_that_reached_the_test_business', (select count(distinct o.request_id) from business_request_offers o where o.partner_id = ${B}),
    'request_rows_to_the_test_business', (select count(*) from business_request_offers where partner_id = ${B}));

  update profiles set managed_partner_id = null where managed_partner_id = ${B};
  -- attendance first, so deleting the gatherings sends no "A gathering was cancelled" push to anyone who joined during the session
  delete from gathering_interest where gathering_id in (${gIds});
  delete from gathering_interested where gathering_id in (${gIds});
  delete from gatherings where id in (${gIds});
  delete from gatherings where host_id in (${pIds});  -- anything a test person hosts (none beyond the seed's own)
  delete from brand_partners where id = ${B};
  delete from auth.users where id in (${pIds});      -- cascades to their profiles and everything that cascades from those
  -- rows still naming a seeded id in a column with no foreign key (queued pushes to test people, logs about test objects)
  for r in select c.table_schema, c.table_name, c.column_name from information_schema.columns c
           join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
           where c.table_schema in ('public', 'private') and c.data_type = 'uuid' loop
    execute format('delete from %I.%I where %I = any($1)', r.table_schema, r.table_name, r.column_name) using ids;
    get diagnostics k = row_count;
    if k > 0 then swept := swept || jsonb_build_object(r.table_schema || '.' || r.table_name || '.' || r.column_name, k); end if;
  end loop;

  for r in select cnt, tbl from _ps_before loop
    execute format('select count(*) from %s', r.tbl) into k;
    if k <> r.cnt then diff := diff || jsonb_build_object(r.tbl, k - r.cnt); end if;
  end loop;
  d := encode(sha256(convert_to(diff::text, 'utf8')), 'hex');
  insert into _ps_report values (jsonb_build_object('row_changes_by_table', diff, 'of_which_unlinked_rows_swept', swept, 'real_account_activity_removed_with_test_objects', real_activity,
    'remaining_seeded', jsonb_build_object('people', (select count(*) from auth.users where id in (${pIds})), 'gatherings', (select count(*) from gatherings where id in (${gIds})),
      'business', (select count(*) from brand_partners where id = ${B})),
    'confirm', left(d, 12), 'dry_run', ${dryRun ? 'true' : 'false'}));
  ${dryRun ? "raise exception 'PHONE_SESSION_DRY_RUN %', (select report::text from _ps_report);" : `if left(d, 12) <> ${q(expect)} then
    raise exception 'PHONE_SESSION_MISMATCH the deletion now differs from the approved dry run (expected %, got %): nothing was deleted. Diff: %', ${q(expect)}, left(d, 12), diff::text;
  end if;`}
end $clean$;
select report from _ps_report;
commit;`;
}

async function run(sql) {
  return runSql(sql);
}

module.exports = { NAMESPACE, EMAIL_DOMAIN, PEOPLE, GATHERINGS, JOINS, BUSINESS_KEY, isLocal, target, config, planSql, seedSql, statusSql, cleanupSql, run, hash, idOf };
