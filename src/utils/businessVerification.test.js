// Verified Business (owner, 2026-10-31; migration 20270371). Guards decision A (where the badge may appear) and the admin
// form's rules; the server's own refusals are proven by journey businessVerification.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const fs = require('fs');
const path = require('path');
const {
  VERIFICATION_CHECKS, methodLabel, emptyReviewDraft, reviewDraftProblem, reviewDraftChecks, verificationStateLine,
} = require('./businessVerification');
const { verifiedIdsFrom } = require('../services/businessVerification');
const sheet = require('../i18n/ui/businessSheet').default;
const profile = require('../i18n/ui/businessProfile').default;

const ROOT = path.join(__dirname, '..', '..');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270371_business_verification.sql'), 'utf8');

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.js$/.test(e.name) && !/\.(test|journey|live)\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('Verified Business: where it may appear (decision A, LOCKED)', () => {
  test('only the preview sheet and the business profile read the badge; nothing in offers, replies, Opportunities, routing or ranking', () => {
    const readers = sourceFiles(path.join(ROOT, 'src'))
      .filter((f) => /services\/businessVerification|get_verified_business_ids|isVerifiedBusiness|getVerifiedBusinessIds/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f)).sort();
    expect(readers).toEqual([
      'src/components/BusinessPreviewSheet.js',
      'src/screens/BusinessProfileScreen.js',
      'src/services/businessVerification.js',
    ]);
  });

  test('no other migration or edge function reads the verification record (routing / ranking stay blind to it)', () => {
    const dirs = ['supabase/migrations', 'supabase/functions'];
    const hits = [];
    for (const d of dirs) {
      const walk = (p) => {
        for (const e of fs.readdirSync(p, { withFileTypes: true })) {
          const f = path.join(p, e.name);
          if (e.isDirectory()) walk(f);
          else if (/\.(sql|ts|js)$/.test(e.name) && /business_verification/.test(fs.readFileSync(f, 'utf8'))) hits.push(path.relative(ROOT, f));
        }
      };
      walk(path.join(ROOT, d));
    }
    expect(hits).toEqual(['supabase/migrations/20270371_business_verification.sql']);
  });

  test('the wording names what was checked and never claims quality, safety or trust', () => {
    expect(sheet.en.verifiedBusiness).toBe('Verified Business');
    expect(profile.en.verifiedBusiness).toBe('Verified Business');
    expect(profile.en.verifiedBusinessMeaning).toMatch(/isn't a rating of its quality or safety/);
    for (const lang of Object.keys(profile)) {
      for (const k of ['verifiedBusiness', 'verifiedBusinessA11y', 'verifiedBusinessMeaning']) expect(profile[lang][k]).toBeTruthy();
      for (const k of ['verifiedBusiness', 'verifiedBusinessA11y']) expect(sheet[lang][k]).toBeTruthy();
    }
    const en = JSON.stringify([sheet.en.verifiedBusiness, sheet.en.verifiedBusinessA11y, profile.en.verifiedBusiness, profile.en.verifiedBusinessA11y, profile.en.verifiedBusinessMeaning]);
    expect(en).not.toMatch(/\b(trusted|safe business|guarantee|recommended)\b/i);
  });

  test('unknown = no badge: an error (e.g. the function before 20270371 is live) or a bad payload shows nothing', () => {
    expect(verifiedIdsFrom({ data: null, error: { code: 'PGRST202' } }).size).toBe(0);
    expect(verifiedIdsFrom({ data: 'x', error: null }).size).toBe(0);
    expect(verifiedIdsFrom(null).size).toBe(0);
    expect([...verifiedIdsFrom({ data: ['a'], error: null })]).toEqual(['a']);
  });
});

describe('Verified Business admin form', () => {
  test('every method the server accepts has a label; the four checks match the server', () => {
    const block = MIGRATION.match(/business_verification_methods\(\)[\s\S]*?jsonb_build_object\(([\s\S]*?)\);\n\$function\$/)[1];
    const server = {};
    for (const m of block.matchAll(/'(\w+)',\s*jsonb_build_array\(([^)]*)\)/g)) server[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]);
    expect(Object.keys(server).sort()).toEqual(VERIFICATION_CHECKS.map((c) => c.key).sort());
    for (const list of Object.values(server)) for (const m of list) expect(methodLabel(m)).not.toBe(m);
    // the business-controlled contact check never accepts what the applicant typed: only independently found contacts
    expect(server.contact).toEqual(['called_official_number', 'official_domain_email']);
  });

  test('a checkbox alone is never ready: method, outcome and a factual note for each check, then the decision', () => {
    const d = emptyReviewDraft();
    expect(reviewDraftProblem(d)).toMatch(/Business identity: pick how/);
    for (const c of VERIFICATION_CHECKS) d.checks[c.key] = { method: 'site_visit', outcome: 'passed', note: 'short' };
    expect(reviewDraftProblem(d)).toMatch(/at least 15 characters/);
    for (const c of VERIFICATION_CHECKS) d.checks[c.key].note = '  Visited on 2026-10-31, owner present.  ';
    expect(reviewDraftProblem(d)).toMatch(/^Decision/);
    d.decision = 'All four passed.';
    expect(reviewDraftProblem(d)).toBeNull();
    expect(reviewDraftChecks(d).identity).toEqual({ method: 'site_visit', outcome: 'passed', note: 'Visited on 2026-10-31, owner present.' });
  });

  test('state lines: approval alone, not verified, revoked, lapsed, showing', () => {
    expect(verificationStateLine({ state: 'none', badge: false })).toBe('Approved, not verified. No badge.');
    expect(verificationStateLine({ state: 'not_verified', badge: false })).toMatch(/did not verify/);
    expect(verificationStateLine({ state: 'revoked', badge: false })).toMatch(/revoked/);
    expect(verificationStateLine({ state: 'verified', badge: false, lapse: 'name_changed' })).toMatch(/name changed/);
    expect(verificationStateLine({ state: 'verified', badge: true })).toMatch(/badge showing/);
  });
});
