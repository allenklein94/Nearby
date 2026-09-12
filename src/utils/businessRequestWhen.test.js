import { formatRequestWhen } from './businessRequestWhen';

describe('formatRequestWhen', () => {
  it('returns null when there is no date at all', () => {
    expect(formatRequestWhen(null)).toBeNull();
  });

  it('formats a bare date with no time window', () => {
    expect(formatRequestWhen('2026-09-19')).toBe('Sat, Sep 19');
  });

  it('formats a date with a start time only', () => {
    expect(formatRequestWhen('2026-09-19', '18:00:00')).toBe('Sat, Sep 19, 6 PM');
  });

  it('formats a date with a full start-end window', () => {
    expect(formatRequestWhen('2026-09-19', '18:00:00', '21:00:00')).toBe('Sat, Sep 19, 6 PM–9 PM');
  });

  it('formats non-zero minutes', () => {
    expect(formatRequestWhen('2026-09-19', '18:30:00')).toBe('Sat, Sep 19, 6:30 PM');
  });

  it('formats midnight and noon correctly', () => {
    expect(formatRequestWhen('2026-09-19', '00:00:00')).toBe('Sat, Sep 19, 12 AM');
    expect(formatRequestWhen('2026-09-19', '12:00:00')).toBe('Sat, Sep 19, 12 PM');
  });

  it('returns null for a malformed date string', () => {
    expect(formatRequestWhen('not-a-date')).toBeNull();
  });
});
