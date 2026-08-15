const { runSql } = require('/workspaces/Nearby/scripts/live-verify/lib/db.js');

(async () => {
  const idx = await runSql(`
    select indexname, indexdef from pg_indexes where tablename = 'business_requests' order by indexname;
  `);
  console.log('business_requests indexes:', JSON.stringify(idx, null, 2));

  const idx2 = await runSql(`
    select indexname, indexdef from pg_indexes where tablename = 'brand_partners' order by indexname;
  `);
  console.log('brand_partners indexes:', JSON.stringify(idx2, null, 2));

  const idx3 = await runSql(`
    select indexname, indexdef from pg_indexes where tablename = 'intent_submissions' order by indexname;
  `);
  console.log('intent_submissions indexes:', JSON.stringify(idx3, null, 2));

  const rls = await runSql(`
    select polname, cmd, qual from pg_policies where tablename = 'business_requests';
  `);
  console.log('business_requests RLS:', JSON.stringify(rls, null, 2));
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
