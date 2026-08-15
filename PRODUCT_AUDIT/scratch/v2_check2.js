const { runSql } = require('/workspaces/Nearby/scripts/live-verify/lib/db.js');

(async () => {
  const f = await runSql(`select user_a, user_b, status from friendships;`);
  console.log('friendships:', JSON.stringify(f));
  const m = await runSql(`select user_a, user_b from matches;`);
  console.log('matches:', JSON.stringify(m));
  const p = await runSql(`select id, latitude, longitude, active, name from brand_partners;`);
  console.log('partners:', JSON.stringify(p));
})().catch((e) => {
  console.error('ERROR', e.message, JSON.stringify(e.body));
  process.exit(1);
});
