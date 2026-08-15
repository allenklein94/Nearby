const fs = require('fs');
const { runSql, runSqlAs } = require('/workspaces/Nearby/scripts/live-verify/lib/db.js');

const ALLEN = 'ee74f1a9-9996-465d-a674-c60bc63fbfca'; // real profile, used as a disposable requester
const HIGH_REL = 'aaaaaaaa-c001-4000-8000-000000000001';
const NO_HIST = 'aaaaaaaa-c001-4000-8000-000000000002';

const results = {};

async function cleanup() {
  await runSql(`delete from business_request_offers where partner_id in ('${HIGH_REL}', '${NO_HIST}');`);
  await runSql(`delete from business_requests where raw_text like 'V2PHASEC%';`);
  await runSql(`delete from brand_partners where id in ('${HIGH_REL}', '${NO_HIST}');`);
  const check = await runSql(`select count(*) from brand_partners;`);
  results.postCleanupPartnerCount = check;
  const check2 = await runSql(`select count(*) from business_requests;`);
  results.postCleanupRequestCount = check2;
}

(async () => {
  try {
    const sql = fs.readFileSync('/workspaces/Nearby/supabase/migrations/20260815_v3_reliability_weighted_fanout.sql', 'utf8');
    await runSql(sql);
    results.applied = true;

    // Two disposable test partners at the exact same real coordinates --
    // one with a real, established (5+) 100%-completion track record, one
    // genuinely brand new. Both real DB rows, both deleted in cleanup().
    await runSql(`
      insert into brand_partners (id, name, active, latitude, longitude)
      values
        ('${HIGH_REL}', 'V2PHASEC HighReliability Test', true, 40.700, -74.000),
        ('${NO_HIST}', 'V2PHASEC NoHistory Test', true, 40.700, -74.000);
    `);

    // Give HIGH_REL 5 real, distinct, completed historical opportunities
    // (partial-unique-index requires a distinct request per partner offer).
    for (let i = 0; i < 5; i++) {
      const req = await runSql(`
        insert into business_requests (requester_id, raw_text, latitude, longitude, radius_miles, expires_at)
        values ('${ALLEN}', 'V2PHASEC history filler ${i}', 40.700, -74.000, 15, now() + interval '1 day')
        returning id;
      `);
      const reqId = req[0].id;
      await runSql(`insert into business_request_offers (request_id, partner_id, status) values ('${reqId}', '${HIGH_REL}', 'completed');`);
    }

    const repCheck = await runSql(`select * from get_partner_offer_reputation('${HIGH_REL}');`);
    results.highRelReputation = repCheck;
    // EXPECT: total_opportunities 5, completion_rate 100.0

    // Now the real live request, and call the fan-out directly.
    const liveReq = await runSql(`
      insert into business_requests (requester_id, raw_text, latitude, longitude, radius_miles, expires_at)
      values ('${ALLEN}', 'V2PHASEC live fanout test', 40.700, -74.000, 15, now() + interval '1 day')
      returning id;
    `);
    const liveReqId = liveReq[0].id;

    await runSql(`select public._business_request_fanout('${liveReqId}'::uuid, 40.700, -74.000, 15);`);

    const order = await runSql(`
      select bo.partner_id, bp.name, bo.ctid
      from business_request_offers bo join brand_partners bp on bp.id = bo.partner_id
      where bo.request_id = '${liveReqId}'
      order by bo.ctid asc;
    `);
    results.fanoutOrder_expectHighRelBeforeNoHistory = order;

  } catch (e) {
    results.ERROR = { message: e.message, body: e.body };
  } finally {
    await cleanup();
  }
  console.log(JSON.stringify(results, null, 2));
})();
