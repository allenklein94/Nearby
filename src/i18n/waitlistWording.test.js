// Waitlist wording (owner, 2026-11-11, with 20270411): a blocked waitlisted person is never promoted, so the waitlist lines
// promise nothing about a spot opening. Same words for everyone, so they never hint at a block. Copy only.
import { UI_NAMESPACES, UI_LANGUAGES } from './ui';

const LINES = [['gatheringDetail', 'onWaitlist'], ['gatherings', 'waitlistBody']];

describe('waitlist lines make no spot-opening promise', () => {
  test('English', () => {
    expect(UI_NAMESPACES.gatheringDetail.en.onWaitlist).toBe("🕒 You're on the waitlist.");
    expect(UI_NAMESPACES.gatherings.en.waitlistBody).toBe('This gathering is full right now.');
  });
  test.each(LINES)('%s.%s: every language present, one sentence, no second clause', (ns, key) => {
    for (const lang of UI_LANGUAGES) {
      const text = UI_NAMESPACES[ns][lang]?.[key];
      expect(typeof text).toBe('string');
      expect(text).not.toMatch(/ — /);
      expect(text).not.toMatch(/let you know|spot opens|avisaremos|Bescheid|préviendrons|fè w konnen|通知|báo khi|sasabihan|сообщим|알려/i);
    }
  });
});
