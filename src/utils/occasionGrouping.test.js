import { groupOccasionsByPerson } from './occasionGrouping';

describe('groupOccasionsByPerson', () => {
  it('groups occasions sharing a real connected friend id together', () => {
    const occasions = [
      { id: '1', who_for_friend_id: 'sarah-id', who_for_name: 'Sarah', occasion_type: 'birthday' },
      { id: '2', who_for_friend_id: 'sarah-id', who_for_name: 'Sarah', occasion_type: 'anniversary' },
    ];
    const groups = groupOccasionsByPerson(occasions);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Sarah');
    expect(groups[0].occasions).toHaveLength(2);
  });

  it('groups by hand-typed name case/whitespace-insensitively when no friend id exists', () => {
    const occasions = [
      { id: '1', who_for_friend_id: null, who_for_name: 'Mom', occasion_type: 'birthday' },
      { id: '2', who_for_friend_id: null, who_for_name: ' mom ', occasion_type: 'other' },
    ];
    const groups = groupOccasionsByPerson(occasions);
    expect(groups).toHaveLength(1);
    expect(groups[0].occasions).toHaveLength(2);
  });

  it('treats a friend id and a same-named free-typed entry as distinct people', () => {
    const occasions = [
      { id: '1', who_for_friend_id: 'sarah-id', who_for_name: 'Sarah', occasion_type: 'birthday' },
      { id: '2', who_for_friend_id: null, who_for_name: 'Sarah', occasion_type: 'graduation' },
    ];
    const groups = groupOccasionsByPerson(occasions);
    expect(groups).toHaveLength(2);
  });

  it('buckets occasions with no linked person as a trailing unlinked group', () => {
    const occasions = [
      { id: '1', who_for_friend_id: 'sarah-id', who_for_name: 'Sarah', occasion_type: 'birthday' },
      { id: '2', who_for_friend_id: null, who_for_name: null, occasion_type: 'promotion' },
    ];
    const groups = groupOccasionsByPerson(occasions);
    expect(groups).toHaveLength(2);
    expect(groups[1].key).toBe('__unlinked__');
    expect(groups[1].label).toBeNull();
  });

  it('returns an empty array for no occasions', () => {
    expect(groupOccasionsByPerson([])).toEqual([]);
    expect(groupOccasionsByPerson(undefined)).toEqual([]);
  });
});
