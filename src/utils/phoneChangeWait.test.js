import { phoneChangeWaitUntil, phoneChangeWaitTime } from './phoneChangeWait';
import settings from '../i18n/ui/settings';

const NOW = Date.parse('2026-11-01T15:00:00Z');

describe('phone number change wait (20270375, revised 2026-11-01)', () => {
  test('a future time from the server = wait until then', () => {
    expect(phoneChangeWaitUntil({ data: '2026-11-02T09:30:00+00:00', error: null }, NOW).toISOString()).toBe('2026-11-02T09:30:00.000Z');
  });
  test('null from the server = go ahead', () => {
    expect(phoneChangeWaitUntil({ data: null, error: null }, NOW)).toBeNull();
  });
  test('a time already passed (clock skew) = go ahead', () => {
    expect(phoneChangeWaitUntil({ data: '2026-11-01T14:59:00Z', error: null }, NOW)).toBeNull();
  });
  test('function missing before 0375, or any read failure = go ahead (the server guard still decides)', () => {
    expect(phoneChangeWaitUntil({ data: null, error: { code: 'PGRST202' } }, NOW)).toBeNull();
    expect(phoneChangeWaitUntil({ data: null, error: { message: 'Network request failed' } }, NOW)).toBeNull();
    expect(phoneChangeWaitUntil(null, NOW)).toBeNull();
    expect(phoneChangeWaitUntil({ data: 'not a date', error: null }, NOW)).toBeNull();
  });
  test('the time renders as text', () => {
    expect(typeof phoneChangeWaitTime(new Date('2026-11-02T09:30:00Z'))).toBe('string');
  });
  test('every language has the strings, the wait body carries {time} and says 7 (revised 2026-11-01: 7-day session)', () => {
    for (const [lang, s] of Object.entries(settings)) {
      expect([lang, typeof s.phoneChangeWaitTitle]).toEqual([lang, 'string']);
      expect(s.phoneChangeWaitBody).toContain('{time}');
      expect(s.phoneChangeWaitBody).toContain('7');
      expect(s.phoneChangeWaitBody).not.toContain('24');
      for (const k of ['confirmItsYouTitle', 'stepUpFailed', 'stepUpRateLimited', 'accountOnHold', 'deletionScheduledTitle']) {
        expect([lang, k, typeof s[k]]).toEqual([lang, k, 'string']);
      }
      expect(s.confirmItsYouBody).toContain('{target}');
      expect(s.deletionScheduledBody).toContain('{date}');
    }
  });
});
