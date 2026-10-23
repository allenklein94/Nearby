#!/usr/bin/env node
// First real-phone session: remove ONLY what seed.js created (fixed ids), with everything that depends on it.
//   node scripts/phone-session/cleanup.js plan                    dry run (always rolled back): exact rows each table loses
//   node scripts/phone-session/cleanup.js apply --confirm=<code>  delete (a LOCAL test database), only if the result still
//                                                                  matches that dry run
//   node scripts/phone-session/cleanup.js apply --production --confirm=<code>   production, after owner approval
// Target: NEARBY_LOCAL_DB_URL set = that local database; otherwise production via SUPABASE_ACCESS_TOKEN.
// Never touches: the real accounts themselves (only the business-owner link is cleared), gatherings real accounts host,
// business requests real accounts sent (they stay, minus their rows to the test business; the plan counts them).
const L = require('./lib');

async function main() {
  const [mode = 'plan', ...flags] = process.argv.slice(2);
  const flag = (name) => flags.find((f) => f === `--${name}` || f.startsWith(`--${name}=`));
  console.log(`Target: ${L.target()}`);
  if (mode === 'plan') {
    try {
      await L.run(L.cleanupSql({ dryRun: true }));
    } catch (e) {
      const m = /PHONE_SESSION_DRY_RUN (\{.*\})/s.exec(e.message || '');
      if (!m) throw e;
      const report = JSON.parse(m[1]);
      console.log(JSON.stringify(report, null, 2));
      console.log(`\nDry run only: nothing was deleted. Approval code for exactly this deletion: ${report.confirm}`);
      return;
    }
    throw new Error('dry run did not report');
  }
  if (mode !== 'apply') throw new Error(`unknown mode ${mode} (plan | apply)`);
  const code = (flag('confirm') || '').split('=')[1];
  if (!code) throw new Error('apply needs --confirm=<code> from a dry run (cleanup.js plan)');
  if (!L.isLocal() && !flag('production')) throw new Error('this would delete from PRODUCTION: refusing without --production (and only after the owner approved the dry run)');
  const out = await L.run(L.cleanupSql({ dryRun: false, expect: code }));
  console.log(JSON.stringify(out[out.length - 1].report, null, 2));
  console.log(JSON.stringify((await L.run(L.statusSql()))[0].status, null, 2));
}

main().catch((e) => {
  console.error((e.message || String(e)).replace(/^.*PHONE_SESSION_MISMATCH /s, ''));
  process.exit(1);
});
