// Release gates (owner, 2026-11-27: the release compatibility rules are standing requirements, enforced by checks, not
// only by documents). deploy.js runs these for PRODUCTION only, after the ledger preflight; any failure refuses the
// migration before anything is sent. Each gate is evidence the session can't fake by editing a file on disk:
//
//   1. compatibility evidence (rule 3): PRODUCT_AUDIT/evidence/release-compat.md, COMMITTED at HEAD, must record a
//      passing release-compat run of the NEXT build through at least this version, made from app source identical to
//      HEAD's (src/ unchanged since), and either a passing run of the RELEASED build through this version, or a client
//      floor (gate 2) that the released build doesn't meet.
//   2. client floor (rule 1, "needs build N"): from the first migration that needs build N, every later deploy needs
//      (a) a LIVE read of production showing no signed-in session from an older app build and no session from an
//      unrecognised client, and (b) committed evidence that no older build is distributed (App Store Connect: App Store +
//      TestFlight) and that the business website was re-exported from that build's source. Installing the new build on one
//      phone is not enough: the session read covers every signed-in device; the distribution line covers signed-out installs.
//   3. backup (rule 7): a verified backup (prod-logical-backup.sh PASS record) under 24 hours old, and its encrypted copy.
//   4. policy with the change (rule 8): a migration that starts new processing of personal data needs its Privacy Policy
//      sentence PUBLISHED (GitHub Pages serves main:docs/privacy.html, so origin/main's copy is what readers see), marked
//      by an HTML comment "<!-- nearby-processing: <version> -->" next to the sentence. The marker travels with the
//      sentence, so counsel can reword it freely. A new migration declares the need in its header instead:
//      "-- release-gate: privacy".
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const EVIDENCE_FILE = 'PRODUCT_AUDIT/evidence/release-compat.md';

// Migrations that break or mislead an older build (each verified by scripts/compat or the catch-up plan). A NEW migration
// that needs a newer build declares it in its header instead: "-- release-gate: needs-build <N>".
const CLIENT_FLOOR = {
  20270373: { build: 88, why: 'public text must be screened; builds <= 87 never ask (sign-up, profile, gatherings, communities refused)' },
  20270382: { build: 88, why: 'Dating Browse only through browse_dating_candidates; build 87 Browse comes back empty' },
  20270407: { build: 88, why: 'host reputation + referral removed server-side; build 87 shows dead controls' },
  20270409: { build: 88, why: 'Trending yes/no from the server; build 87 ranks on the raw count' },
  20270422: { build: 88, why: 'offer read receipts move; build 87 business Performance prints a literal placeholder' },
  20270430: { build: 88, why: 'visit confirmation split; build 87 shows the customer\'s own tap as "Visit confirmed"' },
};

// Migrations whose processing the current Privacy Policy doesn't describe (PRODUCT_AUDIT/PRIVACY_LEGAL_REVIEW_2026-11-27.md
// part 2). 0413's detector and 0428's emails start only with a separate switch / secrets, not with the migration.
const PRIVACY_REQUIRED = {
  20270351: 'data requests while suspended (support address)',
  20270355: 'reported content kept with the report, 12 months after resolution',
  20270356: 'rate limits by phone verification + account age',
  20270357: 'photo fingerprints for duplicate-account review',
  20270363: 'rejected impossible location jumps: rough area, 1 hour',
  20270373: 'public text screened by the AI provider before publication',
  20270374: 'suspended-number code kept 12 months',
  20270375: 'security-event log kept 12 months',
  20270376: 'device-token code (90 days / 12 months)',
  20270378: 'repeated-text code kept 30 days',
  20270391: 'reported photo kept for review',
  20270396: 'links in public text checked with Google Web Risk',
  20270400: 'ID document retention schedule',
  20270402: 'limited records kept after deletion (held accounts)',
  20270403: 'deletion + what is kept',
  20270414: 'business details compared across applications',
};
const PRIVACY_FILE = 'docs/privacy.html';
const PUBLISHED_REF = 'origin/main';

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function headerFloor(content) {
  const m = /^--\s*release-gate:\s*needs-build\s+(\d+)\s*$/im.exec(content || '');
  return m ? Number(m[1]) : null;
}

// The build every version from `version` on needs (the highest floor at or before it), and the migrations that set it.
function effectiveFloor(version, repoRoot, readFile = (f) => fs.readFileSync(f, 'utf8')) {
  const v = Number(version);
  let build = null; const from = [];
  const dir = path.join(repoRoot, 'supabase/migrations');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d{8}_.*\.sql$/.test(f)) : [];
  const floors = { ...CLIENT_FLOOR };
  for (const f of files) {
    const n = Number(f.slice(0, 8));
    if (n > v || floors[n]) continue;
    const b = headerFloor(readFile(path.join(dir, f)));
    if (b) floors[n] = { build: b, why: 'declared in the migration header' };
  }
  for (const [n, g] of Object.entries(floors)) {
    if (Number(n) > v) continue;
    if (build === null || g.build > build) build = g.build;
    from.push(Number(n));
  }
  return { build, from: from.sort() };
}

function privacyRequired(version, repoRoot, readFile = (f) => fs.readFileSync(f, 'utf8')) {
  const v = Number(version);
  if (PRIVACY_REQUIRED[v]) return PRIVACY_REQUIRED[v];
  const dir = path.join(repoRoot, 'supabase/migrations');
  const f = fs.existsSync(dir) ? fs.readdirSync(dir).find((x) => x.startsWith(`${v}_`) && x.endsWith('.sql')) : null;
  return f && /^--\s*release-gate:\s*privacy\s*$/im.test(readFile(path.join(dir, f))) ? 'declared in the migration header' : null;
}

function privacyFailures(version, repoRoot, opts = {}) {
  const what = privacyRequired(version, repoRoot);
  if (!what) return [];
  const show = opts.showPublished || (() => { try { return git(repoRoot, ['show', `${PUBLISHED_REF}:${PRIVACY_FILE}`]); } catch { return null; } });
  const html = show();
  const marker = `<!-- nearby-processing: ${Number(version)} -->`;
  if (html && html.includes(marker)) return [];
  return [`release gate: ${version} starts new processing (${what}); publish its Privacy Policy sentence first (${PRIVACY_FILE} on main, marked "${marker}"; git fetch so ${PUBLISHED_REF} is current)`];
}

// "<kind>: PASS build <N> @<commit> through <version> ..." (one line per kind; anything else refuses).
function parseEvidence(text) {
  const out = { errors: [] };
  for (const kind of ['next', 'released', 'distribution', 'website']) {
    const lines = (text || '').split(/\r?\n/).filter((l) => l.trim().toLowerCase().startsWith(`${kind}:`));
    if (lines.length > 1) { out.errors.push(`${kind} is recorded ${lines.length} times; keep exactly one`); continue; }
    if (!lines.length) continue;
    const l = lines[0].trim();
    if (/^\S+:\s*FAIL\b/i.test(l)) { out[kind] = { failed: true, line: l }; continue; }
    if (kind === 'next' || kind === 'released') {
      const m = /^\w+: PASS build (\d+) @([0-9a-f]{7,40}) through (\d{8})\b/.exec(l);
      if (!m) { out.errors.push(`${kind} line is malformed: "${l.slice(0, 120)}" (want "${kind}: PASS build <N> @<commit> through <version> ...")`); continue; }
      out[kind] = { build: Number(m[1]), commit: m[2], through: Number(m[3]), line: l };
    } else {
      const m = /^\w+: PASS build (\d+)\b/.exec(l);
      if (!m) { out.errors.push(`${kind} line is malformed: "${l.slice(0, 120)}" (want "${kind}: PASS build <N> <where/when>")`); continue; }
      out[kind] = { build: Number(m[1]), line: l };
    }
  }
  return out;
}

// The app a build is made from: its code + config + the dependencies it ships (package.json "dependencies"; scripts and
// devDependencies don't reach the app). Tests, journeys and live checks are excluded.
const APP_PATHS = ['src', 'App.js', 'App.web.js', 'index.js', 'app.config.js', 'app.json', 'eas.json', 'patches',
  ':(exclude)*.test.js', ':(exclude)*.journey.js', ':(exclude)*.live.js'];
function appSourceChanged(repoRoot, commit) {
  try { git(repoRoot, ['diff', '--quiet', commit, 'HEAD', '--', ...APP_PATHS]); } catch { return true; }
  try {
    const deps = (ref) => JSON.stringify(JSON.parse(git(repoRoot, ['show', `${ref}:package.json`])).dependencies || {});
    return deps(commit) !== deps('HEAD');
  } catch { return true; }
}

function evidenceFailures(version, repoRoot, floor, opts = {}) {
  const r = [];
  const v = Number(version);
  const show = opts.show || ((f) => { try { return git(repoRoot, ['show', `HEAD:${f}`]); } catch { return null; } });
  const dirty = opts.dirty || ((f) => { try { return git(repoRoot, ['status', '--porcelain', '--', f]).trim() !== ''; } catch { return true; } });
  const srcChanged = opts.srcChanged || ((c) => appSourceChanged(repoRoot, c));
  if (dirty(EVIDENCE_FILE)) r.push(`release gate: ${EVIDENCE_FILE} has uncommitted changes; only the committed copy counts`);
  const text = show(EVIDENCE_FILE);
  if (!text) return [...r, `release gate: no ${EVIDENCE_FILE} (a passing release-compat run is required before any production migration)`];
  const ev = parseEvidence(text);
  ev.errors.forEach((e) => r.push(`release gate: ${e}`));
  const n = ev.next;
  if (!n) r.push('release gate: no "next:" result (release-compat of the next build)');
  else if (n.failed) r.push(`release gate: next build recorded as FAILED: "${n.line.slice(0, 120)}"`);
  else {
    if (n.through < v) r.push(`release gate: next build ${n.build} was proven only through ${n.through}; rerun release-compat through ${v}`);
    if (srcChanged(n.commit)) r.push(`release gate: app source changed since the next-build run @${n.commit}; rerun release-compat`);
    if (floor.build && n.build < floor.build) r.push(`release gate: ${v} needs build ${floor.build} but the next-build evidence is build ${n.build}`);
  }
  const rel = ev.released;
  const relBelowFloor = floor.build && rel && !rel.failed && rel.build < floor.build;
  if (!rel) r.push('release gate: no "released:" result (release-compat of the build people have now)');
  else if (rel.failed) r.push(`release gate: released build recorded as FAILED: "${rel.line.slice(0, 120)}"`);
  else if (!relBelowFloor && rel.through < v) r.push(`release gate: released build ${rel.build} was proven only through ${rel.through}; rerun release-compat through ${v}`);
  if (floor.build) {
    const d = ev.distribution; const w = ev.website;
    if (!d || d.failed || d.build < floor.build) r.push(`release gate: ${v} needs build ${floor.build} (set by ${floor.from.join(', ')}): record "distribution: PASS build ${floor.build} <date> App Store Connect: no older build on the App Store or TestFlight"`);
    if (!w || w.failed || w.build < floor.build) r.push(`release gate: ${v} needs build ${floor.build}: record "website: PASS build ${floor.build} <commit> exported + published"`);
  }
  return r;
}

// Read-only: live sessions by client. One SELECT; user agents are reduced to "Nearby/<build>" or "browser" or "other".
const SESSIONS_SQL = `select coalesce(substring(user_agent from '^Nearby/([0-9]+)')::int, -1) as build,
  case when user_agent ~ '^Nearby/[0-9]+' then 'app' when user_agent ~ '^Mozilla/' then 'browser' else 'other' end as kind,
  count(*)::int as n
  from auth.sessions where not_after is null or not_after > now() group by 1, 2`;

function sessionFailures(rows, floor) {
  if (!floor.build) return [];
  const r = [];
  const old = rows.filter((x) => x.kind === 'app' && x.build < floor.build);
  if (old.length) r.push(`release gate: ${old.reduce((a, x) => a + x.n, 0)} live session(s) from app build(s) ${old.map((x) => x.build).join(', ')} (< ${floor.build}): every device must run build ${floor.build}+ (or sign out) first`);
  const other = rows.filter((x) => x.kind === 'other');
  if (other.length) r.push(`release gate: ${other.reduce((a, x) => a + x.n, 0)} live session(s) from an unrecognised client (no Nearby/<build> or browser user agent): identify them before a breaking migration`);
  return r;
}

const DAY_MS = 24 * 3600 * 1000;
function backupFailures(dir, now = Date.now()) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const verified = files.filter((f) => /^verified-\d{8}T\d{6}Z\.json$/.test(f)).map(read).filter((x) => x && x.ts && x.verified_at)
    .sort((a, b) => (a.verified_at < b.verified_at ? 1 : -1));
  if (!verified.length) return [`release gate: no verified backup in ${dir} (run FULL_READ=1 bash scripts/backup/prod-backup-via-login-role.sh)`];
  const last = verified[0];
  const age = now - Date.parse(last.verified_at);
  const r = [];
  if (!(age >= 0 && age <= DAY_MS)) r.push(`release gate: newest verified backup ${last.ts} is ${Math.round(age / 3600000)} h old (must be < 24 h)`);
  if (!read(`encrypted-${last.ts}.json`)) r.push(`release gate: backup ${last.ts} has no encrypted copy (bash scripts/backup/encrypt-backup.sh)`);
  return r;
}

// All gates for one migration on production. run = the target's SQL runner (one read-only SELECT is sent).
async function releaseGateFailures({ facts, run, repoRoot, backupDir = process.env.NEARBY_BACKUP_DIR || '/workspaces/.nearby-verify/backups', now, evidenceOpts }) {
  if (!facts.version) return [];
  const floor = effectiveFloor(facts.version, repoRoot);
  const r = [...evidenceFailures(facts.version, repoRoot, floor, evidenceOpts), ...backupFailures(backupDir, now),
    ...privacyFailures(facts.version, repoRoot, evidenceOpts)];
  if (floor.build) {
    try { r.push(...sessionFailures(await run(SESSIONS_SQL), floor)); } catch (e) { r.push(`release gate: could not read live sessions (${e.message.slice(0, 120)}): refused`); }
  }
  return r;
}

module.exports = { appSourceChanged, CLIENT_FLOOR, PRIVACY_REQUIRED, privacyRequired, privacyFailures, EVIDENCE_FILE, SESSIONS_SQL, headerFloor, effectiveFloor, parseEvidence, evidenceFailures, sessionFailures, backupFailures, releaseGateFailures };
