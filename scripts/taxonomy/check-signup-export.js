#!/usr/bin/env node
// Production check: is the static signup page's embedded taxonomy stale against the LIVE server taxonomy?
//   SUPABASE_ACCESS_TOKEN=... node scripts/taxonomy/check-signup-export.js     (exit 1 when stale)
// The server keeps translating old names meanwhile (submit-business-application -> resolve_category_tag).
const fs = require('fs');
const path = require('path');
const { staleness } = require('./signupExport');
const { runSql } = require('../live-verify/lib/db');

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'business.html'), 'utf8');
  const [{ s }] = await runSql('select get_category_taxonomy() as s');
  const report = staleness(html, s);
  console.log(JSON.stringify(report, null, 1));
  if (report.stale) {
    console.error('STALE: adopt the change in src/constants, run regenerate-signup-export.js, rebuild + sync the inventory.');
    process.exit(1);
  }
  console.log(`docs/business.html matches the server taxonomy (version ${report.serverVersion}).`);
})().catch((e) => { console.error(e.message); process.exit(1); });
