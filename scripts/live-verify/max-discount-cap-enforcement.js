#!/usr/bin/env node
// max_discount_pct is enforced server-side (migration 20261230) at ONE chokepoint, the
// business_request_offers trigger, for every path that makes an offer 'offered':
//   manual submit_business_offer, availability posting, availability-sourced auto-offers,
//   and the policy auto-accept pass. Coastal Coffee-style temporary coordinates, full cleanup.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/max-discount-cap-enforcement.js
const { runSql, runSqlAs, assert, summarize } = require('./lib/db');

async function rejects(fn) {
  try { await fn(); return null; } catch (e) { return e.message || String(e); }
}

async function main() {
  console.log('max-discount-cap-enforcement: verifying the discount cap on every offer path...');
  const [partnerRow] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  if (!partnerRow) throw new Error('Needs a real profile managing a business.');
  const ownerId = partnerRow.id;
  const partnerId = partnerRow.managed_partner_id;
  const [req] = await runSql(`select id from profiles where id <> '${ownerId}' order by created_at limit 1;`);
  const requesterId = req.id;
  const [beforeCoords] = await runSql(`select latitude, longitude from brand_partners where id = '${partnerId}';`);
  const [beforePolicy] = await runSql(`select count(*)::int c from business_fulfillment_policies where partner_id = '${partnerId}';`);
  if (beforePolicy.c !== 0) throw new Error('Partner already has a policy; refusing to overwrite production data.');

  const requestIds = [];
  const newRequest = async (label, partySize = 6) => {
    // the spam guard allows 5 open requests per person: clear earlier ones first
    for (const old of requestIds.splice(0)) {
      await runSql(`delete from business_request_offers where request_id = '${old}';`);
      await runSql(`delete from business_requests where id = '${old}';`);
    }
    const r = await runSqlAs(requesterId, `select create_business_request('live-verify: ${label}', 40.0, -75.0, 'Coffee', ${partySize}, null, 60, null, '18:00', '20:00', 15, null) as result;`);
    const id = r?.[0]?.result?.requestId;
    requestIds.push(id);
    return id;
  };
  const setPolicy = (cap, active = true) => runSqlAs(ownerId, `select upsert_business_fulfillment_policy('${partnerId}', 2, 8, '17:00', '22:00', 40, ${cap}, 4, 50, 2, ${active}) as result;`);
  const submit = (requestId, type, pct) => runSqlAs(ownerId, `select submit_business_offer('${requestId}', '${type}', 'live-verify offer', null, null, null, null, null, null, '{}', false, ${pct === null ? 'null' : pct}) as result;`);
  const offerOf = async (requestId) => (await runSql(`select status, offer_type, discount_pct from business_request_offers where request_id = '${requestId}' and partner_id = '${partnerId}';`))[0];

  try {
    await runSql(`update brand_partners set latitude = 40.0, longitude = -75.0 where id = '${partnerId}';`);

    // ---- no policy / null cap: existing behavior, no limit and no required percentage ----
    let r = await newRequest('no policy');
    await submit(r, 'discount', null);
    assert((await offerOf(r)).status === 'offered', 'no policy: a discount offer with no percentage is allowed (no new default)');

    // ---- cap 15 ----
    await setPolicy(15);
    r = await newRequest('at cap');
    await submit(r, 'discount', 15);
    let o = await offerOf(r);
    assert(o.status === 'offered' && Number(o.discount_pct) === 15, 'discount AT the cap (15) is allowed and stored');

    r = await newRequest('below cap');
    await submit(r, 'discount', 10);
    assert((await offerOf(r)).status === 'offered', 'discount BELOW the cap (10) is allowed');

    r = await newRequest('above cap');
    let err = await rejects(() => submit(r, 'discount', 15.5));
    assert(err && err.includes('above your maximum discount of 15%'), `discount ABOVE the cap is rejected with a clear error (${err})`);
    assert((await offerOf(r)).status === 'pending', 'the rejected offer left the request pending (nothing written)');

    err = await rejects(() => submit(r, 'discount', null));
    assert(err && err.includes('Enter the discount percentage'), 'a discount offer with no percentage is rejected while a cap is set (cap cannot be verified)');

    err = await rejects(() => submit(r, 'perk', 40));
    assert(err && err.includes('above your maximum'), 'the cap applies to any offer_type that states a discount, not just type=discount');

    await submit(r, 'perk', null);
    assert((await offerOf(r)).status === 'offered', 'a non-discount offer with no percentage is unaffected by the cap');

    // ---- inactive policy: cap not in force ----
    await setPolicy(15, false);
    r = await newRequest('inactive policy');
    await submit(r, 'discount', 90);
    assert((await offerOf(r)).status === 'offered', 'an inactive policy imposes no cap (existing behavior)');

    // ---- auto-accept (policy pass) ----
    await setPolicy(15, true);
    r = await newRequest('auto-accept 4', 4);
    o = await offerOf(r);
    assert(o.status === 'offered' && o.offer_type === 'standard' && o.discount_pct === null, 'policy auto-accept (a standard, no-discount offer) still auto-offers under a cap');

    // ---- availability postings ----
    const post = (pct) => runSqlAs(ownerId, `select post_business_availability('Coffee', 'live-verify posting', 'd', 'discount', null, 20, now(), now() + interval '2 hours', 15, null, null, ${pct === null ? 'null' : pct}) as result;`);
    err = await rejects(() => post(30));
    assert(err && err.includes('above your maximum'), 'an availability posting over the cap is rejected at posting time');
    err = await rejects(() => post(null));
    assert(err && err.includes('Enter the discount percentage'), 'a discount posting with no percentage is rejected while a cap is set');

    const before = await newRequest('pre-posting request', 6);
    await post(10);
    o = await offerOf(before);
    assert(o.status === 'offered' && Number(o.discount_pct) === 10, 'a compliant availability posting auto-offers and the offer inherits its discount_pct');

    // cap lowered AFTER the posting: new matching requests must NOT be auto-offered the over-cap discount
    await setPolicy(5, true);
    r = await newRequest('after cap lowered', 6);
    o = await offerOf(r);
    assert(o.status === 'pending', `an availability auto-offer now over the (lowered) cap is NOT created and does not abort the fan-out (status ${o?.status})`);
  } finally {
    for (const id of requestIds.filter(Boolean)) {
      await runSql(`delete from business_request_offers where request_id = '${id}';`).catch(() => {});
      await runSql(`delete from business_requests where id = '${id}';`).catch(() => {});
    }
    await runSql(`delete from business_availability where partner_id = '${partnerId}' and title = 'live-verify posting';`).catch(() => {});
    await runSql(`delete from business_fulfillment_policies where partner_id = '${partnerId}';`).catch(() => {});
    await runSql(`update brand_partners set latitude = ${beforeCoords?.latitude === null ? 'null' : beforeCoords.latitude}, longitude = ${beforeCoords?.longitude === null ? 'null' : beforeCoords.longitude} where id = '${partnerId}';`).catch(() => {});
    console.log('  (cleanup) test rows deleted, partner coordinates reverted');
  }
  summarize('max-discount-cap-enforcement');
}

main().catch((e) => { console.error('max-discount-cap-enforcement: failed to run:', e.message); process.exitCode = 1; });
