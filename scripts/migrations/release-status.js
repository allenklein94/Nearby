#!/usr/bin/env node
// Session-start check (release process rule 6, owner 2026-11-27): so a migration backlog can never build up silently.
// READ-ONLY: two ledger SELECTs on production (the same ones status.js sends) + local git.
//   npm run release:status
// Reports: migrations on main with no production ledger row (count, oldest + its age), unmerged remote branches older than
// 14 days, and whether the committed release-compat evidence still matches the app source.
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./ledger');
const G = require('./releaseGates');

const REPO = path.resolve(__dirname, '../..');
const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const days = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86400000);

async function main() {
  const { run } = L.runner('prod');
  const ledger = await L.readLedger(run);
  const report = L.statusReport(L.repoMigrations(REPO), ledger);
  const pending = report.filter((x) => x.state === 'NOT RECORDED');
  const bad = report.filter((x) => /MISMATCH/.test(x.state));
  console.log(`production: ${pending.length} migration(s) on this branch with no ledger row${bad.length ? `, ${bad.length} HASH MISMATCH` : ''}`);
  if (pending.length) {
    const first = pending[0];
    const added = git('log', '--diff-filter=A', '--format=%cI', '--', first.rel).trim().split('\n').pop();
    console.log(`  oldest: ${first.version} (in the repo ${added ? days(added) : '?'} days)${pending.length > 1 ? `, newest: ${pending[pending.length - 1].version}` : ''}`);
    if (added && days(added) > 30) console.log('  RULE 6: undeployed > 30 days: report to the owner');
  }
  const stale = git('for-each-ref', '--format=%(refname:short) %(committerdate:iso-strict)', 'refs/remotes/origin')
    .trim().split('\n').filter(Boolean).map((l) => l.split(' '))
    .filter(([ref]) => ref !== 'origin/main' && ref !== 'origin/HEAD' && ref !== 'origin')
    .filter(([ref]) => { try { git('merge-base', '--is-ancestor', ref, 'origin/main'); return false; } catch { return true; } })
    .filter(([, when]) => days(when) > 14);
  console.log(`branches: ${stale.length} unmerged remote branch(es) with no commit in 14+ days (rule 5: merge, or a dated reason in CLAUDE.md)`);
  for (const [ref, when] of stale.slice(0, 15)) console.log(`  ${ref} (${days(when)} days)`);
  if (stale.length > 15) console.log(`  ... and ${stale.length - 15} more`);
  const ev = G.parseEvidence((() => { try { return git('show', `HEAD:${G.EVIDENCE_FILE}`); } catch { return ''; } })());
  if (!ev.next) console.log('compat evidence: none recorded');
  else {
    const changed = G.appSourceChanged(REPO, ev.next.commit);
    console.log(`compat evidence: next build ${ev.next.build} through ${ev.next.through}${changed ? ' (STALE: app source changed since; rerun scripts/compat/release-compat.sh)' : ' (current)'}; released build ${ev.released ? `${ev.released.build} through ${ev.released.through}` : 'none'}`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
