#!/usr/bin/env node
// Business Partner acquisition experience, Milestone 6 (see CLAUDE.md): the
// one piece of Milestone 6 explicitly flagged as not-yet-done -- "the real
// single-test-business run through the complete funnel end-to-end...
// hasn't been run yet -- only the individual event-firing pieces have
// been proven in isolation." This is that run. Every step below fires
// the exact same event, calls the exact same RPC, or does the exact same
// table insert the real client code actually does at that step -- see
// businessAcquisitionEvents.js, BusinessDashboardScreen.js
// (dashboard_viewed/profile_completed/first_offer_created),
// approve_business_partner_request() (apply_approved + published), and
// log_first_consumer_interaction() (the business_profile_views AFTER
// INSERT trigger) for the real call sites this script mirrors.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/business-acquisition-funnel-e2e.js
const crypto = require('crypto');
const { runSql, runSqlAsRls, assert, summarize } = require('./lib/db');

async function main() {
  console.log('business-acquisition-funnel-e2e: running one real disposable test business through the full acquisition funnel...');

  // Real, pre-existing profiles -- Google voice manages no business today
  // (confirmed before this script was first written), Claude is a real,
  // uninvolved consumer, and the real admin is looked up live rather than
  // hardcoded in case the admin roster ever changes.
  const OWNER_ID = 'e9f74b5a-d1df-4a82-968c-a0f6a73c128a'; // Google voice
  const CONSUMER_ID = '0d7cecd9-721f-4632-8b1f-44b866d1892b'; // Claude
  const [admin] = await runSql(`select id from profiles where is_admin = true limit 1;`);
  if (!admin) throw new Error('Needs at least one real admin profile in this environment.');
  const ADMIN_ID = admin.id;

  const [beforeOwner] = await runSql(`select managed_partner_id from profiles where id = '${OWNER_ID}';`);
  assert(beforeOwner?.managed_partner_id === null, 'baseline: the test owner does not already manage a business');

  // Captured once, before this run does anything -- business_acquisition_events is a real,
  // shared, admin-facing table other live-verify scripts (and real anonymous docs/business.html
  // traffic) also write to over time. A hardcoded absolute baseline here goes stale the moment
  // anything else legitimately adds a row -- found live, 2026-08-26: this exact assertion (a
  // hardcoded "back to 2 rows") started failing not because of a leak, but because real
  // first_consumer_interaction/dashboard_viewed rows had genuinely accumulated against the real,
  // permanent Coastal Coffee partner across many earlier, unrelated live-verify runs (each one's
  // own cleanup deletes the business_profile_views row it inserted, which un-satisfies the
  // trigger's own "NOT EXISTS a prior view" condition and lets the next unrelated test re-fire
  // "first ever" ‑ a real, disclosed cross-script side effect, not organic traffic and not this
  // run's own leftover). Comparing against a captured "before" snapshot instead of a magic number
  // makes this script correct regardless of how much real history already exists.
  const [globalBaselineBefore] = await runSql(
    `select count(*) filter (where event = 'first_consumer_interaction')::int as fci, count(*)::int as total from business_acquisition_events;`
  );

  const applySessionId = crypto.randomUUID();
  const dashboardSessionId = crypto.randomUUID();
  const businessName = 'live-verify: e2e test bakery ' + Date.now();

  let requestId;
  let partnerId;

  try {
    // --- Milestone 2: the apply flow's own 4 client-fired funnel steps ---
    for (const event of ['apply_started', 'search_started', 'business_found', 'apply_submitted']) {
      await runSqlAsRls(
        OWNER_ID,
        `insert into business_acquisition_events (session_id, user_id, event) values ('${applySessionId}', '${OWNER_ID}', '${event}');`
      );
    }
    const applyCounts = await runSql(
      `select event from business_acquisition_events where session_id = '${applySessionId}' order by created_at;`
    );
    assert(
      applyCounts.length === 4,
      `all 4 apply-flow events were recorded (got ${applyCounts.map((r) => r.event).join(', ')})`
    );

    const [req] = await runSqlAsRls(
      OWNER_ID,
      `insert into business_partner_requests (requester_id, business_name, business_description, category, website, phone, address, requested_features, status) values ('${OWNER_ID}', '${businessName}', 'A real disposable end-to-end test business.', 'food_drink', 'https://example.com', '555-0100', '1 Test St', array['create_offers','host_gatherings'], 'pending') returning id;`
    );
    requestId = req?.id;
    assert(!!requestId, 'a real pending business_partner_requests row was created via the real owner-scoped INSERT policy');

    // --- Milestone 1: admin approve fires apply_approved + published atomically ---
    const [approveResult] = await runSqlAsRls(ADMIN_ID, `select approve_business_partner_request('${requestId}') as partner_id;`);
    partnerId = approveResult?.partner_id;
    assert(!!partnerId, 'approve_business_partner_request() succeeded and returned a real new partner id');

    const [ownerAfterApprove] = await runSql(`select managed_partner_id from profiles where id = '${OWNER_ID}';`);
    assert(
      ownerAfterApprove?.managed_partner_id === partnerId,
      'the real owner now manages the real newly-created business (managed_partner_id set)'
    );

    const approveEvents = await runSql(
      `select event from business_acquisition_events where partner_id = '${partnerId}' and user_id = '${OWNER_ID}' order by created_at;`
    );
    const approveEventNames = approveEvents.map((r) => r.event);
    assert(approveEventNames.includes('apply_approved'), 'apply_approved fired automatically from inside the real approve RPC');
    assert(approveEventNames.includes('published'), 'published fired automatically in the same real approve RPC call');

    // --- Milestone 6: dashboard_viewed fires on every real mount ---
    await runSqlAsRls(
      OWNER_ID,
      `insert into business_acquisition_events (session_id, user_id, event, partner_id) values ('${dashboardSessionId}', '${OWNER_ID}', 'dashboard_viewed', '${partnerId}');`
    );

    // --- Milestone 6: profile_completed fires after a real successful update_business_profile() save ---
    await runSqlAsRls(
      OWNER_ID,
      `select update_business_profile('${partnerId}'::uuid, '${businessName}', 'A real disposable end-to-end test business, now with a completed profile.', null, null, null, null, 'food_drink');`
    );
    await runSqlAsRls(
      OWNER_ID,
      `insert into business_acquisition_events (session_id, user_id, event, partner_id) values ('${dashboardSessionId}', '${OWNER_ID}', 'profile_completed', '${partnerId}');`
    );

    const [profileAfter] = await runSql(`select description, category from brand_partners where id = '${partnerId}';`);
    assert(
      (profileAfter?.description || '').includes('completed profile'),
      'update_business_profile() genuinely wrote the real profile edit, not a no-op'
    );

    // --- Milestone 6: first_offer_created fires only for a genuinely first offer ---
    const [offersBefore] = await runSql(`select count(*)::int as n from brand_offers where partner_id = '${partnerId}';`);
    assert(offersBefore?.n === 0, 'the new business genuinely has zero offers before creating one (real isFirstOffer signal)');
    await runSqlAsRls(
      OWNER_ID,
      `insert into brand_offers (partner_id, title, description, reward_type, active) values ('${partnerId}', 'Free pastry with any coffee', 'A real disposable end-to-end test offer.', 'discount', true);`
    );
    await runSqlAsRls(
      OWNER_ID,
      `insert into business_acquisition_events (session_id, user_id, event, partner_id) values ('${dashboardSessionId}', '${OWNER_ID}', 'first_offer_created', '${partnerId}');`
    );

    // --- Milestone 4/6: a real consumer's first-ever profile view fires first_consumer_interaction via the AFTER INSERT trigger ---
    const [viewsBefore] = await runSql(`select count(*)::int as n from business_profile_views where partner_id = '${partnerId}';`);
    assert(viewsBefore?.n === 0, 'the new business genuinely has zero profile views before a real consumer visits');
    await runSqlAsRls(
      CONSUMER_ID,
      `insert into business_profile_views (partner_id, viewer_id, source) values ('${partnerId}', '${CONSUMER_ID}', 'in_app');`
    );

    const [firstInteraction] = await runSql(
      `select count(*)::int as n from business_acquisition_events where partner_id = '${partnerId}' and event = 'first_consumer_interaction';`
    );
    assert(firstInteraction?.n === 1, 'first_consumer_interaction fired exactly once from the real trigger, not zero or twice');

    // A SECOND real view from a different consumer must NOT re-fire it (the "once per partner" rule).
    await runSqlAsRls(
      ADMIN_ID,
      `insert into business_profile_views (partner_id, viewer_id, source) values ('${partnerId}', '${ADMIN_ID}', 'in_app');`
    );
    const [secondInteraction] = await runSql(
      `select count(*)::int as n from business_acquisition_events where partner_id = '${partnerId}' and event = 'first_consumer_interaction';`
    );
    assert(
      secondInteraction?.n === 1,
      'a second real view from a different consumer does not re-fire first_consumer_interaction (still exactly 1)'
    );

    // --- Milestone 1: the real admin funnel-stats rollup reflects every real step this run produced ---
    const [funnel] = await runSqlAsRls(ADMIN_ID, `select get_business_acquisition_funnel_stats() as stats;`);
    const stats = funnel?.stats;
    assert(stats?.apply_started >= 1, `funnel stats: apply_started counted (${stats?.apply_started})`);
    assert(stats?.search_started >= 1, `funnel stats: search_started counted (${stats?.search_started})`);
    assert(stats?.business_found >= 1, `funnel stats: business_found counted (${stats?.business_found})`);
    assert(stats?.apply_submitted >= 1, `funnel stats: apply_submitted counted (${stats?.apply_submitted})`);
    assert(stats?.apply_approved >= 1, `funnel stats: apply_approved counted (${stats?.apply_approved})`);
    assert(stats?.published >= 1, `funnel stats: published counted (${stats?.published})`);
    assert(stats?.first_offer_created >= 1, `funnel stats: first_offer_created counted (${stats?.first_offer_created})`);
    assert(
      stats?.first_consumer_interaction === globalBaselineBefore.fci + 1,
      `funnel stats: first_consumer_interaction rose by exactly 1 from this run's own real trigger firing (before: ${globalBaselineBefore.fci}, after: ${stats?.first_consumer_interaction})`
    );
    assert(typeof stats?.pct_submitted_to_approved === 'number', 'funnel stats: a real conversion percentage was computed, not null');

    // A previously-disclosed gap in the RPC (get_business_acquisition_funnel_stats() not rolling
    // up profile_completed/dashboard_viewed) has since been closed -- confirmed live 2026-08-26
    // that the RPC now returns both real counts. This assertion was flipped from checking they
    // were absent to checking they're genuinely counted, matching every other funnel-stat check
    // above (>= 1, tolerant of real accumulated history rather than a fragile exact match).
    assert(stats?.profile_completed >= 1, `funnel stats: profile_completed counted (${stats?.profile_completed})`);
    assert(stats?.dashboard_viewed >= 1, `funnel stats: dashboard_viewed counted (${stats?.dashboard_viewed})`);

    // --- Milestone 4: the real owner-gated discovery stats reflect the real view(s) ---
    const [discovery] = await runSqlAsRls(OWNER_ID, `select get_business_discovery_stats('${partnerId}') as stats;`);
    assert(discovery?.stats?.total_views === 2, `discovery stats: total_views is the real count (${discovery?.stats?.total_views})`);
    assert(discovery?.stats?.in_app_views === 2, `discovery stats: in_app_views is the real count (${discovery?.stats?.in_app_views})`);

    const [nonOwnerDiscovery] = await runSqlAsRls(CONSUMER_ID, `select get_business_discovery_stats('${partnerId}') as stats;`);
    assert(nonOwnerDiscovery?.stats?.total_views === 0, 'a non-owner calling get_business_discovery_stats() gets zeroed-out stats, not a leak of the real total_views: 2');
  } finally {
    // Cleanup, in FK-safe order -- confirm production ends back at its exact pre-test baseline.
    if (partnerId) {
      await runSql(`delete from business_profile_views where partner_id = '${partnerId}';`).catch(() => {});
      await runSql(`delete from brand_offers where partner_id = '${partnerId}';`).catch(() => {});
      await runSql(`delete from business_acquisition_events where partner_id = '${partnerId}';`).catch(() => {});
    }
    await runSql(`delete from business_acquisition_events where session_id in ('${applySessionId}', '${dashboardSessionId}');`).catch(() => {});
    if (requestId) await runSql(`delete from business_partner_requests where id = '${requestId}';`).catch(() => {});
    if (partnerId) {
      await runSql(
        `select set_config('app.trusted_update', 'true', true) from (select 1) x; update profiles set managed_partner_id = null where id = '${OWNER_ID}';`
      ).catch(() => {});
      await runSql(`delete from brand_partners where id = '${partnerId}';`).catch(() => {});
    }
    console.log("  (cleanup) all disposable test rows deleted, test owner's managed_partner_id reset to null");

    const [afterOwner] = await runSql(`select managed_partner_id from profiles where id = '${OWNER_ID}';`);
    assert(afterOwner?.managed_partner_id === null, 'cleanup confirmed: the test owner no longer manages any business');

    const [remaining] = await runSql(`select count(*)::int as n from business_acquisition_events;`);
    assert(
      remaining?.n === globalBaselineBefore.total,
      `cleanup confirmed: business_acquisition_events is back to its exact real pre-test baseline (before: ${globalBaselineBefore.total}, after: ${remaining?.n})`
    );
  }

  summarize('business-acquisition-funnel-e2e');
}

main().catch((e) => {
  console.error('business-acquisition-funnel-e2e: script itself failed to run:', e.message);
  process.exitCode = 1;
});
