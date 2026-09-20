import { parseDate, formatDateTime, formatDay, formatAgo } from './timeLabels';

const NOW = new Date('2026-09-20T12:00:00Z').getTime();
const ago = (ms) => new Date(NOW - ms).toISOString();

describe('timeLabels', () => {
  test('missing or invalid input is null, never Invalid Date / 1970', () => {
    for (const v of [null, undefined, '', 'garbage']) {
      expect(parseDate(v)).toBeNull();
      expect(formatDateTime(v)).toBeNull();
      expect(formatDay(v)).toBeNull();
      expect(formatAgo(v, NOW)).toBeNull();
    }
  });
  test('formats a real date', () => {
    expect(formatDateTime('2026-08-14T19:15:00Z')).toMatch(/Aug/);
    expect(formatDay('2026-08-14T12:00:00Z', { withYear: true })).toMatch(/2026/);
  });
  test('relative time is honest at each boundary', () => {
    expect(formatAgo(ago(30 * 1000), NOW)).toBe('just now');
    expect(formatAgo(ago(45 * 60000), NOW)).toBe('45m ago');
    expect(formatAgo(ago(3 * 3600000), NOW)).toBe('3h ago');
    expect(formatAgo(ago(49 * 3600000), NOW)).toBe('2d ago');
  });
  test('small clock skew reads just now; a far-future stamp is not "ago"', () => {
    expect(formatAgo(new Date(NOW + 60000).toISOString(), NOW)).toBe('just now');
    expect(formatAgo(new Date(NOW + 3600000).toISOString(), NOW)).toBeNull();
  });
});
