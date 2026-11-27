#!/usr/bin/env node
// Generates PRODUCT_AUDIT/MIGRATION_APPROVAL_PACKETS_0348-0433.md: one approval packet per pending migration, in deploy order.
// Read-only: reads committed files at HEAD (the same bytes deploy.js hashes), writes only the packet document.
// A listed code is NOT an approval: the owner gives each NEARBY_PROD_APPROVAL separately, after that migration's preconditions pass.
// Usage: node scripts/catchup/approval-packets.js [--out <path>]
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'buffer', maxBuffer: 64 << 20 });
const head = git('rev-parse', 'HEAD').toString().trim();
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? process.argv[outArg + 1] : path.join(root, 'PRODUCT_AUDIT', 'MIGRATION_APPROVAL_PACKETS_0348-0433.md');

const FIRST = '20270348';
const LAST = '20270433';
const tracked = (dir) => git('ls-tree', '--name-only', `HEAD:${dir}`).toString().split('\n').filter(Boolean);
const migs = tracked('supabase/migrations').filter((f) => f.endsWith('.sql') && f.slice(0, 8) >= FIRST && f.slice(0, 8) <= LAST).sort();
const rollbacks = tracked('scripts/rollback');
const journeys = tracked('src/journeys').filter((f) => f.endsWith('.journey.js'));
const journeyText = Object.fromEntries(journeys.map((j) => [j, git('show', `HEAD:src/journeys/${j}`).toString()]));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Batches (plan section 4). Phase 1 = Wall A (build 87 everywhere + Tier 1 + verified backup). Phase 2 = Wall B.
const BATCHES = [
  [1, '20270348', '20270354', 1], [2, '20270355', '20270362', 1], [3, '20270363', '20270366', 1], [4, '20270367', '20270369', 1],
  [5, '20270370', '20270372', 1], [6, '20270373', '20270381', 2], [7, '20270382', '20270398', 2], [8, '20270399', '20270406', 2],
  [9, '20270407', '20270417', 2], [10, '20270418', '20270429', 2], [11, '20270430', '20270433', 2],
];
const PHASE_GATE = {
  1: 'Wall A: R1 build 87 on every device, R2 no public build <= 86, R3 Tier 1 PASS on build 87 at 0347, R7 backup taken the same day + restored + PASS (encrypted copy downloaded by the owner).',
  2: 'Wall B: build 88 installed on every device (TestFlight + any App Store release), production Anthropic credit working (screening returns allow/deny, not 500), website re-exported from main + publish approved, Batch 1-5 post-deploy checks all PASS, fresh backup the same day.',
};
// Migration-specific notes (from the catch-up plan, the activation checklists and each migration's own header). Keys = version.
const NOTES = {
  '20270348': { with: 'Owner website five-tab pass (Coastal Coffee) + one profile save BEFORE; right after: `get_my_profile()` own / cross-user / signed-out + catalog check; owner repeats the website pass.', rb: 'Re-opens N6 (another account reads all profile columns): never with external users.' },
  '20270349': { with: 'Deploy `moderate-photo` (from main) right after; `delete-account` stays held. Run `scripts/replay/photo-storage-api.js` read-only against prod storage.', rb: 'Photo links already issued stay valid to expiry (15 min).' },
  '20270351': { with: 'Real-API suspension test with the dedicated test account, incl. the OLD access + refresh token case; each protection reported separately; unexpected = STOP.', rb: 'Unsuspends anyone suspended meanwhile: check `suspended_at` + `banned_until` first.' },
  '20270352': { with: 'The outlook business account (no phone) keeps business features only. Seeded fixtures need verified fictional phones.' },
  '20270355': { with: 'Publish the 0355 Privacy Policy sentence the same day.' },
  '20270357': { with: 'Publish the 0357 Privacy Policy sentence the same day.' },
  '20270358': { with: 'Deploy 0359, 0360, 0361 right after (one sitting, number order). Real-API limit checks (post-deploy plan).' },
  '20270359': { with: 'Same sitting as 0358-0361.' }, '20270360': { with: 'Same sitting as 0358-0361.' }, '20270361': { with: 'Same sitting as 0358-0361.' },
  '20270362': { with: 'Real-API check: 5 creates per 24 h on a new test account (no shortcut for the reset).' },
  '20270363': { with: 'Redeploy `report-presence` right after (location-jump signal).' },
  '20270364': { with: 'Gated post-deploy plan `scripts/live-verify/server-only-grants-post-deploy.sql` + `src/qa/serverOnlyGrantsSignedIn.live.js`.' },
  '20270367': { with: 'Installs the sign-up hook OFF. The Auth switch (`scripts/trust-safety/signup-hook-settings.js`) is a separate approval after a real new-phone sign-up.' },
  '20270368': { with: 'Detection stays OFF (activation = 0380, separate).' },
  '20270372': { with: 'Deploy `screen-business-content` from main (carries the 0415 code) at 0372, per `OFFER_SCREENING_ACTIVATION_CHECKLIST_2026-11-02.md` section 9. Without credit hand-written offers stay blocked (as today).' },
  '20270373': { with: 'Deploy the new `screen-user-content` function first. Build 87 can NOT save public text after this (Wall B).' },
  '20270375': { with: 'Deletion step-up switch stays OFF; account-recovery gates must be resolved before external users.' },
  '20270380': { with: 'Only after `moderate-photo` is live from main and one `sweep` has run; the owner approved 10/10 as the threshold.' },
  '20270382': { with: 'Build 88\'s Dating Browse must be on every device (rollout like 0348).' },
  '20270387': { with: 'Opens an outage alert on the first screening failure: expect one if credit lapses.' },
  '20270388': { with: 'Must be live before any outside business is onboarded.' },
  '20270396': { with: 'Needs the Google Web Risk API key set as a secret + `screen-user-content` redeploy + the link-safety Privacy Policy sentence.' },
  '20270402': { with: 'Redeploy `delete-account` right after (never before).' },
  '20270407': { with: 'Only with build 88 on every device (builds <= 87 call the removed reward/reputation paths).' },
  '20270408': { with: 'Launch blocker: gathering ratings are readable today. Same client-first gate as 0407.' },
  '20270409': { with: 'Build 88 carries the Trending yes/no client side; without it no popularity points for anyone.' },
  '20270413': { with: 'Detector stays OFF until its Privacy Policy sentence is published (`detector-switch.js on --detector=link`).' },
  '20270414': { with: '`deploy.js` refuses it until evidence exists: published business-comparison disclosure, `deno check` of screen-business-content, a real two-business identical-image upload on staging (needs staging Anthropic credit).' },
  '20270415': { with: 'Redeploy `screen-business-content` after it (if not already from main). Without credit no new business note can be saved (fails closed).' },
  '20270416': { rb: 'MANDATORY: count `private.offer_evidence` first; any row = no rollback without the owner\'s separate approval + verified export. The rollback refuses while rows exist unless approved in its transaction. Full rollback round trip on a replay still owed before approval.' },
  '20270422': { with: 'Only after build 88 replaces 87 AND the website is re-exported from main and published.' },
  '20270427': { with: 'Edge function `business-stripe-connect-onboarding` redeploy (location-aware). Old builds refused by design.' },
  '20270428': { with: 'Redeploy `send-push` from main (exact-request email link); email stays inert until the Resend production secrets are set.' },
  '20270430': { with: 'New app + website first (builds <= 87 show "Visit confirmed" for the customer\'s own tap). Native review of the strings.', rb: 'Rolling back 0432 -> 0430 LOSES who confirmed each visit.' },
  '20270431': { rb: 'See 0430.' }, '20270432': { rb: 'See 0430.' },
  '20270433': { with: 'Server only; build 87 benefits too. Number order puts it last unless the owner renumbers it.' },
};

function header(text) {
  const lines = [];
  for (const l of text.split('\n')) {
    if (!l.startsWith('--')) { if (lines.length) break; else continue; }
    lines.push(l.replace(/^--\s?/, ''));
    if (lines.length >= 3) break;
  }
  return lines.join(' ').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
}

const rows = migs.map((f, i) => {
  const buf = git('show', `HEAD:supabase/migrations/${f}`);
  const v = f.slice(0, 8);
  const rb = rollbacks.find((r) => r.startsWith(v + '_') && r.endsWith('.sql'));
  const rbSha = rb ? sha(git('show', `HEAD:scripts/rollback/${rb}`)).slice(0, 12) : null;
  const j = journeys.filter((n) => journeyText[n].includes(v)).map((n) => n.replace('.journey.js', ''));
  const batch = BATCHES.find(([, a, b]) => v >= a && v <= b);
  return { f, v, prev: i === 0 ? '20270347' : migs[i - 1].slice(0, 8), sha: sha(buf), what: header(buf.toString()), rb, rbSha, j, batch, note: NOTES[v] || {} };
});

let md = `# Migration approval packets 0348-0433 (generated)\n\n`;
md += `GENERATED by \`node scripts/catchup/approval-packets.js\` at commit ${head.slice(0, 9)} (main). PREPARATION ONLY: a code listed here is NOT an approval and nothing here is deployed. `;
md += `Production is at 20270347 (\`npm run migration:status -- --target=prod\`). ${rows.length} migrations, deploy order = number order (deploy.js enforces it).\n\n`;
md += `## How every migration is deployed\n\`\`\`\n# 1. right before: previous version is the last recorded\nnpm run migration:status -- --target=prod\n# 2. rolled-back check on production (writes nothing)\nnpm run migration:deploy -- supabase/migrations/<file> --target=prod --check\n# 3. deploy (owner gives the approval code for THIS file)\nNEARBY_PROD_APPROVAL=<version>:<sha256> NEARBY_APPROVAL_REF="owner approval <date/message>" NEARBY_SESSION_ID=<session> \\\n  npm run migration:deploy -- supabase/migrations/<file> --target=prod\n# 4. that migration's checks below, then prod journeys without prelude\n\`\`\`\n`;
md += `Stop at the first failed check. No automatic rollback: the owner decides. Rollbacks run newest first only, each proven in isolation (all 86 back to 0347 behaviour; only ACL order + whitespace differ).\n\n`;
md += `**Before any rollback (data, not only schema):** count the rows of every table the migration created or wrote; if any exist, export them to the backup folder (0600) and record the counts; roll back only with the owner's approval naming that export (0416 + 0423 rollbacks refuse while rows exist). Rows the migration ended at apply (0389/0390 stories) and anything a scheduled job has already deleted can't be brought back by a rollback: only the same-day backup has them. Details: \`RELEASE_INVENTORY_2026-11-27.md\` section 7.\n\n`;
md += `Every batch starts with: a fresh verified backup the same day (\`scripts/backup/\`, PASS line), then the batch's phase gate.\n\n`;
for (const p of [1, 2]) md += `- **Phase ${p} gate.** ${PHASE_GATE[p]}\n`;
md += `\n`;
let curBatch = 0;
for (const r of rows) {
  if (r.batch && r.batch[0] !== curBatch) {
    curBatch = r.batch[0];
    md += `\n## Batch ${curBatch} (Phase ${r.batch[3]}): ${r.batch[1].slice(4)}-${r.batch[2].slice(4)}\n\n`;
    md += `| Migration | What it does (from its header) | Approval code | Prerequisite | Checks right after | Rollback |\n|---|---|---|---|---|---|\n`;
  }
  const checks = [r.j.length ? 'journeys ' + r.j.join(', ') : 'prod journeys (no journey names this version)', r.note.with].filter(Boolean).join('; ');
  const rb = r.rb ? `\`${r.rb}\` (${r.rbSha})${r.note.rb ? ': ' + r.note.rb : ''}` : 'MISSING';
  md += `| ${r.f.replace('.sql', '')} | ${r.what} | \`${r.v}:${r.sha}\` | ${r.prev.slice(4)} recorded; Phase ${r.batch ? r.batch[3] : '?'} gate | ${checks} | ${rb} |\n`;
}
md += `\n## Proof production is caught up (after 0433)\n1. \`migration:status\` = every file recorded, repo == ledger.\n2. Production schema == from-scratch replay at 0433 (ordering-only differences documented).\n3. Pre-existing rows unchanged except documented data steps.\n4. Prod journeys with no prelude: all pass.\n5. Each redeployed edge function's live version = main's source.\n6. Real-API signed-in checks (profile privacy, suspension incl. old tokens, limits, sign-up hook).\n7. Phone (build 88) + the live website five-tab pass.\n`;
const missing = rows.filter((r) => !r.rb).map((r) => r.v);
fs.writeFileSync(out, md);
console.log(`wrote ${path.relative(root, out)}: ${rows.length} migrations, ${missing.length} without rollback${missing.length ? ' (' + missing.join(',') + ')' : ''}`);
