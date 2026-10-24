#!/usr/bin/env node
// First real-phone session: seed the TEST data the run order's setup needs (S4 gatherings, S5 business, S6 friend).
//   node scripts/phone-session/seed.js plan                      read-only: what would be created, and an approval code
//   node scripts/phone-session/seed.js apply                     write (a LOCAL test database only)
//   node scripts/phone-session/seed.js apply --production --confirm=<code from plan>   production, after owner approval
//   node scripts/phone-session/seed.js status                    read-only: which seeded rows exist now
// Target: NEARBY_LOCAL_DB_URL set = that local database; otherwise production via SUPABASE_ACCESS_TOKEN.
// Settings (env): SEED_LAT, SEED_LNG (required: where the phone will be), SEED_TZ (default America/New_York),
// SESSION_DATE (YYYY-MM-DD) + SESSION_START (HH:MM) (required on production), FRIEND_ACCOUNT_EMAIL, BUSINESS_OWNER_EMAIL,
// BUSINESS_NAME, BUSINESS_ADDRESS, BUSINESS_LAT, BUSINESS_LNG. Rerunning is safe: existing seeded rows are left as they are.
const L = require('./lib');

async function main() {
  const [mode = 'plan', ...flags] = process.argv.slice(2);
  const flag = (name) => flags.find((f) => f === `--${name}` || f.startsWith(`--${name}=`));
  console.log(`Target: ${L.target()}`);
  if (mode === 'status') return console.log(JSON.stringify((await L.run(L.statusSql()))[0].status, null, 2));
  if (!['plan', 'apply'].includes(mode)) throw new Error(`unknown mode ${mode} (plan | apply | status)`);

  const c = L.config();
  const plan = (await L.run(L.planSql(c)))[0].plan;
  // the code covers what would be written (settings + every row, incl. which gatherings are already too soon), never the clock
  // reading itself: otherwise it changed every minute and no approved code could ever match at apply time
  const { now_local: _clock, ...planRows } = plan;
  const code = L.hash({ c, plan: planRows });
  if (mode === 'plan') {
    console.log(JSON.stringify(plan, null, 2));
    const blockers = [];
    if (plan.friend_account && !plan.friend_account.found) blockers.push(`no account with FRIEND_ACCOUNT_EMAIL ${plan.friend_account.email}`);
    if (plan.business_owner_account && !(plan.business_owner_account.found && plan.business_owner_account.has_profile)) blockers.push(`no Nearby account with BUSINESS_OWNER_EMAIL ${plan.business_owner_account.email}`);
    if (plan.business_owner_account?.manages_other_business) blockers.push('BUSINESS_OWNER_EMAIL already manages another business');
    const late = (plan.gatherings || []).filter((g) => g.too_soon && !g.exists_already);
    if (late.length) console.log(`\nNote: ${late.length} gathering(s) start too soon or in the past and will be SKIPPED: ${late.map((g) => g.key).join(', ')}`);
    if (blockers.length) console.log(`\nBLOCKED (apply will refuse):\n- ${blockers.join('\n- ')}`);
    console.log(`\nApproval code for exactly this plan: ${code}`);
    return;
  }
  if (!L.isLocal()) {
    if (!flag('production')) throw new Error('this would write to PRODUCTION: refusing without --production (and only after the owner approved the plan)');
    const given = (flag('confirm') || '').split('=')[1];
    if (given !== code) throw new Error(`the plan's approval code is ${code}; --confirm=${given || '(none)'} does not match, so the plan changed or was not approved. Nothing written.`);
  }
  const out = await L.run(L.seedSql(c));
  console.log(JSON.stringify(out[out.length - 1].result, null, 2));
  console.log(JSON.stringify((await L.run(L.statusSql()))[0].status, null, 2));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
