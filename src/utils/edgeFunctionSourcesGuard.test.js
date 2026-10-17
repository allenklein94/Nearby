// Edge function sources (2026-10-17): `report-presence`, `delete-account` and `moderate-photo` were deployed and live while
// their repo files were EMPTY, so a deploy from the repo would have replaced each working function with nothing. All three
// were recovered verbatim from their live bundles (the bundle's embedded original TypeScript; extraction checked byte for
// byte; delete-account v8, moderate-photo v16, report-presence v11), never redeployed. This guard keeps it that way:
//   1. no function directory holds an empty or whitespace-only index.ts;
//   2. the recovered functions keep the behaviour that made them worth recovering (account deletion removes the person's
//      files incl. ID-verification images, then the profile, then the auth user; photo moderation fails CLOSED when the age
//      check cannot run; report-presence keeps its speed check and 10-minute window).
// Not covered: whether the repo matches what is deployed for functions deployed by the CLI (their bundles keep type-stripped
// JavaScript, so a byte comparison is not possible), and 13 live functions that have no repo directory at all (reported).
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
  test('delete-account: verifies the caller, removes their files (incl. ID verification), then profile, then auth user', () => {
    const s = src('delete-account');
    expect(s).toMatch(/auth\.getUser\(token\)/);
    const files = s.indexOf("storage.from('profile-photos').remove(");
    const idFiles = s.indexOf("storage.from('id-verification').remove(");
    const profile = s.indexOf("from('profiles').delete().eq('id', userId)");
    const authUser = s.indexOf('auth.admin.deleteUser(userId)');
    expect(files).toBeGreaterThan(-1);
    expect(idFiles).toBeGreaterThan(files);
    expect(profile).toBeGreaterThan(idFiles);
    expect(authUser).toBeGreaterThan(profile);
  });

  test('moderate-photo: verifies the caller, only their own photo, and fails closed when the age check fails', () => {
    const s = src('moderate-photo');
    expect(s).toMatch(/auth\.getUser\(token\)/);
    expect(s).toMatch(/photoRow\.user_id !== userId/);
    expect(s).toMatch(/const isSafe = !failedModeration && !possibleMinorFlag && ageCheckSucceeded;/);
    expect(s).not.toMatch(/AKIA[0-9A-Z]{16}/); // credentials come from the environment, never the source
  });

  test('report-presence: speed check and the 10-minute window', () => {
    const s = src('report-presence');
    expect(s).toMatch(/const PRESENCE_WINDOW_MINUTES = 10;/);
    expect(s).toMatch(/MAX_PLAUSIBLE_MPH/);
  });
});
