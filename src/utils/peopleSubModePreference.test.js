const { resolveDefaultPeopleSubMode } = require('./peopleSubModePreference');

describe('resolveDefaultPeopleSubMode', () => {
  it('defaults to dating with no usage history and no remembered value', () => {
    expect(resolveDefaultPeopleSubMode()).toBe('dating');
  });

  it('falls back to the remembered last-used value below the signal threshold', () => {
    expect(resolveDefaultPeopleSubMode({ datingUses: 1, friendsUses: 2, lastUsedSubMode: 'friends' })).toBe('friends');
    expect(resolveDefaultPeopleSubMode({ datingUses: 1, friendsUses: 2, lastUsedSubMode: 'dating' })).toBe('dating');
  });

  it('defaults to dating below the signal threshold with no remembered value', () => {
    expect(resolveDefaultPeopleSubMode({ datingUses: 0, friendsUses: 3 })).toBe('dating');
  });

  it('lets a real, clearly skewed usage signal override the remembered value', () => {
    expect(resolveDefaultPeopleSubMode({ datingUses: 1, friendsUses: 6, lastUsedSubMode: 'dating' })).toBe('friends');
    expect(resolveDefaultPeopleSubMode({ datingUses: 6, friendsUses: 1, lastUsedSubMode: 'friends' })).toBe('dating');
  });

  it('falls back to last-used on a tie even above the threshold', () => {
    expect(resolveDefaultPeopleSubMode({ datingUses: 4, friendsUses: 4, lastUsedSubMode: 'friends' })).toBe('friends');
  });

  it('ignores an invalid remembered value', () => {
    expect(resolveDefaultPeopleSubMode({ datingUses: 0, friendsUses: 0, lastUsedSubMode: 'bogus' })).toBe('dating');
  });
});
