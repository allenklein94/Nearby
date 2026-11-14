import { PROFILE_GROUPS, DEFAULT_PROFILE_GROUP, toggleProfileGroup, profileGroupFor } from './profileGroups';

describe('Business Profile groups (owner audit 2026-11-14)', () => {
  test('one group open at a time: opening one closes the other, tapping the open one closes it', () => {
    expect(toggleProfileGroup('basics', 'who')).toBe('who');
    expect(toggleProfileGroup('who', 'who')).toBeNull();
    expect(toggleProfileGroup(null, 'settings')).toBe('settings');
    expect(toggleProfileGroup('grow', 'nope')).toBe('grow');
  });
  test('links land on a real group, unknown = Business Profile', () => {
    expect(DEFAULT_PROFILE_GROUP).toBe('basics');
    expect(profileGroupFor('grow')).toBe('grow');
    expect(profileGroupFor(undefined)).toBe('basics');
    expect(profileGroupFor('xyz')).toBe('basics');
    expect(PROFILE_GROUPS).toEqual(['basics', 'accommodate', 'who', 'grow', 'teach', 'settings']);
  });
});
