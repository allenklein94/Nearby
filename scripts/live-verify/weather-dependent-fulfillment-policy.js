const { runSql, runSqlAs, assert, summarize } = require('../scripts/live-verify/lib/db.js');

const PARTNER_ID = '67dd3d6d-f36b-4b20-8a80-ac980baecc30'; // Coastal Coffee
const OWNER_ID = 'ee74f1a9-9996-465d-a674-c60bc63fbfca'; // Allen
const NON_OWNER_ID = '0d7cecd9-721f-4632-8b1f-44b866d1892b'; // Claude
const LAT = 40.3573;
const LNG = -74.6672;

let requestId = null;

async function main() {
  await runSql(`update brand_partners set latitude = ${LAT}, longitude = ${LNG} where id = '${PARTNER_ID}';`);

  // Real owner-set weather-dependent policy, auto-accepts party size <=4.
  const upsertResult = await runSqlAs(OWNER_ID, `
    select upsert_business_fulfillment_policy(
      '${PARTNER_ID}'::uuid, null, null, null, null, null, null, 4, null, null, true, true
    );
  `);
  assert(!!upsertResult[0], 'owner can set weather_dependent=true on their own policy');

  let policy = await runSql(`select weather_dependent, last_rain_risk, last_weather_checked_at from business_fulfillment_policies where partner_id = '${PARTNER_ID}';`);
  assert(policy[0].weather_dependent === true, 'weather_dependent persisted true');
  assert(policy[0].last_rain_risk === null, 'last_rain_risk starts null (never checked yet)');

  // No fresh rain-risk cache yet -- a weather-dependent policy with no
  // real signal should behave exactly as before (never blocked on an
  // absent signal).
  const r1 = await runSql(`
    insert into business_requests (requester_id, raw_text, category, party_size, date, latitude, longitude, radius_miles, status, expires_at)
    values ('${NON_OWNER_ID}', 'coffee please', 'Coffee', 2, current_date, ${LAT}, ${LNG}, 15, 'open', now() + interval '2 days')
    returning id;
  `);
  requestId = r1[0].id;
  let matched = await runSql(`select _match_request_to_policy('${requestId}'::uuid, ${LAT}, ${LNG}, 15, 2, null, null);`);
  assert(Number(matched[0]._match_request_to_policy) === 1, 'no cached rain-risk yet -> policy still auto-accepts normally');
  let offer = await runSql(`select status from business_request_offers where request_id = '${requestId}' and partner_id = '${PARTNER_ID}';`);
  assert(offer[0] && offer[0].status === 'offered', 'real offer row created (offered), not blocked');
  let exclusion = await runSql(`select count(*) as c from business_match_exclusions where request_id = '${requestId}' and partner_id = '${PARTNER_ID}';`);
  assert(Number(exclusion[0].c) === 0, 'no exclusion row logged when the policy genuinely matched');

  // Clean up this request/offer before the next scenario.
  await runSql(`delete from business_request_offers where request_id = '${requestId}';`);
  await runSql(`delete from business_requests where id = '${requestId}';`);

  // Now cache a real fresh HIGH rain-risk signal directly (simulating
  // what the hourly cron sweep would have written).
  await runSql(`update business_fulfillment_policies set last_rain_risk = 'high', last_weather_checked_at = now() where partner_id = '${PARTNER_ID}';`);

  const r2 = await runSql(`
    insert into business_requests (requester_id, raw_text, category, party_size, date, latitude, longitude, radius_miles, status, expires_at)
    values ('${NON_OWNER_ID}', 'coffee please again', 'Coffee', 2, current_date, ${LAT}, ${LNG}, 15, 'open', now() + interval '2 days')
    returning id;
  `);
  requestId = r2[0].id;
  matched = await runSql(`select _match_request_to_policy('${requestId}'::uuid, ${LAT}, ${LNG}, 15, 2, null, null);`);
  assert(Number(matched[0]._match_request_to_policy) === 0, 'fresh HIGH rain-risk correctly blocks auto-accept');
  offer = await runSql(`select count(*) as c from business_request_offers where request_id = '${requestId}' and partner_id = '${PARTNER_ID}';`);
  assert(Number(offer[0].c) === 0, 'no offer row created while genuinely blocked by weather');
  exclusion = await runSql(`select reason from business_match_exclusions where request_id = '${requestId}' and partner_id = '${PARTNER_ID}';`);
  assert(exclusion[0] && exclusion[0].reason === 'weather_unfavorable', `exclusion correctly logged as weather_unfavorable (got: ${exclusion[0] && exclusion[0].reason})`);

  // A repeat call is idempotent -- no duplicate exclusion row.
  await runSql(`select _match_request_to_policy('${requestId}'::uuid, ${LAT}, ${LNG}, 15, 2, null, null);`);
  const exclusionCount = await runSql(`select count(*) as c from business_match_exclusions where request_id = '${requestId}' and partner_id = '${PARTNER_ID}';`);
  assert(Number(exclusionCount[0].c) === 1, 'repeat matching call does not duplicate the exclusion row');

  // Flip cached rain-risk to LOW -- the identical policy should now
  // genuinely auto-accept a fresh request.
  await runSql(`update business_fulfillment_policies set last_rain_risk = 'low', last_weather_checked_at = now() where partner_id = '${PARTNER_ID}';`);
  await runSql(`delete from business_request_offers where request_id = '${requestId}';`);
  await runSql(`delete from business_match_exclusions where request_id = '${requestId}';`);
  await runSql(`delete from business_requests where id = '${requestId}';`);

  const r3 = await runSql(`
    insert into business_requests (requester_id, raw_text, category, party_size, date, latitude, longitude, radius_miles, status, expires_at)
    values ('${NON_OWNER_ID}', 'coffee once more', 'Coffee', 2, current_date, ${LAT}, ${LNG}, 15, 'open', now() + interval '2 days')
    returning id;
  `);
  requestId = r3[0].id;
  matched = await runSql(`select _match_request_to_policy('${requestId}'::uuid, ${LAT}, ${LNG}, 15, 2, null, null);`);
  assert(Number(matched[0]._match_request_to_policy) === 1, 'LOW rain-risk correctly lets the policy auto-accept again');

  await runSql(`delete from business_request_offers where request_id = '${requestId}';`);
  await runSql(`delete from business_requests where id = '${requestId}';`);

  // Staleness: a HIGH rain-risk reading older than the 3h freshness
  // window should NOT block -- an honest "we don't trust this old
  // signal anymore" default, matching isAvailabilityPulseFresh()'s own
  // convention.
  await runSql(`update business_fulfillment_policies set last_rain_risk = 'high', last_weather_checked_at = now() - interval '4 hours' where partner_id = '${PARTNER_ID}';`);
  const r4 = await runSql(`
    insert into business_requests (requester_id, raw_text, category, party_size, date, latitude, longitude, radius_miles, status, expires_at)
    values ('${NON_OWNER_ID}', 'coffee stale check', 'Coffee', 2, current_date, ${LAT}, ${LNG}, 15, 'open', now() + interval '2 days')
    returning id;
  `);
  requestId = r4[0].id;
  matched = await runSql(`select _match_request_to_policy('${requestId}'::uuid, ${LAT}, ${LNG}, 15, 2, null, null);`);
  assert(Number(matched[0]._match_request_to_policy) === 1, 'a stale (>3h old) HIGH rain-risk reading is correctly ignored, not blocked on');

  await runSql(`delete from business_request_offers where request_id = '${requestId}';`);
  await runSql(`delete from business_requests where id = '${requestId}';`);
  requestId = null;

  // Turning weather_dependent back OFF clears the cached signal.
  const upsertOff = await runSqlAs(OWNER_ID, `
    select upsert_business_fulfillment_policy(
      '${PARTNER_ID}'::uuid, null, null, null, null, null, null, 4, null, null, true, false
    );
  `);
  assert(!!upsertOff[0], 'owner can turn weather_dependent back off');
  policy = await runSql(`select weather_dependent, last_rain_risk, last_weather_checked_at from business_fulfillment_policies where partner_id = '${PARTNER_ID}';`);
  assert(policy[0].weather_dependent === false, 'weather_dependent persisted false');
  assert(policy[0].last_rain_risk === null && policy[0].last_weather_checked_at === null, 'cache cleared when weather_dependent turned off');

  // Non-owner cannot set weather_dependent on someone else's policy.
  let rejected = false;
  try {
    await runSqlAs(NON_OWNER_ID, `select upsert_business_fulfillment_policy('${PARTNER_ID}'::uuid, null, null, null, null, null, null, 4, null, null, true, true);`);
  } catch (e) {
    rejected = true;
  }
  assert(rejected, 'non-owner is rejected setting a policy on this partner');

  // Real, live end-to-end two-phase sweep: turn weather_dependent back
  // on, submit (real net.http_get, no polling, returns immediately so
  // its own transaction commits and the request becomes visible to
  // pg_net's worker), wait for the worker to actually resolve it in a
  // genuinely separate call, then apply.
  const reOnResult = await runSqlAs(OWNER_ID, `select upsert_business_fulfillment_policy('${PARTNER_ID}'::uuid, null, null, null, null, null, null, 4, null, null, true, true);`);
  assert(!!reOnResult[0], 'owner can re-enable weather_dependent');

  const submitResult = await runSql(`select submit_weather_dependent_policy_refreshes() as n;`);
  assert(Number(submitResult[0].n) >= 1, `real submit call queued at least 1 partner (got ${submitResult[0].n})`);

  const queued = await runSql(`select partner_id, request_id from weather_dependent_policy_refresh_queue where partner_id = '${PARTNER_ID}';`);
  assert(queued.length === 1, 'a real pending queue row exists for the test partner after submit');

  // A repeat submit call within the 10-minute window should NOT
  // re-queue a second request for the same still-pending partner.
  const resubmitResult = await runSql(`select submit_weather_dependent_policy_refreshes() as n;`);
  assert(Number(resubmitResult[0].n) === 0, `a repeat submit within 10 minutes correctly re-queues nothing (got ${resubmitResult[0].n})`);

  // Give the real pg_net worker real time to actually resolve the
  // request -- this now runs as its own separate call, so the worker
  // can genuinely see and process it (unlike the broken single-
  // function design this replaced).
  let resolved = false;
  for (let i = 0; i < 20 && !resolved; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    const check = await runSql(`select content is not null as resolved from net._http_response where id = ${queued[0].request_id};`);
    resolved = check[0] && check[0].resolved === true;
  }
  assert(resolved, 'the real pg_net worker actually resolved the queued request once its own transaction committed');

  const applyResult = await runSql(`select apply_weather_dependent_policy_refreshes() as n;`);
  assert(Number(applyResult[0].n) === 1, `real apply call wrote exactly 1 real result (got ${applyResult[0].n})`);

  const afterApply = await runSql(`select last_rain_risk, last_weather_checked_at from business_fulfillment_policies where partner_id = '${PARTNER_ID}';`);
  assert(afterApply[0].last_rain_risk === 'low' || afterApply[0].last_rain_risk === 'high', `real apply wrote a real rain-risk value (got: ${afterApply[0].last_rain_risk})`);
  assert(afterApply[0].last_weather_checked_at !== null, 'real apply stamped a real last_weather_checked_at');

  const queueAfterApply = await runSql(`select count(*) as c from weather_dependent_policy_refresh_queue where partner_id = '${PARTNER_ID}';`);
  assert(Number(queueAfterApply[0].c) === 0, 'the queue row was cleared once applied, not left behind');

  // A repeat apply call with nothing pending is a genuine no-op.
  const applyAgain = await runSql(`select apply_weather_dependent_policy_refreshes() as n;`);
  assert(Number(applyAgain[0].n) === 0, `a repeat apply call with nothing pending correctly applies nothing (got ${applyAgain[0].n})`);

  // A genuinely timed-out pending row (fake an old submitted_at, past
  // the 10-minute give-up window, pointed at a real never-real request
  // id) is cleaned up without ever touching the cached signal.
  await runSql(`insert into weather_dependent_policy_refresh_queue (partner_id, request_id, submitted_at) values ('${PARTNER_ID}', 999999999, now() - interval '11 minutes');`);
  const cachedBeforeTimeout = await runSql(`select last_rain_risk from business_fulfillment_policies where partner_id = '${PARTNER_ID}';`);
  await runSql(`select apply_weather_dependent_policy_refreshes();`);
  const cachedAfterTimeout = await runSql(`select last_rain_risk from business_fulfillment_policies where partner_id = '${PARTNER_ID}';`);
  assert(cachedAfterTimeout[0].last_rain_risk === cachedBeforeTimeout[0].last_rain_risk, 'a timed-out pending row is discarded without touching the real cached signal');
  const queueAfterTimeout = await runSql(`select count(*) as c from weather_dependent_policy_refresh_queue where partner_id = '${PARTNER_ID}';`);
  assert(Number(queueAfterTimeout[0].c) === 0, 'the timed-out queue row itself was removed');

  summarize('weather-dependent-fulfillment-policy');
}

async function cleanup() {
  if (requestId) {
    await runSql(`delete from business_request_offers where request_id = '${requestId}';`).catch(() => {});
    await runSql(`delete from business_match_exclusions where request_id = '${requestId}';`).catch(() => {});
    await runSql(`delete from business_requests where id = '${requestId}';`).catch(() => {});
  }
  await runSql(`delete from weather_dependent_policy_refresh_queue where partner_id = '${PARTNER_ID}';`).catch(() => {});
  await runSql(`delete from business_fulfillment_policies where partner_id = '${PARTNER_ID}';`).catch(() => {});
  await runSql(`update brand_partners set latitude = null, longitude = null where id = '${PARTNER_ID}';`).catch(() => {});

  const check = await runSql(`
    select
      (select count(*) from business_requests) as requests,
      (select count(*) from business_request_offers) as offers,
      (select count(*) from business_match_exclusions) as exclusions,
      (select count(*) from business_fulfillment_policies) as policies,
      (select count(*) from weather_dependent_policy_refresh_queue) as queue,
      (select latitude from brand_partners where id = '${PARTNER_ID}') as lat;
  `);
  console.log('post-cleanup baseline:', JSON.stringify(check));
}

main()
  .catch((e) => { console.error('ERROR', e); process.exitCode = 1; })
  .finally(async () => {
    await cleanup();
  });
