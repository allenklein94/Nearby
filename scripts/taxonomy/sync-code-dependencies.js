#!/usr/bin/env node
// Pushes scripts/taxonomy/code-dependencies.json to production (sync_category_code_dependencies) and prints which
// open taxonomy follow-ups the current code resolved. Run after the code change that adopts a taxonomy change is merged:
//   SUPABASE_ACCESS_TOKEN=... node scripts/taxonomy/sync-code-dependencies.js
// Refuses to sync an inventory that does not match the code on disk (rebuild it first).
// Approval gate (owner, 2026-11-28, after the unread run of 2026-11-27): WRITES PRODUCTION only with
//   NEARBY_TAXONOMY_SYNC_APPROVAL=<code printed by `plan`>
// The code binds the exact row difference (production -> committed inventory) and the commit; any other difference, a
// dirty tree or a commit that is not origin/main refuses before anything is written.
//   SUPABASE_ACCESS_TOKEN=... node scripts/taxonomy/sync-code-dependencies.js plan     READ-ONLY: difference + code
const { execSync } = require('child_process');
const path = require('path');
const { ROOT, requireSrc } = require('./loadSrc');
const { buildInventory } = require('./codeDependencies');
const crypto = require('crypto');
const { runSql } = require('../live-verify/lib/db');

const keyOf = (r) => `${r.tag}\u0000${r.file}\u0000${r.consumer}`;
// Pure: production rows vs committed rows -> sorted difference.
function inventoryDiff(prodRows, committedRows) {
  const prod = new Map(prodRows.map((r) => [keyOf(r), r]));
  const next = new Map(committedRows.map((r) => [keyOf(r), r]));
  const out = [];
  for (const [k, r] of next) {
    const was = prod.get(k);
    if (!was) out.push({ change: 'new', tag: r.tag, file: r.file, consumer: r.consumer, occurrences: r.occurrences });
    else if (was.occurrences !== r.occurrences || (was.group ?? null) !== (r.group ?? null)) {
      out.push({ change: 'changed', tag: r.tag, file: r.file, consumer: r.consumer, from: was.occurrences, occurrences: r.occurrences });
    }
  }
  for (const [k, r] of prod) if (!next.has(k)) out.push({ change: 'removed', tag: r.tag, file: r.file, consumer: r.consumer });
  return out.sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
}
const approvalCode = (diff, commit) => `taxonomy-sync:${crypto.createHash('sha256').update(JSON.stringify({ diff, commit })).digest('hex').slice(0, 24)}`;

async function productionRows() {
  const rows = await runSql(`select tag_name as tag, source_file as file, consumer, occurrences, placement_group as "group"
    from category_code_dependencies`);
  return Array.isArray(rows) ? rows : [];
}

module.exports = { inventoryDiff, approvalCode };

if (require.main === module) (async () => {
  const committed = require('./code-dependencies.json');
  const { CATEGORY_GROUPS } = requireSrc('constants/gatheringCategories.js');
  if (JSON.stringify(buildInventory(ROOT, CATEGORY_GROUPS)) !== JSON.stringify(committed)) {
    console.error('code-dependencies.json is stale: run node scripts/taxonomy/build-code-dependencies.js and commit it.');
    process.exit(1);
  }
  const commit = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
  const dirty = execSync('git status --porcelain -- src docs scripts/taxonomy', { cwd: ROOT }).toString().trim();
  const source = dirty ? `${commit}+uncommitted` : commit;
  const diff = inventoryDiff(await productionRows(), committed.rows);
  const code = approvalCode(diff, commit);
  if (process.argv[2] === 'plan') {
    console.log(JSON.stringify({ commit: source, difference: diff, approval_code: diff.length ? code : null }, null, 1));
    return;
  }
  const mainHead = execSync('git rev-parse origin/main', { cwd: ROOT }).toString().trim();
  const refusals = [];
  if (dirty) refusals.push('working tree has uncommitted changes in src/docs/scripts/taxonomy');
  if (commit !== mainHead) refusals.push(`HEAD ${commit.slice(0, 9)} is not origin/main ${mainHead.slice(0, 9)} (sync only from merged main)`);
  if (!diff.length) refusals.push('production already matches: nothing to sync');
  if (process.env.NEARBY_TAXONOMY_SYNC_APPROVAL !== code) refusals.push('NEARBY_TAXONOMY_SYNC_APPROVAL is not the code `plan` prints for this exact difference');
  if (refusals.length) { console.error(`refused, nothing written:\n- ${refusals.join('\n- ')}`); process.exit(1); }
  const payload = JSON.stringify(committed).replace(/'/g, "''");
  const [res] = await runSql(`select sync_category_code_dependencies('${payload}'::jsonb, '${source}') as r`);
  console.log(`synced ${path.basename(__dirname)}/code-dependencies.json @ ${source}:`, JSON.stringify(res.r));
})().catch((e) => { console.error(e.message); process.exit(1); });
