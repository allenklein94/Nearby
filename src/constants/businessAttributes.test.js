import {
  OCCASION_OPTIONS,
  OCCASION_GROUPS,
  occasionGroupOptions,
  CELEBRATE_OCCASION_KEYS,
  CALENDAR_SAVEABLE_OCCASION_KEYS,
  PERSONAL_OCCASION_TYPE_KEYS,
  personalOccasionTypeGroupOptions,
  occasionLabel,
} from './businessAttributes';

// Item 73 (CLAUDE.md): "have the category architecture flexible enough
// for ... don't hard-code the product around birthdays." Every grouped
// key must resolve to a real OCCASION_OPTIONS entry -- a typo here should
// fail loudly in a test, not silently drop a chip in the app.
describe('OCCASION_GROUPS', () => {
  it('only references real, existing OCCASION_OPTIONS keys', () => {
    const validKeys = new Set(OCCASION_OPTIONS.map((o) => o.key));
    for (const group of OCCASION_GROUPS) {
      for (const key of group.keys) {
        expect(validKeys.has(key)).toBe(true);
      }
    }
  });

  it('never lists the same key in two different groups', () => {
    const allKeys = OCCASION_GROUPS.flatMap((g) => g.keys);
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });

  it('excludes the non-life-event ask occasions from every group', () => {
    const allKeys = new Set(OCCASION_GROUPS.flatMap((g) => g.keys));
    expect(allKeys.has('date_night')).toBe(false);
    expect(allKeys.has('casual_hangout')).toBe(false);
    expect(allKeys.has('business_meal')).toBe(false);
    expect(allKeys.has('family_gathering')).toBe(false);
    expect(allKeys.has('life_event')).toBe(false);
  });

  it('includes every new life-event value from item 73\'s own list', () => {
    const allKeys = new Set(OCCASION_GROUPS.flatMap((g) => g.keys));
    ['wedding', 'retirement', 'new_job', 'achievement', 'moving', 'reunion', 'welcome', 'holiday_gathering'].forEach((key) => {
      expect(allKeys.has(key)).toBe(true);
    });
  });
});

describe('occasionGroupOptions', () => {
  it('resolves each group into real, labeled option objects', () => {
    const groups = occasionGroupOptions();
    const celebrations = groups.find((g) => g.key === 'celebrations');
    expect(celebrations.options.map((o) => o.key)).toContain('wedding');
    expect(celebrations.options.find((o) => o.key === 'wedding').label).toBe('Wedding');
  });
});

describe('CELEBRATE_OCCASION_KEYS / CALENDAR_SAVEABLE_OCCASION_KEYS / PERSONAL_OCCASION_TYPE_KEYS', () => {
  it('CELEBRATE_OCCASION_KEYS is exactly the flattened groups, in order', () => {
    expect(CELEBRATE_OCCASION_KEYS).toEqual(OCCASION_GROUPS.flatMap((g) => g.keys));
  });

  it('CALENDAR_SAVEABLE_OCCASION_KEYS excludes birthday and other, nothing else', () => {
    expect(CALENDAR_SAVEABLE_OCCASION_KEYS).not.toContain('birthday');
    expect(CALENDAR_SAVEABLE_OCCASION_KEYS).not.toContain('other');
    expect(CALENDAR_SAVEABLE_OCCASION_KEYS).toContain('wedding');
    expect(CALENDAR_SAVEABLE_OCCASION_KEYS).toContain('retirement');
  });

  it('PERSONAL_OCCASION_TYPE_KEYS is every celebrate key plus life_event', () => {
    expect(PERSONAL_OCCASION_TYPE_KEYS).toEqual([...CELEBRATE_OCCASION_KEYS, 'life_event']);
  });
});

describe('personalOccasionTypeGroupOptions', () => {
  it('appends life_event onto the Custom group, next to other', () => {
    const groups = personalOccasionTypeGroupOptions();
    const custom = groups.find((g) => g.key === 'custom');
    expect(custom.options.map((o) => o.key)).toEqual(['other', 'life_event']);
  });

  it('leaves every non-custom group unchanged', () => {
    const groups = personalOccasionTypeGroupOptions();
    const celebrations = groups.find((g) => g.key === 'celebrations');
    expect(celebrations.options.map((o) => o.key)).not.toContain('life_event');
  });
});

describe('occasionLabel', () => {
  it('reflects the relabeled promotion value (no longer "Promotion / New Job")', () => {
    expect(occasionLabel('promotion')).toBe('Promotion');
    expect(occasionLabel('new_job')).toBe('New Job');
  });
});
