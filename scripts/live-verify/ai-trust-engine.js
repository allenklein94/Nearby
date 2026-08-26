#!/usr/bin/env node
// Business Intelligence Phase 6 (see CLAUDE.md's own locked plan, "Aug 26
// 2026 (cont'd) -- Business Intelligence Phase 6 + Phase 8"), Step 2/3.
// Real, repeatable live-verify script for the AI Trust Engine:
//   - set_business_ai_trust_level() is real, owner-only, and genuinely
//     entitlement-checked -- Level 2/3 are rejected below the real
//     Growth/Brand plan, per the already-seeded ai_level_2/ai_level_3
//     plan_entitlements rows from Step 1.
//   - the central _ai_authorize_action() gate implements the real fixed
//     4-tier risk taxonomy -- low/medium/high scale with trust level,
//     critical is ALWAYS rejected regardless of trust level.
//   - Level 1 auto-applies ONLY a genuinely fresh, real ai_inferred
//     attribute/category suggestion, only once opted in (trust_level>=1)
//     -- never a business_confirmed suggestion, never at trust_level=0 --
//     and logs a real ai_actions row that undo_ai_action() can genuinely
//     reverse (restoring the pre-change value and re-opening the
//     suggestion for manual review).
//   - Level 2/3's one real automatable action only ever fires within an
//     explicit, matching, owner-created business_ai_policies row, using a
//     real already-approved business_experiences template's own terms --
//     never an invented price -- and logs a real, deduped "blocked" row
//     with a specific reason when a policy exists but a condition fails.
//   - the untouched business_fulfillment_policies auto-accept engine
//     (Offer System Phase 2) keeps working exactly as before for a
//     business that never touches any of this.
//
// Coastal Coffee's coordinates/tier/ai_trust_level are temporarily set
// for this test (same established convention as every other live-verify
// script touching this partner) and fully reverted afterward.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/ai-trust-engine.js
const { runSql, runSqlAs, assert, summarize } = require('./lib/db');

async function main() {
  console.log('ai-trust-engine: verifying the AI Trust Engine (authorization gate, Level 1 auto-apply/undo, Level 2/3 policy + auto-respond)...');

  const [partnerRow] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  if (!partnerRow) throw new Error('Needs at least one real profile managing a business in this environment.');
  const ownerId = partnerRow.id;
  const partnerId = partnerRow.managed_partner_id;

  const others = await runSql(`select id from profiles where id <> '${ownerId}' order by created_at limit 2;`);
  if (!others || others.length < 2) throw new Error('Needs at least two other real profiles in this environment.');
  const strangerId = others[0].id;
  const requesterId = others[1].id;

  const [before] = await runSql(
    `select latitude, longitude, tier, ai_trust_level, category from brand_partners where id = '${partnerId}';`
  );

  let suggestionId, actionId, experienceId, policyId;
  let requestMatchId, offerMatchId, requestMismatchId;

  try {
    await runSql(`update brand_partners set latitude = 40.0, longitude = -75.0, tier = 'basic', ai_trust_level = 0 where id = '${partnerId}';`);

    // ---------- set_business_ai_trust_level: ownership + entitlements ----------
    let strangerRejected = false;
    try {
      await runSqlAs(strangerId, `select set_business_ai_trust_level('${partnerId}', 1);`);
    } catch (e) {
      strangerRejected = true;
    }
    assert(strangerRejected, 'set_business_ai_trust_level() rejects a caller who does not manage this business');

    await runSqlAs(ownerId, `select set_business_ai_trust_level('${partnerId}', 1);`);
    const [afterL1] = await runSql(`select ai_trust_level from brand_partners where id = '${partnerId}';`);
    assert(afterL1?.ai_trust_level === 1, 'Level 1 is real and always entitled (real owner call sets ai_trust_level to 1)');

    let level2RejectedAtBasic = false;
    try {
      await runSqlAs(ownerId, `select set_business_ai_trust_level('${partnerId}', 2);`);
    } catch (e) {
      level2RejectedAtBasic = true;
    }
    assert(level2RejectedAtBasic, 'Level 2 is correctly rejected at the basic tier (no ai_level_2 entitlement)');

    await runSql(`update brand_partners set tier = 'growth' where id = '${partnerId}';`);
    await runSqlAs(ownerId, `select set_business_ai_trust_level('${partnerId}', 2);`);
    const [afterL2] = await runSql(`select ai_trust_level from brand_partners where id = '${partnerId}';`);
    assert(afterL2?.ai_trust_level === 2, 'Level 2 succeeds once the real Growth plan entitles it');

    let level3RejectedAtGrowth = false;
    try {
      await runSqlAs(ownerId, `select set_business_ai_trust_level('${partnerId}', 3);`);
    } catch (e) {
      level3RejectedAtGrowth = true;
    }
    assert(level3RejectedAtGrowth, 'Level 3 is correctly rejected at the Growth tier (needs Brand)');

    // ---------- the central _ai_authorize_action() gate + risk taxonomy ----------
    const [criticalAtL2] = await runSql(`select _ai_authorize_action('${partnerId}', 'critical') as ok;`);
    assert(criticalAtL2?.ok === false, 'critical risk is NEVER authorized, even at trust_level=2');
    const [mediumAtL2] = await runSql(`select _ai_authorize_action('${partnerId}', 'medium') as ok;`);
    assert(mediumAtL2?.ok === true, 'medium risk is authorized once trust_level>=2');
    const [highAtL2] = await runSql(`select _ai_authorize_action('${partnerId}', 'high') as ok;`);
    assert(highAtL2?.ok === false, 'high risk (needs trust_level>=3) is correctly not authorized at trust_level=2');

    await runSql(`update brand_partners set tier = 'brand' where id = '${partnerId}';`);
    await runSqlAs(ownerId, `select set_business_ai_trust_level('${partnerId}', 3);`);
    const [criticalAtL3] = await runSql(`select _ai_authorize_action('${partnerId}', 'critical') as ok;`);
    assert(criticalAtL3?.ok === false, 'critical risk is NEVER authorized, even at trust_level=3 -- the one hard, unconditional rule');
    const [highAtL3] = await runSql(`select _ai_authorize_action('${partnerId}', 'high') as ok;`);
    assert(highAtL3?.ok === true, 'high risk is authorized once trust_level=3');

    // Drop to Level 2 for the rest of the Level 1/2/3 tests below.
    await runSqlAs(ownerId, `select set_business_ai_trust_level('${partnerId}', 2);`);

    // ---------- Level 1: real, fresh ai_inferred suggestion auto-applies ----------
    const suggestResult = await runSqlAs(
      ownerId,
      `select record_business_attribute_suggestion('${partnerId}', 'category', 'fitness_wellness', 'ai_inferred', 'test: keyword match') as id;`
    );
    suggestionId = suggestResult?.[0]?.id;
    assert(!!suggestionId, 'record_business_attribute_suggestion() returns a real suggestion id');

    const [afterSuggest] = await runSql(
      `select bp.category, bas.status from brand_partners bp, business_attribute_suggestions bas
       where bp.id = '${partnerId}' and bas.id = '${suggestionId}';`
    );
    assert(afterSuggest?.category === 'fitness_wellness', 'Level 1 auto-applied the real category change immediately (opted in via ai_trust_level>=1)');
    assert(afterSuggest?.status === 'confirmed', 'the underlying suggestion is correctly flipped to confirmed, not left "suggested"');

    const [actionRow] = await runSql(
      `select id, action_type, risk_level, approval_result, trust_level from ai_actions
       where partner_id = '${partnerId}' and (input_ref->>'suggestion_id') = '${suggestionId}';`
    );
    actionId = actionRow?.id;
    assert(!!actionId, 'a real ai_actions row was logged for the auto-applied suggestion');
    assert(actionRow?.risk_level === 'low', 'the logged risk_level is honestly "low" (housekeeping, reversible)');
    assert(actionRow?.approval_result === 'auto_applied', 'the logged approval_result is "auto_applied"');
    assert(actionRow?.trust_level === 2, 'the logged trust_level matches the real ai_trust_level at the moment it fired (2)');

    // ---------- Level 1: undo_ai_action() genuinely reverses it ----------
    let undoRejectedForStranger = false;
    try {
      await runSqlAs(strangerId, `select undo_ai_action('${actionId}');`);
    } catch (e) {
      undoRejectedForStranger = true;
    }
    assert(undoRejectedForStranger, 'undo_ai_action() rejects a caller who does not manage this business');

    await runSqlAs(ownerId, `select undo_ai_action('${actionId}');`);
    const [afterUndo] = await runSql(
      `select bp.category, bas.status from brand_partners bp, business_attribute_suggestions bas
       where bp.id = '${partnerId}' and bas.id = '${suggestionId}';`
    );
    assert(afterUndo?.category === (before?.category ?? null), `undo_ai_action() genuinely restored the real pre-change value (category back to the real pre-test value: ${JSON.stringify(before?.category ?? null)}, got: ${JSON.stringify(afterUndo?.category)})`);
    assert(afterUndo?.status === 'suggested', 'undo_ai_action() re-opened the suggestion for real manual review, not left confirmed');

    let repeatUndoRejected = false;
    try {
      await runSqlAs(ownerId, `select undo_ai_action('${actionId}');`);
    } catch (e) {
      repeatUndoRejected = true;
    }
    assert(repeatUndoRejected, 'a repeat undo on an already-reverted action is rejected, not silently re-applied');

    // ---------- Level 1: business_confirmed never auto-applies, even opted in ----------
    const confirmedSuggest = await runSqlAs(
      ownerId,
      `select record_business_attribute_suggestion('${partnerId}', 'category', 'retail_shopping', 'business_confirmed', null) as id;`
    );
    const confirmedSuggestId = confirmedSuggest?.[0]?.id;
    const [afterConfirmedSuggest] = await runSql(
      `select bp.category, bas.status from brand_partners bp, business_attribute_suggestions bas
       where bp.id = '${partnerId}' and bas.id = '${confirmedSuggestId}';`
    );
    assert(afterConfirmedSuggest?.category === (before?.category ?? null), 'a business_confirmed suggestion (the owner\'s own words) never auto-applies, even at trust_level>=1 (category unchanged)');
    assert(afterConfirmedSuggest?.status === 'suggested', 'it correctly stays a real, un-auto-applied "suggested" row');
    await runSql(`delete from business_attribute_suggestions where id = '${confirmedSuggestId}';`).catch(() => {});

    // ---------- Level 1: never auto-applies at trust_level=0 ----------
    await runSqlAs(ownerId, `select set_business_ai_trust_level('${partnerId}', 0);`);
    const zeroSuggest = await runSqlAs(
      ownerId,
      `select record_business_attribute_suggestion('${partnerId}', 'attribute', 'quiet', 'ai_inferred', 'test') as id;`
    );
    const zeroSuggestId = zeroSuggest?.[0]?.id;
    const [afterZeroSuggest] = await runSql(
      `select bp.attributes, bas.status from brand_partners bp, business_attribute_suggestions bas
       where bp.id = '${partnerId}' and bas.id = '${zeroSuggestId}';`
    );
    assert(!(afterZeroSuggest?.attributes || []).includes('quiet'), 'at trust_level=0 (the default), an ai_inferred suggestion never auto-applies -- zero behavior change');
    assert(afterZeroSuggest?.status === 'suggested', 'it correctly stays "suggested", waiting for real manual review');
    await runSql(`delete from business_attribute_suggestions where id = '${zeroSuggestId}';`).catch(() => {});

    // Back to Level 2 for the policy/auto-respond tests below.
    await runSqlAs(ownerId, `select set_business_ai_trust_level('${partnerId}', 2);`);

    // ---------- Level 2/3: upsert_business_ai_policy + the real auto-respond action ----------
    const [expResult] = await runSql(
      `insert into business_experiences (partner_id, title, description, price_level, party_type, active)
       values ('${partnerId}', 'Coffee Date', 'A real approved offer template.', '$$', 'date', true)
       returning id;`
    );
    experienceId = expResult?.id;
    assert(!!experienceId, 'a real business_experiences template exists to source the AI\'s own offer terms from');

    let strangerPolicyRejected = false;
    try {
      await runSqlAs(strangerId, `select upsert_business_ai_policy(null, '${partnerId}', 'Coffee Date Requests', 2, 'auto_respond_offer', '{"category":"Coffee","experience_id":"${experienceId}"}'::jsonb) as id;`);
    } catch (e) {
      strangerPolicyRejected = true;
    }
    assert(strangerPolicyRejected, 'upsert_business_ai_policy() rejects a caller who does not manage this business');

    const policyResult = await runSqlAs(
      ownerId,
      `select upsert_business_ai_policy(null, '${partnerId}', 'Coffee Date Requests', 2, 'auto_respond_offer', '{"category":"Coffee","experience_id":"${experienceId}"}'::jsonb) as id;`
    );
    policyId = policyResult?.[0]?.id;
    assert(!!policyId, 'the real owner can create a real, named Level 2 policy scoped to one real scenario');

    const [policyRow] = await runSql(`select name, trust_level, enabled, conditions from business_ai_policies where id = '${policyId}';`);
    assert(policyRow?.trust_level === 2 && policyRow?.enabled === true, 'the real policy row stores trust_level=2 and enabled=true correctly');

    // A real matching request (category="Coffee", matching the policy) --
    // should auto-fire a real offer using the experience's own real terms.
    const matchResult = await runSqlAs(
      requesterId,
      `select create_business_request('live-verify: AI trust engine auto-respond test (match)', 40.0, -75.0, 'Coffee', 2, null, 60, null, null, null, 15, null) as result;`
    );
    requestMatchId = matchResult?.[0]?.result?.requestId;
    assert(!!requestMatchId, 'create_business_request() with a matching category succeeds');

    const [offerRow] = await runSql(`select id, status, offer_price, offer_description from business_request_offers where request_id = '${requestMatchId}' and partner_id = '${partnerId}';`);
    offerMatchId = offerRow?.id;
    assert(offerRow?.status === 'offered', `a matching request is auto-responded to by the real named policy, not left pending (got: ${offerRow?.status})`);
    assert(Number(offerRow?.offer_price) === 35, 'the offer terms are honestly sourced from the real experience\'s own price_level ($$=35), never invented');
    assert((offerRow?.offer_description || '').includes('Coffee Date'), 'the offer description honestly names the real experience template');

    const [aiActionAuto] = await runSql(
      `select risk_level, approval_result, policy_id from ai_actions
       where partner_id = '${partnerId}' and action_type = 'auto_respond_offer'
       and (input_ref->>'request_id') = '${requestMatchId}';`
    );
    assert(aiActionAuto?.risk_level === 'medium', 'the logged risk_level for a fully pre-templated auto-sent offer is "medium" (per the locked reconciliation), not "high"');
    assert(aiActionAuto?.approval_result === 'auto_applied', 'a real ai_actions row logs this as auto_applied');
    assert(aiActionAuto?.policy_id === policyId, 'the logged action correctly references the real named policy that fired');

    // A real non-matching request (different category) -- should NOT
    // auto-fire an offer, and should log a real, specific "blocked" row.
    const mismatchResult = await runSqlAs(
      requesterId,
      `select create_business_request('live-verify: AI trust engine auto-respond test (mismatch)', 40.0, -75.0, 'Music', 2, null, 60, null, null, null, 15, null) as result;`
    );
    requestMismatchId = mismatchResult?.[0]?.result?.requestId;

    // A pending row from the general (non-AI) fan-out/policy matching is
    // still real and expected here -- fan-out doesn't filter by category.
    // What must NEVER happen is the AI path flipping it to 'offered'.
    const [mismatchOfferRow] = await runSql(
      `select status from business_request_offers where request_id = '${requestMismatchId}' and partner_id = '${partnerId}';`
    );
    assert(mismatchOfferRow?.status !== 'offered', `a non-matching category never gets an AI-auto-sent offer (status should not be 'offered', got: ${mismatchOfferRow?.status})`);
    const [mismatchAutoApplied] = await runSql(
      `select count(*)::int as c from ai_actions where partner_id = '${partnerId}' and (input_ref->>'request_id') = '${requestMismatchId}' and approval_result = 'auto_applied';`
    );
    assert(mismatchAutoApplied?.c === 0, 'no auto_applied ai_actions row exists for the non-matching request');

    const [blockedRow] = await runSql(
      `select outcome, risk_level, approval_result from ai_actions
       where partner_id = '${partnerId}' and policy_id = '${policyId}' and approval_result = 'blocked'
       and (input_ref->>'request_id') = '${requestMismatchId}';`
    );
    assert(blockedRow?.outcome === 'category_mismatch', `a real, specific "blocked" ai_actions row was logged with the right reason (got: ${blockedRow?.outcome})`);

    // Re-running the identical mismatch shouldn't double-log the same near-miss.
    const mismatchRepeat = await runSqlAs(
      requesterId,
      `select create_business_request('live-verify: AI trust engine auto-respond test (mismatch)', 40.0, -75.0, 'Music', 2, null, 60, null, null, null, 15, null) as result;`
    );
    const repeatDuplicate = mismatchRepeat?.[0]?.result?.duplicate === true;
    assert(repeatDuplicate, 'the identical repeat ask correctly hit the spam guard (proving no double-logging path was exercised a second time)');

    // ---------- regression: the untouched fulfillment-policy engine still works ----------
    await runSqlAs(ownerId, `select upsert_business_fulfillment_policy('${partnerId}', 2, 8, '17:00', '22:00', 40, 15, 4, 50, 2) as result;`).catch(async (e) => {
      // If a real policy already exists from an interrupted prior run, clean up first and retry once.
      await runSql(`delete from business_fulfillment_policies where partner_id = '${partnerId}';`);
      await runSqlAs(ownerId, `select upsert_business_fulfillment_policy('${partnerId}', 2, 8, '17:00', '22:00', 40, 15, 4, 50, 2) as result;`);
    });
    const fulfillmentResult = await runSqlAs(
      requesterId,
      `select create_business_request('live-verify: AI trust engine fulfillment-policy regression test', 40.0, -75.0, 'Coffee', 4, null, 60, null, '18:00', '20:00', 15, null) as result;`
    );
    const fulfillmentRequestId = fulfillmentResult?.[0]?.result?.requestId;
    const [fulfillmentOfferRow] = await runSql(
      `select status, offer_type from business_request_offers where request_id = '${fulfillmentRequestId}' and partner_id = '${partnerId}' and offer_type = 'standard' and offer_description like '%policy%';`
    );
    assert(fulfillmentOfferRow?.status === 'offered', 'the pre-existing business_fulfillment_policies auto-accept engine still fires exactly as before, completely unaffected by the new AI code path');
    await runSql(`delete from business_request_offers where request_id = '${fulfillmentRequestId}';`).catch(() => {});
    await runSql(`delete from business_requests where id = '${fulfillmentRequestId}';`).catch(() => {});
    await runSql(`delete from business_fulfillment_policies where partner_id = '${partnerId}';`).catch(() => {});
  } finally {
    if (offerMatchId) await runSql(`delete from business_request_offers where id = '${offerMatchId}';`).catch(() => {});
    if (requestMatchId) await runSql(`delete from business_request_offers where request_id = '${requestMatchId}';`).catch(() => {});
    if (requestMatchId) await runSql(`delete from ai_actions where (input_ref->>'request_id') = '${requestMatchId}';`).catch(() => {});
    if (requestMatchId) await runSql(`delete from business_match_exclusions where request_id = '${requestMatchId}';`).catch(() => {});
    if (requestMatchId) await runSql(`delete from business_requests where id = '${requestMatchId}';`).catch(() => {});
    if (requestMismatchId) await runSql(`delete from business_request_offers where request_id = '${requestMismatchId}';`).catch(() => {});
    if (requestMismatchId) await runSql(`delete from ai_actions where (input_ref->>'request_id') = '${requestMismatchId}';`).catch(() => {});
    if (requestMismatchId) await runSql(`delete from business_match_exclusions where request_id = '${requestMismatchId}';`).catch(() => {});
    if (requestMismatchId) await runSql(`delete from business_requests where id = '${requestMismatchId}';`).catch(() => {});
    if (suggestionId) await runSql(`delete from ai_actions where (input_ref->>'suggestion_id') = '${suggestionId}';`).catch(() => {});
    if (suggestionId) await runSql(`delete from business_attribute_suggestions where id = '${suggestionId}';`).catch(() => {});
    if (policyId) await runSql(`delete from ai_actions where policy_id = '${policyId}';`).catch(() => {});
    if (policyId) await runSql(`delete from business_ai_policies where id = '${policyId}';`).catch(() => {});
    if (experienceId) await runSql(`delete from business_experiences where id = '${experienceId}';`).catch(() => {});
    await runSql(`delete from business_fulfillment_policies where partner_id = '${partnerId}';`).catch(() => {});
    await runSql(
      `update brand_partners set
         latitude = ${before?.latitude === null || before?.latitude === undefined ? 'null' : before.latitude},
         longitude = ${before?.longitude === null || before?.longitude === undefined ? 'null' : before.longitude},
         tier = '${before?.tier || 'basic'}',
         ai_trust_level = ${before?.ai_trust_level ?? 0},
         category = ${before?.category === null || before?.category === undefined ? 'null' : `'${before.category}'`}
       where id = '${partnerId}';`
    ).catch(() => {});
    console.log('  (cleanup) all test rows deleted, partner coordinates/tier/ai_trust_level reverted');
  }

  const [finalCheck] = await runSql(
    `select (select count(*) from business_ai_policies) as policies,
            (select count(*) from ai_actions) as actions,
            (select count(*) from business_experiences) as experiences,
            (select count(*) from business_requests) as requests,
            (select count(*) from business_fulfillment_policies) as fulfillment_policies;`
  );
  assert(
    finalCheck?.policies === 0 && finalCheck?.actions === 0 && finalCheck?.experiences === 0
      && finalCheck?.requests === 0 && finalCheck?.fulfillment_policies === 0,
    `production is back to its exact pre-test baseline (0 policies, 0 actions, 0 experiences, 0 requests, 0 fulfillment policies) -- got ${JSON.stringify(finalCheck)}`
  );

  summarize('ai-trust-engine');
}

main().catch((e) => {
  console.error('ai-trust-engine: script itself failed to run:', e.message);
  process.exitCode = 1;
});
