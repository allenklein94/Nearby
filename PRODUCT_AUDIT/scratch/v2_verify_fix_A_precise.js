const { runSql, runSqlAs } = require('/workspaces/Nearby/scripts/live-verify/lib/db.js');

const ALLEN = 'ee74f1a9-9996-465d-a674-c60bc63fbfca';
const CLAUDE = '0d7cecd9-721f-4632-8b1f-44b866d1892b';
const GVOICE = 'e9f74b5a-d1df-4a82-968c-a0f6a73c128a';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};

async function cleanup() {
  await runSql(`delete from business_requests where raw_text like 'V2FIXA%';`);
  await runSql(`update profiles set intent_visibility = 'friends_and_matches' where id in ('${CLAUDE}','${GVOICE}');`);
  const check = await runSql(`select count(*) from business_requests;`);
  results.postCleanupBaseline = check;
}

(async () => {
  try {
    // Stable baseline, waited out so no in-flight async pushes are pending.
    await sleep(4000);
    const stableBefore = await runSql(`select count(*) from net._http_response;`);
    results.stableBefore = stableBefore;

    await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date)
      values ('${CLAUDE}', 'V2FIXA req1', 'Sports', 'open', now() + interval '1 day', 40.001, -75.001, 15, current_date + 1);
    `);
    await sleep(2000);
    const afterReq1 = await runSql(`select count(*) from net._http_response;`);
    results.afterReq1_shouldBeUnchanged = afterReq1;

    // req2 (Google voice) crosses the real 1->2 threshold -- exactly one
    // legitimate push expected here.
    await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date)
      values ('${GVOICE}', 'V2FIXA req2', 'Sports', 'open', now() + interval '1 day', 40.002, -75.002, 15, current_date + 2);
    `);
    await sleep(3000);
    const afterReq2 = await runSql(`select count(*) from net._http_response;`);
    results.afterReq2_shouldBeStableBeforePlus1 = afterReq2;

    // Now Claude opts out, and Claude submits ANOTHER request in the same
    // category. Under the fix, this new row's own requester is opted out,
    // so the trigger should bail before ever reaching the push logic --
    // no additional push, even though a naive re-check might otherwise
    // think a 3rd request "confirms" the pattern.
    await runSql(`update profiles set intent_visibility = 'nobody' where id = '${CLAUDE}';`);
    await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date)
      values ('${CLAUDE}', 'V2FIXA req3 opted out', 'Sports', 'open', now() + interval '1 day', 40.003, -75.003, 15, current_date + 3);
    `);
    await sleep(4000);
    const afterReq3_optedOut = await runSql(`select count(*) from net._http_response;`);
    results.afterReq3_optedOutRequester_shouldEqualAfterReq2 = afterReq3_optedOut;

    await runSql(`update profiles set intent_visibility = 'friends_and_matches' where id = '${CLAUDE}';`);

  } catch (e) {
    results.ERROR = { message: e.message, body: e.body };
  } finally {
    await cleanup();
  }
  console.log(JSON.stringify(results, null, 2));
})();
