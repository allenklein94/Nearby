#!/usr/bin/env node
// The ONE production migration apply path (owner, 2026-10-24). See scripts/migrations/ledger.js.
//   node scripts/migrations/deploy.js <migration file> --target=prod|local [--check]
// Needs (both targets, so the gate is the same one the tests prove):
//   NEARBY_PROD_APPROVAL=<version>:<sha256 of the committed file>   the owner's approval of exactly this file
//   NEARBY_APPROVAL_REF="owner, 2026-10-24, chat: ..."              where/when it was approved (stored in the ledger)
//   NEARBY_SESSION_ID=<session id>                                   the deploying session (stored in the ledger)
// --check = verification mode: every refusal check + the migration and its ledger row in a transaction that is ALWAYS
// rolled back (never committed). Without --check: one transaction, migration + ledger row, then the row is read back.
const path = require('path');
const L = require('./ledger');

const REPO = path.resolve(__dirname, '../..');

async function main(argv, env = process.env, repoRoot = REPO) {
  const file = argv.find((a) => !a.startsWith('--'));
  const target = (argv.find((a) => a.startsWith('--target=')) || '').split('=')[1];
  const check = argv.includes('--check');
  if (!file) throw new Error('usage: deploy.js <migration file> --target=prod|local [--check]');
  const { name, run } = L.runner(target);
  const facts = L.migrationFacts(file, repoRoot);
  const ledger = await L.readLedger(run);
  const refusals = L.preflight({ facts, env, ledger });
  console.log(`target: ${name}\nmigration: ${facts.rel}\nversion: ${facts.version}\nsha256: ${facts.sha256}\ncommit: ${facts.commit}`);
  if (refusals.length) {
    console.error(`REFUSED (nothing sent):\n- ${refusals.join('\n- ')}`);
    return 2;
  }
  if (check) {
    try { await run(L.dryRunSql(facts, env)); } catch (e) {
      if ((e.message || '').includes(L.DRY_RUN_MARK)) { console.log('CHECK OK: applies cleanly with its ledger row (rolled back; nothing committed)'); return 0; }
      console.error(`CHECK FAILED (rolled back; nothing committed): ${e.message}`);
      return 1;
    }
    console.error('CHECK FAILED: the dry run did not end in its rollback marker');
    return 1;
  }
  try { await run(L.deploySql(facts, env)); } catch (e) {
    console.error(`DEPLOY FAILED (the transaction did not commit; migration and record both absent): ${e.message}`);
    return 1;
  }
  const after = await L.readLedger(run);
  const row = after.rows.find((x) => x.version === facts.version);
  if (!row || row.file_sha256 !== facts.sha256) {
    console.error('DEPLOY UNCONFIRMED: no matching ledger row read back. Run status.js before anything else.');
    return 1;
  }
  console.log(`DEPLOYED + RECORDED: ${JSON.stringify(row)}`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(1); });
}
module.exports = { main };
