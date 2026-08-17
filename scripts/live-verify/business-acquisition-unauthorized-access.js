#!/usr/bin/env node
// Business Partner acquisition experience, Milestone 7 (see CLAUDE.md): the third of the
// three adversarial review passes the brief specifies -- "a security pass attempting
// unauthorized apply/edit/publish access against another business's data." Real attack
// attempts against the newest surfaces built across Milestones 1-6, each proven both to
// fail for the attacker AND to still succeed for the legitimate caller (so a fix can't be
// "just reject everyone").
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/business-acquisition-unauthorized-access.js
const { runSql, runSqlAsRls, assert, summarize } = require('./lib/db');

async function expectReject(promise, label) {
  try {
    await promise;
    assert(false, `${label} (expected rejection, but it succeeded)`);
  } catch (e) {
    assert(true, `${label} (rejected: ${(e.message || '').split('\n')[0].slice(0, 90)})`);
  }
}

async function main() {
  console.log('business-acquisition-unauthorized-access: attempting unauthorized apply/edit/publish access against another business\'s real data...');

  const OWNER_ID = 'ee74f1a9-9996-465d-a674-c60bc63fbfca'; // Allen, real owner of Coastal Coffee
  const REAL_PARTNER_ID = '67dd3d6d-f36b-4b20-8a80-ac980baecc30'; // Coastal Coffee
  const ATTACKER_ID = '0d7cecd9-721f-4632-8b1f-44b866d1892b'; // Claude, uninvolved
  const NON_ADMIN_ID = 'e9f74b5a-d1df-4a82-968c-a0f6a73c128a'; // Google voice, not an admin

  // Capture the REAL business's complete editable-field state before touching anything --
  // a partial capture here was a real mistake made while first writing this script (only
  // name/description were captured, so the "restore" call at the end silently wiped the
  // real partner's own category from "food_drink" to null). Every field
  // update_business_profile() can write is captured and restored, not a subset.
  const [beforePartner] = await runSql(
    `select name, description, address, latitude, longitude, logo_url, category from brand_partners where id = '${REAL_PARTNER_ID}';`
  );
  console.log(`  (real Coastal Coffee row, before any attack: ${JSON.stringify(beforePartner)})`);

  let testRequestId;
  let testNoteExists = false;

  try {
    // --- Unauthorized "apply": can an attacker spoof someone else's requester_id? ---
    await expectReject(
      runSqlAsRls(
        ATTACKER_ID,
        `insert into business_partner_requests (requester_id, business_name, status) values ('${OWNER_ID}', 'live-verify: spoofed applicant', 'pending');`
      ),
      'attacker cannot INSERT a business_partner_requests row claiming a different requester_id'
    );

    // --- Unauthorized "edit": can an attacker call update_business_profile on someone else's real business? ---
    await expectReject(
      runSqlAsRls(
        ATTACKER_ID,
        `select update_business_profile('${REAL_PARTNER_ID}'::uuid, 'HIJACKED BY LIVE-VERIFY', 'attacker-controlled description', null, null, null, null, null);`
      ),
      'attacker cannot update_business_profile() on a business they do not manage'
    );
    const [afterEditAttempt] = await runSql(`select name from brand_partners where id = '${REAL_PARTNER_ID}';`);
    assert(afterEditAttempt?.name === beforePartner?.name, 'the real business name is genuinely untouched after the rejected edit attempt');

    // --- Unauthorized "edit" via a direct offer insert on someone else's business ---
    await expectReject(
      runSqlAsRls(
        ATTACKER_ID,
        `insert into brand_offers (partner_id, title, reward_type, active) values ('${REAL_PARTNER_ID}', 'live-verify: hijacked offer', 'discount', true);`
      ),
      'attacker cannot INSERT a brand_offers row for a business they do not manage'
    );

    // --- Unauthorized "publish": can a non-admin approve their OWN pending request (self-publish)? ---
    const [req] = await runSqlAsRls(
      ATTACKER_ID,
      `insert into business_partner_requests (requester_id, business_name, status) values ('${ATTACKER_ID}', 'live-verify: self-approval attempt', 'pending') returning id;`
    );
    testRequestId = req?.id;
    await expectReject(
      runSqlAsRls(ATTACKER_ID, `select approve_business_partner_request('${testRequestId}');`),
      'a non-admin applicant cannot self-approve their own pending request (approve_business_partner_request)'
    );
    await expectReject(
      runSqlAsRls(NON_ADMIN_ID, `select approve_business_partner_request('${testRequestId}');`),
      'a different non-admin (not even the applicant) also cannot approve someone else\'s pending request'
    );
    await expectReject(
      runSqlAsRls(ATTACKER_ID, `select deny_business_partner_request('${testRequestId}');`),
      'a non-admin cannot deny a pending request either (deny_business_partner_request)'
    );
    const [reqStillPending] = await runSql(`select status from business_partner_requests where id = '${testRequestId}';`);
    assert(reqStillPending?.status === 'pending', 'the request is genuinely still pending, not silently approved or denied by any rejected attempt');

    // --- Unauthorized read of another business's CRM notes ---
    await runSqlAsRls(
      OWNER_ID,
      `select upsert_business_customer_note('${REAL_PARTNER_ID}'::uuid, '${ATTACKER_ID}'::uuid, 'live-verify: real private note', array['test']);`
    );
    testNoteExists = true;
    const [attackerDirectRead] = await runSqlAsRls(
      ATTACKER_ID,
      `select count(*)::int as n from business_customer_notes where partner_id = '${REAL_PARTNER_ID}';`
    );
    assert(attackerDirectRead?.n === 0, `a non-owner querying business_customer_notes directly gets zero rows (RLS), not a leak (got ${attackerDirectRead?.n})`);

    // --- Identity spoofing on the newest event-logging surfaces ---
    await expectReject(
      runSqlAsRls(
        ATTACKER_ID,
        `insert into business_profile_views (partner_id, viewer_id, source) values ('${REAL_PARTNER_ID}', '${OWNER_ID}', 'in_app');`
      ),
      'attacker cannot log a business_profile_views row claiming a different viewer_id'
    );
    await expectReject(
      runSqlAsRls(
        ATTACKER_ID,
        `insert into business_acquisition_events (session_id, user_id, event) values (gen_random_uuid(), '${OWNER_ID}', 'apply_started');`
      ),
      'attacker cannot log a business_acquisition_events row claiming a different user_id'
    );

    // --- Owner-gated stats RPCs: confirmed once more, live, as part of this dedicated adversarial pass ---
    const [nonOwnerDiscovery] = await runSqlAsRls(ATTACKER_ID, `select get_business_discovery_stats('${REAL_PARTNER_ID}') as stats;`);
    assert(
      nonOwnerDiscovery?.stats?.total_views === 0,
      `a non-owner calling get_business_discovery_stats() for the real Coastal Coffee partner gets zeroed stats, not the real total (got ${JSON.stringify(nonOwnerDiscovery?.stats)})`
    );
    await expectReject(
      runSqlAsRls(ATTACKER_ID, `select get_business_acquisition_funnel_stats();`),
      'a non-admin cannot call get_business_acquisition_funnel_stats() at all'
    );

    // --- Legitimate owner action still works (a fix that rejects everyone isn't a real fix) ---
    // Writes back the exact same real values just captured above -- every field, not a
    // subset, so this "legitimate edit" round-trips to a genuine no-op rather than
    // silently clobbering a field this test never intended to touch.
    const descLiteral = beforePartner?.description === null ? 'null' : `'${(beforePartner.description || '').replace(/'/g, "''")}'`;
    const addrLiteral = beforePartner?.address === null ? 'null' : `'${beforePartner.address.replace(/'/g, "''")}'`;
    const latLiteral = beforePartner?.latitude === null ? 'null' : String(beforePartner.latitude);
    const lngLiteral = beforePartner?.longitude === null ? 'null' : String(beforePartner.longitude);
    const logoLiteral = beforePartner?.logo_url === null ? 'null' : `'${beforePartner.logo_url.replace(/'/g, "''")}'`;
    const catLiteral = beforePartner?.category === null ? 'null' : `'${beforePartner.category}'`;
    await runSqlAsRls(
      OWNER_ID,
      `select update_business_profile('${REAL_PARTNER_ID}'::uuid, '${beforePartner?.name}', ${descLiteral}, ${addrLiteral}, ${latLiteral}, ${lngLiteral}, ${logoLiteral}, ${catLiteral});`
    );
    const [afterLegitEdit] = await runSql(`select name from brand_partners where id = '${REAL_PARTNER_ID}';`);
    assert(afterLegitEdit?.name === beforePartner?.name, "the REAL owner's own update_business_profile() call still succeeds (a real, legitimate edit is not collateral damage)");
  } finally {
    if (testNoteExists) await runSqlAsRls(OWNER_ID, `select delete_business_customer_note('${REAL_PARTNER_ID}'::uuid, '${ATTACKER_ID}'::uuid);`).catch(() => {});
    if (testRequestId) await runSql(`delete from business_partner_requests where id = '${testRequestId}';`).catch(() => {});
    await runSql(`delete from brand_offers where title = 'live-verify: hijacked offer';`).catch(() => {});
    await runSql(`delete from business_acquisition_events where user_id = '${OWNER_ID}' and event = 'apply_started' and created_at > now() - interval '5 minutes';`).catch(() => {});
    console.log('  (cleanup) any disposable test rows this pass created were removed');

    const [afterPartner] = await runSql(
      `select name, description, address, latitude, longitude, logo_url, category from brand_partners where id = '${REAL_PARTNER_ID}';`
    );
    assert(
      JSON.stringify(afterPartner) === JSON.stringify(beforePartner),
      `cleanup confirmed: the real Coastal Coffee row is back to its exact pre-test state (before: ${JSON.stringify(beforePartner)}, after: ${JSON.stringify(afterPartner)})`
    );
  }

  summarize('business-acquisition-unauthorized-access');
}

main().catch((e) => {
  console.error('business-acquisition-unauthorized-access: script itself failed to run:', e.message);
  process.exitCode = 1;
});
