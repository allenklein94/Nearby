// Owner (2026-10-16, after item 141): the host's gathering-approval alert says what the host can now do ("Approved! You can
// now chat with them."), never that a "match" was created. Approving still creates the chat connection server-side
// (approve_gathering_interest); only the words changed. Every language, since the old key carried "Match"/"매치"/"配对".
const fs = require('fs');
const path = require('path');
const parts = require('../i18n/ui/gatheringParts').default;

const MANAGER = fs.readFileSync(path.join(__dirname, '../components/HostAttendeeManager.js'), 'utf8');
const MATCH_WORDS = /match|совпаден|매치|配对|配對|emparej|correspond/i;

describe('gathering approval alert', () => {
  test('HostAttendeeManager shows "Approved!" with the chat line', () => {
    expect(MANAGER).toMatch(/Alert\.alert\(t\('ui\.gatheringParts\.approved'\), t\('ui\.gatheringParts\.youCanNowChatWithThem'\)\)/);
    expect(MANAGER).not.toMatch(/aMatchWasCreatedYou/);
  });

  test('English reads exactly "You can now chat with them."', () => {
    expect(parts.en.approved).toBe('Approved!');
    expect(parts.en.youCanNowChatWithThem).toBe('You can now chat with them.');
  });

  test('no language says a match was created', () => {
    for (const [lang, strings] of Object.entries(parts)) {
      expect([lang, strings.youCanNowChatWithThem]).toEqual([lang, expect.any(String)]);
      expect([lang, MATCH_WORDS.test(strings.youCanNowChatWithThem) || MATCH_WORDS.test(strings.approved)]).toEqual([lang, false]);
      expect(strings.aMatchWasCreatedYou).toBeUndefined();
    }
  });
});
