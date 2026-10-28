// Journey tests (item 57): a journey walks ONE real product story across every actor and object, not one button.
// Each journey is a single SQL transaction against the live database that plays every actor in turn (setting the
// caller the way the app's own JWT would), records an ordered step log, and ALWAYS rolls back, so production is never
// changed. Jest then asserts each step by name and applies the client-side rules (the real helpers the screens use) to
// the very rows the database produced. Run: SUPABASE_ACCESS_TOKEN=... npm run journeys   (skipped without a token).
const { runSql } = require('../../scripts/live-verify/lib/db');

// A local replay database (NEARBY_LOCAL_DB_URL) counts as a target too.
const hasToken = !!(process.env.SUPABASE_ACCESS_TOKEN || process.env.NEARBY_LOCAL_DB_URL);

// `body` is plpgsql that may use `log` (jsonb array) and the helper pattern:
//   log := log || jsonb_build_array(jsonb_build_object('step', 'name', 'ok', <boolean>, 'data', <jsonb>));
// JOURNEY_PRELUDE_FILE (optional): SQL run first in the same transaction, e.g. a migration not yet applied, so a
// change can be proven by its journey before it goes live. Everything still rolls back.
function prelude() {
  const f = process.env.JOURNEY_PRELUDE_FILE;
  return f ? `begin;\n${require('fs').readFileSync(f, 'utf8')}\n` : '';
}

async function runJourney(declare, body) {
  const sql = `${prelude()}do $j$ declare log jsonb := '[]'::jsonb; ${declare}
begin
${body}
raise exception 'JOURNEY_LOG %', log::text;
end $j$;`;
  try {
    await runSql(sql);
  } catch (e) {
    const m = /JOURNEY_LOG (\[.*\])/s.exec(e.message || '');
    if (m) return JSON.parse(m[1]);
    throw e;
  }
  throw new Error('journey did not return a log');
}

// step lookup helper for assertions
function stepMap(log) {
  return Object.fromEntries(log.map((s) => [s.step, s]));
}

// Synthetic actors (owner, 2026-10-20): a journey creates its own people, accepted friendships and business INSIDE its
// rolled-back transaction, never picking rows that production happens to hold (so it runs the same on any database).
// `people` are uuid variables the journey declares with actorDeclares; each is like a real signed-up person (signed up in
// the app with a verified phone, photo screened, visible, terms accepted, a timezone and a push token; 20270352 refuses
// social actions without a verified phone). `friends` = pairs of those variables (accepted).
// `business` = { owner, partner, lat, lng, subcategory } (variables + placement): an active business that owner manages.
function actorDeclares(names) {
  return names.map((n) => `${n} uuid := gen_random_uuid();`).join(' ');
}

// Ids for those actors made in Jest (so the client rules can use them), shaped like the rows the old prod reads returned:
// journeyPeople(n) = [{ id }], journeyOwner() = { id, managed_partner_id } (pass both to actorsSql's business).
const { randomUUID } = require('crypto');
const journeyPeople = (n) => Array.from({ length: n }, () => ({ id: randomUUID() }));
const journeyOwner = () => ({ id: randomUUID(), managed_partner_id: randomUUID() });

// A verified phone like an SMS-confirmed app sign-up: a fictional 1555 number derived from the user's id (unique within a
// journey; never a real person's number).
const JOURNEY_PHONE_SET = `phone = '1555' || lpad(((('x0' || substr(md5(id::text), 1, 7))::bit(32)::int) % 100000000)::text, 8, '0'), phone_confirmed_at = now()`;

function actorsSql({ people, friends = [], business = null }) {
  const lines = [`perform set_config('app.trusted_update', 'on', true);`];
  people.forEach((v, i) => {
    lines.push(`insert into auth.users (id, aud, role, email, created_at) values (${v}, 'authenticated', 'authenticated', ${v} || '@journey.invalid', now() - interval '${people.length - i} days');`);
    lines.push(`update auth.users set ${JOURNEY_PHONE_SET} where id = ${v};`);
    lines.push(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden, expo_push_token)
    values (${v}, 'Journey ' || left(${v}::text, 4), date '1994-05-01', now() - interval '${people.length - i} days', now(), 'America/New_York', true, false, 'ExponentPushToken[journey-' || left(${v}::text, 8) || ']');`);
  });
  friends.forEach(([a, b]) => {
    lines.push(`insert into friendships (user_a, user_b, status, requested_by) values (${a}, ${b}, 'accepted', ${a});`);
  });
  if (business) {
    const { owner, partner, lat = 40.0, lng = -75.0, subcategory = 'Coffee' } = business;
    lines.push(`insert into brand_partners (id, name, active, latitude, longitude, address, category, subcategory, categories, max_group_size)
    values (${partner}, 'Journey Cafe ' || left(${partner}::text, 4), true, ${lat}, ${lng}, '1 Journey St', 'food_drink', '${subcategory}', '{}', 40);`);
    lines.push(`update profiles set managed_partner_id = ${partner} where id = ${owner};`);
  }
  return lines.join('\n  ');
}

module.exports = { runJourney, stepMap, hasToken, actorDeclares, actorsSql, journeyPeople, journeyOwner, JOURNEY_PHONE_SET };
