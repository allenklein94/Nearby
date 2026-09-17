const { buildUpcomingWorldItems, formatUpcomingWorldItemLine } = require('./upcomingWorld');

describe('buildUpcomingWorldItems', () => {
  const occasions = [
    { occasion_id: 'o1', title: "John's Graduation", occasion_type: 'graduation', days_until: 31, who_for_name: 'John', who_for_friend_id: 'f1' },
    { occasion_id: 'o2', title: 'Our Anniversary', occasion_type: 'anniversary', days_until: 22, who_for_name: null, who_for_friend_id: null },
  ];
  const birthdays = [
    { connection_id: 'b1', display_name: 'Sarah', days_until: 10 },
  ];

  it('merges and sorts occasions + birthdays soonest-first, skipping the featured (soonest) item by default', () => {
    const items = buildUpcomingWorldItems({ occasions, birthdays });
    expect(items.map((i) => i.daysUntil)).toEqual([22, 31]);
    expect(items[0].label).toBe('Our Anniversary');
    expect(items[1].label).toBe("John's Graduation");
  });

  it('includes the soonest item when skip is 0', () => {
    const items = buildUpcomingWorldItems({ occasions, birthdays, skip: 0 });
    expect(items.map((i) => i.daysUntil)).toEqual([10, 22, 31]);
    expect(items[0].label).toBe("Sarah's birthday");
  });

  it('respects limit', () => {
    const items = buildUpcomingWorldItems({ occasions, birthdays, skip: 0, limit: 1 });
    expect(items).toHaveLength(1);
    expect(items[0].daysUntil).toBe(10);
  });

  it('returns an empty array when there is nothing beyond the featured item', () => {
    expect(buildUpcomingWorldItems({ occasions: [], birthdays: [{ connection_id: 'b1', display_name: 'Sarah', days_until: 10 }] })).toEqual([]);
  });

  it('never fabricates a birthday label or crashes on missing/empty input', () => {
    expect(buildUpcomingWorldItems()).toEqual([]);
    expect(buildUpcomingWorldItems({ occasions: null, birthdays: null })).toEqual([]);
  });

  it('falls back to a generic icon for an unrecognized occasion type', () => {
    const items = buildUpcomingWorldItems({
      occasions: [{ occasion_id: 'o3', title: 'Something', occasion_type: 'not_a_real_type', days_until: 5 }],
      birthdays: [],
      skip: 0,
    });
    expect(items[0].icon).toBe('📅');
  });
});

describe('formatUpcomingWorldItemLine', () => {
  it('formats a real multi-day item', () => {
    expect(formatUpcomingWorldItemLine({ icon: '🎓', label: "John's Graduation", daysUntil: 31 })).toBe("🎓 John's Graduation — 31 days");
  });

  it('formats today/tomorrow honestly instead of "0 days"/"1 days"', () => {
    expect(formatUpcomingWorldItemLine({ icon: '🎂', label: "Sarah's birthday", daysUntil: 0 })).toBe("🎂 Sarah's birthday — today");
    expect(formatUpcomingWorldItemLine({ icon: '🎂', label: "Sarah's birthday", daysUntil: 1 })).toBe("🎂 Sarah's birthday — tomorrow");
  });

  it('returns an empty string for no item', () => {
    expect(formatUpcomingWorldItemLine(null)).toBe('');
  });

  it('never doubles an icon a wizard-composed title already carries', () => {
    expect(formatUpcomingWorldItemLine({ icon: '🎂', label: "Sarah's Birthday 🎂", daysUntil: 10 }))
      .toBe("Sarah's Birthday 🎂 — 10 days");
  });

  it('still prepends the icon for a plain, manually-typed title with no suffix', () => {
    expect(formatUpcomingWorldItemLine({ icon: '🎓', label: 'Graduation Party', daysUntil: 5 }))
      .toBe('🎓 Graduation Party — 5 days');
  });
});
