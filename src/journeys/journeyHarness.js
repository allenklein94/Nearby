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

// 20270372 (offer safety): a business's offer reply, availability posting or profile text edit needs a screening result
// the screen-business-content edge function recorded for that exact content. A journey plays the business calling those
// functions directly, standing in for the edge function, so by default each call goes through a stand-in that first
// records the low-risk screening result the edge function would (built by the migration's own content functions), then
// calls the real public function. Only where 20270372 is installed; before it, a plain pass-through. A journey that tests
// the binding itself passes { unscreened: true } and calls the functions as a direct client would.
const SCREENED_CALLS = /\b(?:public\.)?(submit_business_offer|post_business_availability|update_business_profile)\s*\(/g;
const SCREENING_STAND_INS = `
create or replace function pg_temp._journey_screened(p_target text, p_builder text, p_args text[]) returns void
language plpgsql security definer set search_path = public as $f$
declare p_content jsonb;
begin
  if to_regprocedure('private.require_business_screening(uuid,text,uuid,jsonb)') is null then return; end if;
  execute format('select private.%I(%s)', p_builder,
    (select string_agg(case when a is null then 'null' else quote_literal(a) end, ', ' order by o)
       from unnest(p_args) with ordinality u(a, o))) into p_content;
  insert into business_content_screening_results (partner_id, target_type, target_id, submitted_by, content_snapshot,
                                                  risk_tier, model_reasoning, source)
  select p.managed_partner_id, p_target, null, auth.uid(), p_content, 'low', 'journey stand-in for screen-business-content', 'submission'
    from profiles p where p.id = auth.uid() and p.managed_partner_id is not null;
end $f$;
create or replace function pg_temp.j_submit_business_offer(request_id_param uuid, offer_type_param text, offer_description_param text,
  offer_price_param numeric default null, proposed_time_param timestamptz default null, experience_id_param uuid default null,
  media_path_param text default null, media_type_param text default null, offer_title_param text default null,
  included_items_param text[] default '{}', price_is_per_person_param boolean default false, discount_pct_param numeric default null,
  redemption_instructions_param text default null, media_poster_path_param text default null, creative_id_param uuid default null,
  valid_until_param timestamptz default null, available_from_param time default null, available_until_param time default null,
  proposed_time_alt_param timestamptz default null, proposed_party_size_alt_param smallint default null)
returns jsonb language plpgsql as $f$
begin
    perform pg_temp._journey_screened('offer_response', 'screening_content_offer_response', array[request_id_param::text,
      offer_description_param, offer_title_param, coalesce(included_items_param, '{}')::text, redemption_instructions_param,
      media_path_param, media_type_param, media_poster_path_param, creative_id_param::text]);
  return public.submit_business_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20);
end $f$;
create or replace function pg_temp.j_post_business_availability(category_param text, title_param text, description_param text,
  offer_type_param text, price_param numeric, capacity_param integer, starts_at_param timestamptz, ends_at_param timestamptz,
  radius_miles_param double precision default 15, bundle_occasion_param text default null, bundle_components_param text[] default null,
  discount_pct_param numeric default null)
returns jsonb language plpgsql as $f$
begin
    perform pg_temp._journey_screened('availability', 'screening_content_availability', array[title_param, description_param]);
  return public.post_business_availability($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
end $f$;
create or replace function pg_temp.j_update_business_profile(partner_id_param uuid, name_param text, description_param text,
  address_param text, latitude_param double precision, longitude_param double precision, logo_url_param text,
  category_param text default null, attributes_param text[] default null, cuisine_param text default null,
  differentiator_param text default null, subcategory_param text default null, categories_param text[] default null)
returns void language plpgsql as $f$
begin
    perform pg_temp._journey_screened('business_profile', 'screening_content_profile', array[name_param, description_param,
      logo_url_param, differentiator_param]);
  perform public.update_business_profile($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
end $f$;
`;

// 20270373 (user-content screening): every consumer text a journey's people write (profile text, gathering titles and
// descriptions, communities, Q&A, photo comments) needs a screening the screen-user-content edge function recorded. Inside
// the rolled-back transaction the ONE lookup the binding reads is replaced to answer "publish", so journeys about other
// stories keep writing as before. Only where 20270373 is installed. Journey `ugcModeration` passes
// { realUgcScreening: true } and proves the binding against the real lookup.
const UGC_STAND_IN = `
do $ugc$ begin
  if to_regprocedure('private.ugc_screening_lookup(uuid,text,boolean)') is not null then
    execute $x$create or replace function private.ugc_screening_lookup(p_user uuid, p_sha text, p_is_name boolean)
      returns text language sql stable as $y$ select 'publish'::text $y$$x$;
  end if;
end $ugc$;
`;

async function runJourney(declare, rawBody, { unscreened = false, realUgcScreening = false } = {}) {
  const body = unscreened ? rawBody : rawBody.replace(SCREENED_CALLS, 'pg_temp.j_$1(');
  const sql = `${prelude()}${SCREENING_STAND_INS}${realUgcScreening ? '' : UGC_STAND_IN}do $j$ declare log jsonb := '[]'::jsonb; ${declare}
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

// A FIXTURE phone write on auth.users (clearing or moving a test actor's number). From 20270375 the takeover guard refuses a
// number change without a permit, as it must for Auth; journeys set up their state the way admin_recover_account does: the
// per-transaction recovery marker, for this one statement only (absent before 0375 = the plain statement).
const fixturePhoneWrite = (stmt) => `
  if to_regclass('private.account_recovery_marker') is not null then
    execute 'insert into private.account_recovery_marker (txid) values (txid_current()) on conflict do nothing';
  end if;
  ${stmt}
  if to_regclass('private.account_recovery_marker') is not null then
    execute 'delete from private.account_recovery_marker where txid = txid_current()';
  end if;`;

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

// 20270362 (gathering creation limits, 5 / 15 a day): a journey whose fixture hosts create many gatherings to tell ANOTHER
// story lifts only that rule inside its own rolled-back transaction (no-op before 0356's table exists). Never in a journey
// about limits; journey `gatheringCreationLimits` proves the rule itself.
const LIFT_GATHERING_CREATION_LIMIT = `if to_regclass('private.rate_limit_rules') is not null then
    execute 'delete from private.rate_limit_rules where action = ''gathering_create''';
  end if;`;

// A stored report reason, read back: the English value the app sends, or its stable code once 20270370 is installed
// (prod before it, or a prelude with it). Matches either, never anything else.
const { reportReasonCode } = require('../utils/reportReasons');
function storedReason(legacy) {
  return expect.stringMatching(new RegExp(`^(${legacy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${reportReasonCode(legacy)})$`));
}


// 20270382 (people anti-scraping): another person's profile is readable only with a reason (friends, a shared gathering,
// crossed paths, ...) or after Nearby SHOWED them to the viewer through a capped discovery function. A journey about
// something else whose viewer reads an unrelated person records that neutral reason, "Nearby showed them" (no-op before
// 0382, so the journey still runs on older databases). Never in a journey about who may read whom.
const profileReadGrant = (viewer, targets) => `if to_regclass('private.profile_served') is not null then
    execute 'insert into private.profile_served (viewer_id, target_id, via) select $1, t, ''dating_browse'' from unnest($2::uuid[]) t on conflict do nothing'
      using ${viewer}, array[${targets.join(', ')}]::uuid[];
  end if;`;


// 20270384: a crossing is recorded only between two people who BOTH turned Crossed Paths on and both have a fresh eligible
// presence cell (within one tile of each other). Journeys that write sightings call this first for the people involved;
// on an older database (no consent table) only the presence report is made, which changes nothing there. `people` are
// plpgsql variable names; every person reports the same cell, so each sighting written with approx_area = `area` passes.
const CROSSING_AREA = '40.0001,-75.0001';
function crossingReady(people, area = CROSSING_AREA) {
  const arr = `array[${people.join(', ')}]::uuid[]`;
  return `
  if to_regclass('private.crossed_paths_consent') is not null then
    execute 'insert into private.crossed_paths_consent (user_id) select unnest($1) on conflict do nothing' using ${arr};
  end if;
  insert into presence_reports (user_id, area, reported_at) select cr_u, '${area}', now() from unnest(${arr}) cr_u
    on conflict (user_id) do update set area = excluded.area, reported_at = excluded.reported_at;`;
}

module.exports = { crossingReady, CROSSING_AREA, runJourney, stepMap, hasToken, actorDeclares, actorsSql, journeyPeople, journeyOwner, JOURNEY_PHONE_SET, fixturePhoneWrite, LIFT_GATHERING_CREATION_LIMIT, storedReason, profileReadGrant };
