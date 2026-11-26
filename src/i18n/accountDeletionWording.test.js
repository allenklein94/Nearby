// Account deletion wording (20270402): no surface promises that everything goes, every language discloses the limited records kept,
// and the words are the same for everyone, so they never reveal that a particular account is under a legal hold.
const fs = require('fs');
const path = require('path');
const settings = require('./ui/settings').default;

const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];
const repo = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

describe('account deletion wording', () => {
  test.each(LANGS)('%s: all three deletion messages disclose limited retention', (l) => {
    const limited = settings[l].yourAccountAndAllAssociated.split(/(?<=[.。])\s*/).filter(Boolean).pop();
    expect(limited.length).toBeGreaterThan(15);
    expect(settings[l].thisPermanentlyDeletesYourProfile).toContain(limited);
    expect(settings[l].deletionScheduledBody).toContain(limited);
    expect(settings[l].deletionScheduledBody).toContain('{date}');
  });
  test('English never promises "all associated data"', () => {
    for (const k of ['thisPermanentlyDeletesYourProfile', 'yourAccountAndAllAssociated', 'deletionScheduledBody']) {
      expect(settings.en[k]).not.toMatch(/all associated data/i);
    }
  });
  test('the Privacy Policy matches: no "all associated data", and it names what may be kept', () => {
    const p = repo('docs/privacy.html');
    expect(p).not.toMatch(/all associated data/i);
    expect(p).toMatch(/legal preservation obligation/);
    expect(p).toMatch(/original photos or media/);
  });
  test('the scheduled-deletion push doesn\'t claim it already happened, or claim everything', () => {
    const f = repo('supabase/functions/delete-account/index.ts');
    expect(f).not.toMatch(/has been deleted|permanently deleted/);
  });
  test('both deletion pushes say the same thing about limited records (20270403), and no raw database message reaches the person', () => {
    const f = repo('supabase/functions/delete-account/index.ts');
    const limited = 'We may keep limited records where the law or user safety requires it';
    expect(f).toContain(limited);
    expect(repo('supabase/migrations/20270403_deletion_hardening.sql')).toContain(limited);
    expect(f).not.toMatch(/json\(\{ error: \w+Error\.message \}, 500\)/);
  });
  test('the Terms point at the same rule and promise nothing wider', () => {
    expect(repo('docs/terms.html')).not.toMatch(/all (associated|your) data/i);
  });
});
