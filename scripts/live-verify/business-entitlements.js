// Business Intelligence Phase 8 (see CLAUDE.md) -- real, server-enforced
// business feature entitlements over the existing brand_partners.tier
// column. Proves the config-driven plan_entitlements matrix, the real
// server-side redaction inside get_aggregated_demand_for_partner(), the
// real hard cap inside create_business_experience(), the entitlement-
// gate error inside get_missed_match_summary()/get_partner_category_
// outcomes(), the business_moments INSERT trigger on stories, and the
// admin-only dev tier switch -- all against real disposable test data,
// under real ownership checks, not just that each RPC runs.

const { runSql, runSqlAs, assert, summarize } = require('./lib/db.js');

const PARTNER_ID = '67dd3d6d-f36b-4b20-8a80-ac980baecc30'; // Coastal Coffee
const OWNER_ID = 'ee74f1a9-9996-465d-a674-c60bc63fbfca'; // Allen
const NON_OWNER_ID = '0d7cecd9-721f-4632-8b1f-44b866d1892b'; // Claude
const LAT = 40.3573;
const LNG = -74.6672;

let createdExperienceIds = [];
let createdStoryId = null;
let requestId = null;
let intentSubmissionId = null;

async function main() {
  // Baseline: confirm this real partner starts at 'basic' before any of
  // this test's own tier changes.
  const before = await runSql(`select tier from brand_partners where id = '${PARTNER_ID}';`);
  assert(before[0].tier === 'basic', `test partner starts at real baseline tier (got: ${before[0].tier})`);

  // --- get_business_entitlements: real owner-scoped read ---
  const entOwner = await runSqlAs(OWNER_ID, `select get_business_entitlements('${PARTNER_ID}'::uuid) as e;`);
  const e = entOwner[0].e;
  assert(e.tier === 'basic', 'owner sees the real current tier (basic)');
  assert(e.features.signature_experiences.limit_value === 3, 'basic tier correctly capped at 3 signature experiences');
  assert(e.features.advanced_match_radar.enabled === false, 'basic tier correctly does not get advanced_match_radar');
  assert(e.features.ai_level_2.enabled === false, 'basic tier correctly does not get ai_level_2');

  let rejected = false;
  try {
    await runSqlAs(NON_OWNER_ID, `select get_business_entitlements('${PARTNER_ID}'::uuid);`);
  } catch (err) { rejected = true; }
  assert(rejected, 'a non-owner is rejected reading this business\'s entitlements');

  // --- create_business_experience(): real server-side cap, basic = 3 ---
  for (let i = 0; i < 3; i++) {
    const r = await runSqlAs(OWNER_ID, `select create_business_experience('${PARTNER_ID}'::uuid, 'Test Experience ${i}') as id;`);
    createdExperienceIds.push(r[0].id);
  }
  assert(createdExperienceIds.length === 3, 'basic tier allows exactly 3 signature experiences');

  let capRejected = false;
  let capMessage = '';
  try {
    await runSqlAs(OWNER_ID, `select create_business_experience('${PARTNER_ID}'::uuid, 'Test Experience 4 (over cap)');`);
  } catch (err) { capRejected = true; capMessage = err.message; }
  assert(capRejected && capMessage.includes('ENTITLEMENT_LIMIT:signature_experiences'), `a 4th experience is rejected by the real server-side cap (got: ${capMessage})`);

  // --- get_aggregated_demand_for_partner(): real redaction, not just hiding ---
  await runSql(`update brand_partners set latitude = ${LAT}, longitude = ${LNG} where id = '${PARTNER_ID}';`);
  const r1 = await runSql(`
    insert into business_requests (requester_id, raw_text, category, party_size, date, latitude, longitude, radius_miles, status, expires_at)
    values ('${NON_OWNER_ID}', 'wine tasting please', 'Wine', 2, current_date, ${LAT}, ${LNG}, 15, 'open', now() + interval '2 days')
    returning id;
  `);
  requestId = r1[0].id;

  const demandBasic = await runSqlAs(OWNER_ID, `select * from get_aggregated_demand_for_partner('${PARTNER_ID}'::uuid) where category = 'Wine';`);
  assert(demandBasic.length === 1, 'basic tier still gets the real base rollup (request_count etc.)');
  assert(Number(demandBasic[0].request_count) === 1, 'basic tier sees the real request_count (not redacted)');
  assert(demandBasic[0].is_demand_gap === false, 'basic tier correctly gets is_demand_gap redacted to false, even though this category is genuinely unserved');
  assert(Number(demandBasic[0].unmet_intent_count) === 0, 'basic tier correctly gets unmet_intent_count redacted to 0');

  // admin_set_business_tier needs a real admin caller -- Allen is a real
  // admin, confirmed elsewhere in this file's own live-verify history.
  await runSqlAs(OWNER_ID, `select admin_set_business_tier('${PARTNER_ID}'::uuid, 'growth');`);
  const tierAfterUpgrade = await runSql(`select tier from brand_partners where id = '${PARTNER_ID}';`);
  assert(tierAfterUpgrade[0].tier === 'growth', 'admin tier switch immediately changed the real tier');

  const demandGrowth = await runSqlAs(OWNER_ID, `select * from get_aggregated_demand_for_partner('${PARTNER_ID}'::uuid) where category = 'Wine';`);
  assert(demandGrowth[0].is_demand_gap === true, 'the identical row now correctly shows the real is_demand_gap once upgraded to growth -- proving the redaction, not a coincidence');

  // --- real fix, found while wiring the dashboard UI: a category that
  // ONLY exists via unmet_intent (zero real open requests) must not leak
  // its mere existence to a non-advanced caller, even as a zeroed-out row ---
  await runSqlAs(OWNER_ID, `select admin_set_business_tier('${PARTNER_ID}'::uuid, 'basic');`);
  const intentRow = await runSql(`
    insert into intent_submissions (user_id, raw_text, category, had_any_result, wide_area, created_at)
    values ('${NON_OWNER_ID}', 'yoga class tonight', 'Yoga', false, round(${LAT}::numeric, 1)::text || ',' || round(${LNG}::numeric, 1)::text, now())
    returning id;
  `);
  const intentId = intentRow[0].id;
  intentSubmissionId = intentId;

  const demandBasicYoga = await runSqlAs(OWNER_ID, `select count(*) as c from get_aggregated_demand_for_partner('${PARTNER_ID}'::uuid) as g where g.category = 'Yoga';`);
  assert(Number(demandBasicYoga[0].c) === 0, 'basic tier never sees a category that exists purely via redacted unmet-intent data -- no leaked "0 searches" row');

  await runSqlAs(OWNER_ID, `select admin_set_business_tier('${PARTNER_ID}'::uuid, 'growth');`);
  const demandGrowthYoga = await runSqlAs(OWNER_ID, `select * from get_aggregated_demand_for_partner('${PARTNER_ID}'::uuid) where category = 'Yoga';`);
  assert(demandGrowthYoga.length === 1 && Number(demandGrowthYoga[0].unmet_intent_count) === 1 && demandGrowthYoga[0].is_demand_gap === true, 'the identical category correctly appears with its real unmet_intent_count/is_demand_gap once upgraded to growth');

  // --- get_missed_match_summary() / get_partner_category_outcomes(): real entitlement gate ---
  await runSqlAs(OWNER_ID, `select admin_set_business_tier('${PARTNER_ID}'::uuid, 'basic');`);

  let missedRejected = false;
  let missedMessage = '';
  try {
    await runSqlAs(OWNER_ID, `select get_missed_match_summary('${PARTNER_ID}'::uuid);`);
  } catch (err) { missedRejected = true; missedMessage = err.message; }
  assert(missedRejected && missedMessage.includes('ENTITLEMENT_REQUIRED:missed_match_reporting'), `basic tier is rejected calling get_missed_match_summary (got: ${missedMessage})`);

  let outcomesRejected = false;
  let outcomesMessage = '';
  try {
    await runSqlAs(OWNER_ID, `select get_partner_category_outcomes('${PARTNER_ID}'::uuid);`);
  } catch (err) { outcomesRejected = true; outcomesMessage = err.message; }
  assert(outcomesRejected && outcomesMessage.includes('ENTITLEMENT_REQUIRED:category_outcomes'), `basic tier is rejected calling get_partner_category_outcomes (got: ${outcomesMessage})`);

  await runSqlAs(OWNER_ID, `select admin_set_business_tier('${PARTNER_ID}'::uuid, 'growth');`);
  let missedNowWorks = true;
  try {
    await runSqlAs(OWNER_ID, `select get_missed_match_summary('${PARTNER_ID}'::uuid);`);
  } catch (err) { missedNowWorks = false; }
  assert(missedNowWorks, 'the identical call succeeds once upgraded to growth -- proving the gate, not a permanent block');

  // --- stories.partner_id INSERT: real business_moments entitlement trigger ---
  await runSqlAs(OWNER_ID, `select admin_set_business_tier('${PARTNER_ID}'::uuid, 'basic');`);
  let momentRejected = false;
  let momentMessage = '';
  try {
    await runSqlAs(OWNER_ID, `insert into stories (user_id, media_path, partner_id) values ('${OWNER_ID}', 'test/path.jpg', '${PARTNER_ID}');`);
  } catch (err) { momentRejected = true; momentMessage = err.message; }
  assert(momentRejected && momentMessage.includes('ENTITLEMENT_REQUIRED:business_moments'), `basic tier is rejected posting a business moment (got: ${momentMessage})`);

  await runSqlAs(OWNER_ID, `select admin_set_business_tier('${PARTNER_ID}'::uuid, 'growth');`);
  const storyResult = await runSqlAs(OWNER_ID, `insert into stories (user_id, media_path, partner_id) values ('${OWNER_ID}', 'test/path.jpg', '${PARTNER_ID}') returning id;`);
  createdStoryId = storyResult[0].id;
  assert(!!createdStoryId, 'the identical business moment insert succeeds once upgraded to growth');

  // A real, unrelated business moment (no partner_id at all -- a plain
  // personal story) must never be affected by any of this.
  const plainStory = await runSqlAs(OWNER_ID, `insert into stories (user_id, media_path) values ('${OWNER_ID}', 'test/plain.jpg') returning id;`);
  assert(!!plainStory[0].id, 'a plain personal story (no partner_id) is completely unaffected by the business_moments gate');
  await runSql(`delete from stories where id = '${plainStory[0].id}';`);

  // --- admin_set_business_tier(): real admin-only enforcement ---
  let adminRejected = false;
  try {
    await runSqlAs(NON_OWNER_ID, `select admin_set_business_tier('${PARTNER_ID}'::uuid, 'brand');`);
  } catch (err) { adminRejected = true; }
  assert(adminRejected, 'a non-admin is rejected calling admin_set_business_tier');

  let invalidTierRejected = false;
  try {
    await runSqlAs(OWNER_ID, `select admin_set_business_tier('${PARTNER_ID}'::uuid, 'bogus');`);
  } catch (err) { invalidTierRejected = true; }
  assert(invalidTierRejected, 'an invalid tier value is rejected');

  // --- admin_list_businesses(): real admin-only browse, sees inactive rows RLS would hide ---
  const listResult = await runSqlAs(OWNER_ID, `select * from admin_list_businesses('coastal');`);
  assert(listResult.length === 1 && listResult[0].id === PARTNER_ID, 'admin_list_businesses finds the real test partner by a real search term');

  let listRejected = false;
  try {
    await runSqlAs(NON_OWNER_ID, `select * from admin_list_businesses();`);
  } catch (err) { listRejected = true; }
  assert(listRejected, 'a non-admin is rejected calling admin_list_businesses');

  summarize('business-entitlements');
}

async function cleanup() {
  for (const id of createdExperienceIds) {
    await runSql(`delete from business_experiences where id = '${id}';`).catch(() => {});
  }
  if (createdStoryId) {
    await runSql(`delete from stories where id = '${createdStoryId}';`).catch(() => {});
  }
  if (requestId) {
    await runSql(`delete from business_requests where id = '${requestId}';`).catch(() => {});
  }
  if (intentSubmissionId) {
    await runSql(`delete from intent_submissions where id = '${intentSubmissionId}';`).catch(() => {});
  }
  await runSql(`update brand_partners set tier = 'basic', latitude = null, longitude = null where id = '${PARTNER_ID}';`).catch(() => {});

  const check = await runSql(`
    select
      (select tier from brand_partners where id = '${PARTNER_ID}') as tier,
      (select count(*) from business_experiences where partner_id = '${PARTNER_ID}') as experiences,
      (select count(*) from stories where partner_id = '${PARTNER_ID}') as moments,
      (select count(*) from business_requests) as requests;
  `);
  console.log('post-cleanup baseline:', JSON.stringify(check));
}

main()
  .catch((e) => { console.error('ERROR', e); process.exitCode = 1; })
  .finally(async () => {
    await cleanup();
  });
