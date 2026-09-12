import {
  composeWhoForPhrase,
  buildGatheringQuickStartTitle,
  buildAskBusinessPrefillText,
  buildOccasionWhoForParams,
} from './createHubWhoFor';

describe('composeWhoForPhrase', () => {
  it('possessive-izes a real name', () => {
    expect(composeWhoForPhrase('Sarah')).toBe("Sarah's");
  });
  it('falls back to a generic phrase with no name', () => {
    expect(composeWhoForPhrase(null)).toBe('Their');
    expect(composeWhoForPhrase('')).toBe('Their');
  });
});

describe('buildGatheringQuickStartTitle', () => {
  it('returns null for "me" or no selection -- never fabricates a title', () => {
    expect(buildGatheringQuickStartTitle('me', null)).toBeNull();
    expect(buildGatheringQuickStartTitle(null, null)).toBeNull();
  });
  it('composes a real, editable prefill for a named person', () => {
    expect(buildGatheringQuickStartTitle('friend', 'Sarah')).toBe("Sarah's Gathering");
  });
  it('falls back to a generic phrase with no name for family/someone_else', () => {
    expect(buildGatheringQuickStartTitle('family', null)).toBe('Their Gathering');
    expect(buildGatheringQuickStartTitle('someone_else', null)).toBe('Their Gathering');
  });
});

describe('buildAskBusinessPrefillText', () => {
  it('returns null for "me" or no selection', () => {
    expect(buildAskBusinessPrefillText('me', 'Sarah')).toBeNull();
    expect(buildAskBusinessPrefillText(null, null)).toBeNull();
  });
  it('composes real prefill text for a named person', () => {
    expect(buildAskBusinessPrefillText('friend', 'Sarah')).toBe('Something for Sarah');
  });
  it('falls back to a generic phrase with no name', () => {
    expect(buildAskBusinessPrefillText('family', null)).toBe('Something for someone special');
  });
});

describe('buildOccasionWhoForParams', () => {
  it('returns an empty object with no whoFor selection', () => {
    expect(buildOccasionWhoForParams({ whoFor: null, whoForName: null, whoForFriendId: null })).toEqual({});
  });
  it('threads a real connected friend id through for a non-me selection', () => {
    expect(buildOccasionWhoForParams({ whoFor: 'friend', whoForName: 'Sarah', whoForFriendId: 'sarah-id' })).toEqual({
      initialWhoFor: 'friend',
      initialWhoForName: 'Sarah',
      initialWhoForFriendId: 'sarah-id',
    });
  });
  it('never carries a friend id through for "me"', () => {
    expect(buildOccasionWhoForParams({ whoFor: 'me', whoForName: null, whoForFriendId: 'sarah-id' })).toEqual({
      initialWhoFor: 'me',
      initialWhoForName: null,
      initialWhoForFriendId: null,
    });
  });
  it('trims a hand-typed name and normalizes blank to null', () => {
    expect(buildOccasionWhoForParams({ whoFor: 'someone_else', whoForName: '  Mom  ', whoForFriendId: null })).toEqual({
      initialWhoFor: 'someone_else',
      initialWhoForName: 'Mom',
      initialWhoForFriendId: null,
    });
    expect(buildOccasionWhoForParams({ whoFor: 'someone_else', whoForName: '   ', whoForFriendId: null })).toEqual({
      initialWhoFor: 'someone_else',
      initialWhoForName: null,
      initialWhoForFriendId: null,
    });
  });
});
