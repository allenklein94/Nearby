// "ID Verified" (owner, 2026-10-31): the one public verification badge names what was checked (an approved ID), reads
// id_verified only (0350), and no trust badge exists for a phone number or account age.
const fs = require('fs');
const path = require('path');
const viewProfile = require('../i18n/ui/viewProfile').default;
const friends = require('../i18n/ui/friends').default;
const dating = require('../i18n/ui/dating').default;

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('ID Verified badge', () => {
  test('English wording names the ID check, never a bare "Verified" or "photo-verified"', () => {
    expect(viewProfile.en.badge.verified).toBe('ID Verified');
    expect(friends.en.verified).toBe('ID Verified');
    expect(friends.en.verifiedOnly).toBe('ID Verified Only');
    expect(dating.en.quick.verified).toBe('ID Verified Only');
    expect(dating.en.quick.verifiedA11y).toBe('Filter to only ID-verified profiles');
  });

  test('the badge reads id_verified only, never photo screening', () => {
    expect(read('src/screens/ViewProfileScreen.js')).toContain("profile.id_verified && { icon: '✓', label: t('ui.viewProfile.badge.verified')");
    expect(read('src/screens/ViewProfileScreen.js')).not.toMatch(/photo_verified && \{ icon/);
  });

  test('no "Trusted" badge or label anywhere in the app strings (phone + Established stay internal)', () => {
    const dir = path.join(ROOT, 'src/i18n/ui');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      const en = require(path.join(dir, f)).default?.en;
      const text = JSON.stringify(en || {});
      expect(text).not.toMatch(/"Trusted|Trusted (person|account|member|user)|"Established"/);
    }
  });
});
