// Edge function sources (2026-10-17): `report-presence`, `delete-account` and `moderate-photo` were deployed and live while
// their repo files were EMPTY, so a deploy from the repo would have replaced each working function with nothing. All three
// were recovered verbatim from their live bundles (the bundle's embedded original TypeScript; extraction checked byte for
// byte; delete-account v8, moderate-photo v16, report-presence v11), never redeployed. This guard keeps it that way:
//   1. no function directory holds an empty or whitespace-only index.ts;
//   2. the recovered functions keep the behaviour that made them worth recovering (account deletion removes the person's
//      files incl. ID-verification images, then the profile, then the auth user; photo moderation fails CLOSED when the age
//      check cannot run; report-presence keeps its speed check and 10-minute window).
// Not covered: whether the repo matches what is deployed for functions deployed by the CLI (their bundles keep type-stripped
// JavaScript, so a byte comparison is not possible). The other 13 live functions were recovered 2026-10-28 (edgeFunctionKeys.test.js).
const fs = require('fs');
const path = require('path');

const FUNCTIONS = path.join(__dirname, '..', '..', 'supabase', 'functions');
const dirs = fs.readdirSync(FUNCTIONS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name);
const src = (name) => fs.readFileSync(path.join(FUNCTIONS, name, 'index.ts'), 'utf8');

describe('edge function sources are never empty', () => {
  test.each(dirs)('%s/index.ts has code', (name) => {
    const p = path.join(FUNCTIONS, name, 'index.ts');
    expect(fs.existsSync(p)).toBe(true);
    expect(src(name).trim().length).toBeGreaterThan(200);
    expect(src(name)).toMatch(/serve\(|Deno\.serve\(/);
  });
});

describe('recovered functions keep their behaviour', () => {
  test('delete-account: verifies the caller, removes their photos, then profile, then auth user', () => {
    const s = src('delete-account');
    expect(s).toMatch(/auth\.getUser\(token\)/);
    const files = s.indexOf("storage.from('profile-photos').remove(");
    const profile = s.indexOf("from('profiles').delete().eq('id', userId)");
    const authUser = s.indexOf('auth.admin.deleteUser(userId)');
    expect(files).toBeGreaterThan(-1);
    expect(profile).toBeGreaterThan(files);
    expect(authUser).toBeGreaterThan(profile);
  });

  // 20270400: ID files are no longer removed here. Deleting the profile makes the database queue the whole id-verification folder
  // (incl. uploads that never got a submission row); the hourly job deletes them and keeps each queued until Storage confirms it,
  // and never deletes a file under a legal hold. A direct remove here would skip both.
  test('delete-account: leaves ID files to the database\'s confirmed-deletion queue (20270400)', () => {
    const s = src('delete-account');
    expect(s).not.toMatch(/storage\.from\('id-verification'\)\.remove\(/);
    expect(s).toMatch(/20270400/);
    expect(s).toMatch(/Deploy this version only AFTER 20270400 is live/);
  });

  // 20270402: held moderation evidence is copied before anything is removed, and a failure stops the deletion.
  test('delete-account: preserves held evidence first and stops if that fails', () => {
    const s = src('delete-account');
    const preserve = s.indexOf("rpc('account_deletion_preserve_held_evidence'");
    expect(preserve).toBeGreaterThan(-1);
    expect(preserve).toBeLessThan(s.indexOf(".remove(storagePaths)"));
    expect(preserve).toBeLessThan(s.indexOf("from('profiles').delete()"));
    expect(s.slice(preserve, s.indexOf(".remove(storagePaths)"))).toMatch(/preserveError\.code !== 'PGRST202'[\s\S]*throw new Error/);
  });

  test('delete-account: every name in its return is declared (0400 left a removed variable there)', () => {
    expect(src('delete-account')).not.toMatch(/verificationPaths/);
  });

  test('moderate-photo: verifies the caller, only their own photo, and fails closed when the age check fails', () => {
    const s = src('moderate-photo');
    expect(s).toMatch(/auth\.getUser\(token\)/);
    expect(s).toMatch(/photoRow\.user_id !== userId/);
    expect(s).toMatch(/const isSafe = !failedModeration && !possibleMinorFlag && ageCheckSucceeded;/);
    expect(s).not.toMatch(/AKIA[0-9A-Z]{16}/); // credentials come from the environment, never the source
    // 0349 (owner, 2026-10-28): the verdict binds to the exact object screened, read BEFORE the download, and is written
    // only through record_photo_screening (refuses a stale verdict); never a direct photo_verified update.
    expect(s.indexOf("rpc('photo_screening_target'")).toBeGreaterThan(-1);
    expect(s.indexOf("rpc('photo_screening_target'")).toBeLessThan(s.indexOf('.download('));
    expect(s).toMatch(/rpc\('record_photo_screening'[\s\S]*p_object_id: screenedObjectId/);
    expect(s).not.toMatch(/update\(\{ photo_verified/);
  });

  test('report-presence: speed check and the 10-minute window', () => {
    const s = src('report-presence');
    expect(s).toMatch(/const PRESENCE_WINDOW_MINUTES = 10;/);
    expect(s).toMatch(/MAX_PLAUSIBLE_MPH/);
  });

  test('report-presence: a rejected jump is only recorded as a review-signal input (20270363) and is still rejected', () => {
    const s = src('report-presence');
    const rejection = s.slice(s.indexOf('> MAX_PLAUSIBLE_MPH'), s.indexOf('await admin.from(\'presence_reports\').upsert'));
    expect(rejection).toMatch(/try \{\s*await admin\.rpc\('record_location_jump', \{ p_user: userId, p_area: area \}\);\s*\} catch/);
    expect(rejection).toMatch(/status: 400/);
    expect(s.match(/record_location_jump/g)).toHaveLength(1); // never for an accepted report
  });

  test('report-presence: never returns a headcount of a claimed cell (20270384)', () => {
    const s = src('report-presence');
    expect(s).not.toMatch(/matchedCount/);
    expect(s).toMatch(/JSON\.stringify\(\{ ok: true \}\)/);
  });

  test('review-login: failed PIN guesses are capped for ALL callers, not only per (spoofable) IP; no PIN = closed', () => {
    const s = src('review-login');
    expect(s).toMatch(/const GLOBAL_MAX_FAILURES = \d+;/);
    // record first, then count (concurrency: src/utils/reviewLoginConcurrency.test.js), then the PIN
    const rec = s.indexOf("from('review_login_attempts').insert"), cnt = s.indexOf("count: allAttempts"), chk = s.indexOf('samePin(pin, REVIEW_LOGIN_PIN)');
    expect(rec).toBeGreaterThan(-1);
    expect(rec).toBeLessThan(cnt);
    expect(cnt).toBeLessThan(chk);
    expect(s).toMatch(/count > MAX_ATTEMPTS \|\| allAttempts > GLOBAL_MAX_FAILURES/);
    expect(s).toMatch(/if \(!REVIEW_LOGIN_PIN \|\| !REVIEWER_EMAIL\)/);
    expect(s).toMatch(/!samePin\(pin, REVIEW_LOGIN_PIN\)/);
    expect(s).not.toMatch(/pin !== REVIEW_LOGIN_PIN/);
  });
});
