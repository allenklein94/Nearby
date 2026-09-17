import { describeOccasionPrivacy } from './occasionVisibility';

describe('describeOccasionPrivacy', () => {
  it('returns Private for a plain, unshared occasion', () => {
    expect(describeOccasionPrivacy({ connected_user_id: null })).toEqual({ icon: '🔒', label: 'Private' });
  });

  it('returns Shared with {name} when connected_user_id is set and who_for_name is known', () => {
    expect(describeOccasionPrivacy({ connected_user_id: 'u1', who_for_name: 'Sarah' })).toEqual({
      icon: '👤',
      label: 'Shared with Sarah',
    });
  });

  it('falls back to a generic pronoun when connected_user_id is set but who_for_name is missing', () => {
    expect(describeOccasionPrivacy({ connected_user_id: 'u1', who_for_name: null })).toEqual({
      icon: '👤',
      label: 'Shared with them',
    });
  });

  it('stays Private for a surprise occasion (surprise_mode never implies connected_user_id)', () => {
    expect(describeOccasionPrivacy({ connected_user_id: null, surprise_mode: true })).toEqual({
      icon: '🔒',
      label: 'Private',
    });
  });

  it('returns null for a missing occasion', () => {
    expect(describeOccasionPrivacy(null)).toBeNull();
    expect(describeOccasionPrivacy(undefined)).toBeNull();
  });
});
