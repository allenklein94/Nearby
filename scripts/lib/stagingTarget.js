// The ONE way a script reaches the staging Supabase project (owner approval B, 2026-11-15). Every staging command takes
// its ref from here, never from the CLI's linked project (supabase/.temp links PRODUCTION) or a default.
// Refuses: a missing ref, a malformed one, and PRODUCTION's ref (src/config/environments.js PRODUCTION) in any form.
//   ref source: NEARBY_STAGING_REF, else the gitignored .claude/staging.json (never printed: only `ref` and `url` are read
//   here; keys stay in the file).
const fs = require('fs');
const path = require('path');
const { PRODUCTION, refFromUrl } = require('../../src/config/environments');

const REF_RE = /^[a-z0-9]{20}$/;
const DEFAULT_FILE = path.join(__dirname, '../../.claude/staging.json');

function assertNotProduction(ref, what = 'staging ref') {
  if (String(ref || '').includes(PRODUCTION.supabaseRef)) throw new Error(`${what} is the PRODUCTION project (${PRODUCTION.supabaseRef}): refused`);
}

function stagingRef({ env = process.env, file = DEFAULT_FILE } = {}) {
  let ref = (env.NEARBY_STAGING_REF || '').trim();
  let source = 'NEARBY_STAGING_REF';
  let url = null;
  if (!ref) {
    if (!fs.existsSync(file)) throw new Error('no staging project: set NEARBY_STAGING_REF or create .claude/staging.json');
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    ref = String(j.ref || '').trim();
    url = j.url || null;
    source = '.claude/staging.json';
  }
  assertNotProduction(ref);
  if (!REF_RE.test(ref)) throw new Error(`staging ref from ${source} is not a 20-character project ref: refused`);
  if (url) {
    assertNotProduction(url, 'staging url');
    if (refFromUrl(url) !== ref) throw new Error('.claude/staging.json url does not match its ref: refused');
  }
  return { ref, url: `https://${ref}.supabase.co`, source };
}

module.exports = { stagingRef, assertNotProduction, PRODUCTION_REF: PRODUCTION.supabaseRef };
