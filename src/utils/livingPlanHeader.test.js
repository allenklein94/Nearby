import { stripTrailingCelebrationIcon, buildPlanHeaderChangeKey } from './livingPlanHeader';

describe('stripTrailingCelebrationIcon', () => {
  it('strips a real trailing icon match', () => {
    expect(stripTrailingCelebrationIcon("Sarah's Birthday 🎂", '🎂')).toBe("Sarah's Birthday");
  });

  it('leaves a title with no matching trailing icon untouched', () => {
    expect(stripTrailingCelebrationIcon("Sarah's Birthday", '🎂')).toBe("Sarah's Birthday");
  });

  it('does not strip an icon that only appears mid-title', () => {
    expect(stripTrailingCelebrationIcon('🎂 Birthday Dinner', '🎂')).toBe('🎂 Birthday Dinner');
  });

  it('handles a null/empty title', () => {
    expect(stripTrailingCelebrationIcon(null, '🎂')).toBe('');
    expect(stripTrailingCelebrationIcon('', '🎂')).toBe('');
  });

  it('returns the title unchanged when no icon is given', () => {
    expect(stripTrailingCelebrationIcon("Sarah's Birthday 🎂", null)).toBe("Sarah's Birthday 🎂");
  });
});

describe('buildPlanHeaderChangeKey', () => {
  it('produces the same key for an unchanged summary', () => {
    const summary = { statusKind: 'confirmed', title: 'x', dateLabel: 'd', timeLabel: 't', location: 'l', partySize: 4 };
    expect(buildPlanHeaderChangeKey(summary)).toBe(buildPlanHeaderChangeKey({ ...summary }));
  });

  it('produces a different key when status changes', () => {
    const a = { statusKind: 'booking_pending', title: 'x' };
    const b = { statusKind: 'confirmed', title: 'x' };
    expect(buildPlanHeaderChangeKey(a)).not.toBe(buildPlanHeaderChangeKey(b));
  });

  it('produces a different key when party size changes', () => {
    const a = { statusKind: 'confirmed', title: 'x', partySize: 4 };
    const b = { statusKind: 'confirmed', title: 'x', partySize: 6 };
    expect(buildPlanHeaderChangeKey(a)).not.toBe(buildPlanHeaderChangeKey(b));
  });

  it('handles a missing summary', () => {
    expect(buildPlanHeaderChangeKey(null)).toBe('');
  });
});
