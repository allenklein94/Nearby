#!/usr/bin/env node
// Read-only migration status (owner, 2026-10-24): repo migrations vs private.migration_ledger.
//   node scripts/migrations/status.js --target=prod|local [--all]
// Sends only ledger.js's two single SELECTs; never writes. Default lists versions after the pre-ledger baseline; --all lists every file.
const path = require('path');
const L = require('./ledger');

async function main(argv, repoRoot = path.resolve(__dirname, '../..')) {
  const target = (argv.find((a) => a.startsWith('--target=')) || '').split('=')[1];
  const { name, run } = L.runner(target);
  const ledger = await L.readLedger(run);
  const report = L.statusReport(L.repoMigrations(repoRoot), ledger)
    .filter((r) => argv.includes('--all') || r.version > L.BASELINE_MAX);
  console.log(`target: ${name}\nledger: ${ledger.exists ? `${ledger.rows.length} row(s)` : 'NOT PRESENT'}`);
  for (const r of report) console.log(`${r.version}  ${r.state}${r.applied_at ? `  applied ${r.applied_at}` : ''}  ${r.rel}`);
  return report.some((r) => /MISMATCH/.test(r.state)) ? 3 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(1); });
}
module.exports = { main };
