import { PROFILE_GROUPS, DEFAULT_PROFILE_GROUP, toggleProfileGroup, profileGroupFor } from './profileGroups';

describe('Business Profile groups (owner audit 2026-11-14)', () => {
  test('one group open at a time: opening one closes the other, tapping the open one closes it', () => {
    expect(toggleProfileGroup('basics', 'who')).toBe('who');
    expect(toggleProfileGroup('who', 'who')).toBeNull();
    expect(toggleProfileGroup(null, 'settings')).toBe('settings');
    expect(toggleProfileGroup('grow', 'nope')).toBe('grow');
  });
  test('Profile opens on the summary (all closed); links land on a real group; Teach Nearby is merged into Tell Nearby', () => {
    expect(DEFAULT_PROFILE_GROUP).toBeNull();
    expect(profileGroupFor('grow')).toBe('grow');
    expect(profileGroupFor(undefined)).toBeNull();
    expect(profileGroupFor('xyz')).toBeNull();
    expect(profileGroupFor('teach')).toBeNull();
    expect(PROFILE_GROUPS).toEqual(['basics', 'accommodate', 'who', 'grow', 'settings']);
  });
});
