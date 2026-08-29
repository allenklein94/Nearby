const { getGatheringFullness, gatheringFullnessLabel } = require('./gatheringFullness');

describe('getGatheringFullness', () => {
  test('returns null when no capacity is set (honest "no limit", never fabricated)', () => {
    expect(getGatheringFullness({ capacity: null, approvedAttendees: [] })).toBeNull();
    expect(getGatheringFullness(undefined)).toBeNull();
  });

  test('computes spotsLeft/isFull/almostFull from capacity and real approvedAttendees', () => {
    const g = { capacity: 10, approvedAttendees: new Array(3) };
    const f = getGatheringFullness(g);
    expect(f).toEqual({ attendeeCount: 3, capacity: 10, spotsLeft: 7, isFull: false, almostFull: false });
  });

  test('almost full at <= max(2, ceil(20% of capacity))', () => {
    const g = { capacity: 10, approvedAttendees: new Array(8) }; // 2 left, threshold = max(2, 2) = 2
    expect(getGatheringFullness(g).almostFull).toBe(true);
  });

  test('full when spotsLeft is 0, never negative', () => {
    const g = { capacity: 5, approvedAttendees: new Array(7) }; // over capacity somehow
    const f = getGatheringFullness(g);
    expect(f.isFull).toBe(true);
    expect(f.spotsLeft).toBe(0);
    expect(f.almostFull).toBe(false);
  });

  test('falls back to attendeeCount when approvedAttendees array is absent', () => {
    const g = { capacity: 4, attendeeCount: 4 };
    expect(getGatheringFullness(g).isFull).toBe(true);
  });
});

describe('gatheringFullnessLabel', () => {
  test('no capacity -> null (no label rendered at all)', () => {
    expect(gatheringFullnessLabel({ capacity: null })).toBeNull();
  });

  test('full -> the exact locked "Join Waitlist" wording', () => {
    expect(gatheringFullnessLabel({ capacity: 4, approvedAttendees: new Array(4) }))
      .toBe('🔒 Full — Join Waitlist');
  });

  test('almost full -> the fire-emoji singular/plural wording', () => {
    expect(gatheringFullnessLabel({ capacity: 10, approvedAttendees: new Array(9) }))
      .toBe('🔥 1 spot left');
    expect(gatheringFullnessLabel({ capacity: 10, approvedAttendees: new Array(8) }))
      .toBe('🔥 2 spots left');
  });

  test('plenty of room -> the green-dot wording', () => {
    expect(gatheringFullnessLabel({ capacity: 20, approvedAttendees: new Array(2) }))
      .toBe('🟢 18 spots left');
  });
});
