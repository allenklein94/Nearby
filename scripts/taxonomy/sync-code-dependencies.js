#!/usr/bin/env node
// Pushes scripts/taxonomy/code-dependencies.json to production (sync_category_code_dependencies) and prints which
// open taxonomy follow-ups the current code resolved. Run after the code change that adopts a taxonomy change is merged:
//   SUPABASE_ACCESS_TOKEN=... node scripts/taxonomy/sync-code-dependencies.js
// Refuses to sync an inventory that does not match the code on disk (rebuild it first).
const { execSync } = require('child_process');
const path = require('path');
const { ROOT, requireSrc } = require('./loadSrc');
const { buildInventory } = require('./codeDependencies');
const { runSql } = require('../live-verify/lib/db');

(async () => {
  const committed = require('./code-dependencies.json');
  const { CATEGORY_GROUPS } = requireSrc('constants/gatheringCategories.js');
  if (JSON.stringify(buildInventory(ROOT, CATEGORY_GROUPS)) !== JSON.stringify(committed)) {
    console.error('code-dependencies.json is stale: run node scripts/taxonomy/build-code-dependencies.js and commit it.');
    process.exit(1);
  }
  const commit = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
  const dirty = execSync('git status --porcelain -- src docs scripts/taxonomy', { cwd: ROOT }).toString().trim();
  const source = dirty ? `${commit}+uncommitted` : commit;
  const payload = JSON.stringify(committed).replace(/'/g, "''");
  const [res] = await runSql(`select sync_category_code_dependencies('${payload}'::jsonb, '${source}') as r`);
  console.log(`synced ${path.basename(__dirname)}/code-dependencies.json @ ${source}:`, JSON.stringify(res.r));
})().catch((e) => { console.error(e.message); process.exit(1); });
