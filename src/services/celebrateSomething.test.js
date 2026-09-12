import {
  composeCelebrationTitle,
  composeCelebrationAskText,
  resolveCelebrationDestination,
  resolveCelebrationVisibility,
  celebrationCategoryHint,
  shouldOfferCalendarSave,
  buildOccasionSaveParams,
  dateWindowForWhenPreset,
  extractNameFromBirthdayTitle,
  resolveDecidedGroupPlanParams,
} from './celebrateSomething';

describe('composeCelebrationTitle', () => {
  it('uses "My {Occasion}" for whoFor=me', () => {
    expect(composeCelebrationTitle({ occasion: 'birthday', whoFor: 'me' })).toBe('My Birthday');
  });

  it('uses the real chosen name when present, regardless of whoFor', () => {
    expect(composeCelebrationTitle({ occasion: 'graduation', whoFor: 'friend', whoForName: 'Sarah' })).toBe("Sarah's Graduation");
  });

  it('falls back to a generic phrase per whoFor when no name is picked', () => {
    expect(composeCelebrationTitle({ occasion: 'anniversary', whoFor: 'friend' })).toBe('Anniversary Celebration');
  });

  it('collapses "other" to a plain "Celebration" noun instead of "Other Occasion"', () => {
    expect(composeCelebrationTitle({ occasion: 'other', whoFor: 'me' })).toBe('My Celebration');
    expect(composeCelebrationTitle({ occasion: 'other', whoFor: 'friend' })).toBe('A Celebration');
    expect(composeCelebrationTitle({ occasion: 'other', whoFor: 'friend', whoForName: 'Sarah' })).toBe("Sarah's Celebration");
  });
});

describe('composeCelebrationAskText', () => {
  it('combines occasion + activity + a real name', () => {
    expect(composeCelebrationAskText({ occasion: 'birthday', whoFor: 'friend', whoForName: 'Sarah', activityType: 'dinner' })).toBe('A birthday dinner for Sarah');
  });

  it('falls back to a generic who-for phrase with no name picked', () => {
    expect(composeCelebrationAskText({ occasion: 'graduation', whoFor: 'friend', activityType: 'night_out' })).toBe('A graduation night out for a friend');
    expect(composeCelebrationAskText({ occasion: 'promotion', whoFor: 'family', activityType: 'activity' })).toBe('A promotion / new job activity for a family member');
  });

  it('drops "other" from the subject rather than naming it literally', () => {
    expect(composeCelebrationAskText({ occasion: 'other', whoFor: 'me', activityType: 'activity' })).toBe('A activity for me');
  });

  it('honestly falls back to "Something" with no occasion or activity phrase', () => {
    expect(composeCelebrationAskText({ occasion: 'other', whoFor: 'someone_else', activityType: 'custom' })).toBe('Something for someone special');
  });
});

describe('resolveCelebrationDestination', () => {
  it('routes host-it-yourself activity types to gathering', () => {
    expect(resolveCelebrationDestination('party')).toBe('gathering');
    expect(resolveCelebrationDestination('surprise')).toBe('gathering');
    expect(resolveCelebrationDestination('weekend_trip')).toBe('gathering');
  });

  it('routes find-a-business activity types to business', () => {
    expect(resolveCelebrationDestination('dinner')).toBe('business');
    expect(resolveCelebrationDestination('night_out')).toBe('business');
    expect(resolveCelebrationDestination('activity')).toBe('business');
  });

  it('routes custom to the AI-assisted custom path', () => {
    expect(resolveCelebrationDestination('custom')).toBe('custom');
  });
});

describe('resolveCelebrationVisibility', () => {
  it('forces invite_only for a surprise regardless of who is involved', () => {
    expect(resolveCelebrationVisibility({ activityType: 'surprise', whoInvolved: 'existing_group' })).toBe('invite_only');
  });

  it('maps existing_group to community for a non-surprise activity', () => {
    expect(resolveCelebrationVisibility({ activityType: 'party', whoInvolved: 'existing_group' })).toBe('community');
  });

  it('defaults every other who-involved answer to invite_only, never public', () => {
    expect(resolveCelebrationVisibility({ activityType: 'party', whoInvolved: 'friends' })).toBe('invite_only');
    expect(resolveCelebrationVisibility({ activityType: 'party', whoInvolved: 'family' })).toBe('invite_only');
    expect(resolveCelebrationVisibility({ activityType: 'party', whoInvolved: 'invite_specific' })).toBe('invite_only');
  });
});

describe('celebrationCategoryHint', () => {
  it('hints Foodie only for dinner', () => {
    expect(celebrationCategoryHint('dinner')).toBe('Foodie');
  });

  it('leaves every other activity type uncategorized rather than guessing', () => {
    expect(celebrationCategoryHint('night_out')).toBeNull();
    expect(celebrationCategoryHint('activity')).toBeNull();
    expect(celebrationCategoryHint('party')).toBeNull();
  });
});

describe('shouldOfferCalendarSave', () => {
  it('offers the calendar step for genuinely calendar-worthy occasions', () => {
    expect(shouldOfferCalendarSave('anniversary')).toBe(true);
    expect(shouldOfferCalendarSave('graduation')).toBe(true);
    expect(shouldOfferCalendarSave('milestone')).toBe(true);
  });

  it('excludes other (too generic) regardless of connection', () => {
    expect(shouldOfferCalendarSave('other')).toBe(false);
    expect(shouldOfferCalendarSave('other', true)).toBe(false);
  });

  it('offers birthday only when there is no real connected Nearby user attached -- the "don\'t require an account" case', () => {
    expect(shouldOfferCalendarSave('birthday')).toBe(true);
    expect(shouldOfferCalendarSave('birthday', false)).toBe(true);
    expect(shouldOfferCalendarSave('birthday', true)).toBe(false);
  });
});

describe('buildOccasionSaveParams', () => {
  it('defaults recursAnnually to true for anniversary and birthday, false for one-time occasions', () => {
    const scheduledAt = new Date('2026-10-05T18:00:00.000Z');
    expect(buildOccasionSaveParams({ occasion: 'anniversary', title: "Sarah's Anniversary", scheduledAt }).recursAnnually).toBe(true);
    expect(buildOccasionSaveParams({ occasion: 'birthday', title: "Mom's Birthday", scheduledAt }).recursAnnually).toBe(true);
    expect(buildOccasionSaveParams({ occasion: 'graduation', title: "Sarah's Graduation", scheduledAt }).recursAnnually).toBe(false);
  });

  it('carries the real chosen date and connectedUserId through, honestly null when absent', () => {
    const scheduledAt = new Date('2026-10-05T18:00:00.000Z');
    expect(buildOccasionSaveParams({ occasion: 'milestone', title: 'A Milestone Celebration', scheduledAt })).toEqual({
      occasionType: 'milestone',
      title: 'A Milestone Celebration',
      occasionDate: '2026-10-05',
      recursAnnually: false,
      connectedUserId: null,
    });
    expect(buildOccasionSaveParams({ occasion: 'milestone', title: 'x', scheduledAt, connectedUserId: 'user-1' }).connectedUserId).toBe('user-1');
  });
});

describe('dateWindowForWhenPreset', () => {
  it('maps now and tonight to the same "later today" bucket', () => {
    expect(dateWindowForWhenPreset('now')).toBe('tonight');
    expect(dateWindowForWhenPreset('tonight')).toBe('tonight');
  });

  it('maps tomorrow through unchanged', () => {
    expect(dateWindowForWhenPreset('tomorrow')).toBe('tomorrow');
  });

  it('honestly returns null for a custom picked date rather than guessing a bucket', () => {
    expect(dateWindowForWhenPreset('custom')).toBeNull();
    expect(dateWindowForWhenPreset(null)).toBeNull();
  });
});

describe('extractNameFromBirthdayTitle', () => {
  it('extracts the real name from a wizard-composed "X\'s Birthday" title', () => {
    expect(extractNameFromBirthdayTitle("Mom's Birthday")).toBe('Mom');
    expect(extractNameFromBirthdayTitle('Sarah’s Birthday')).toBe('Sarah');
    expect(extractNameFromBirthdayTitle("My Best Friend's Birthday")).toBe('My Best Friend');
  });

  it('is case-insensitive on the trailing "birthday" word', () => {
    expect(extractNameFromBirthdayTitle("Mom's birthday")).toBe('Mom');
  });

  it('honestly returns null for a title that does not match the expected shape, rather than guessing wrong', () => {
    expect(extractNameFromBirthdayTitle('My Birthday')).toBeNull();
    expect(extractNameFromBirthdayTitle('Family Reunion')).toBeNull();
    expect(extractNameFromBirthdayTitle(null)).toBeNull();
    expect(extractNameFromBirthdayTitle('')).toBeNull();
  });
});

describe('resolveDecidedGroupPlanParams', () => {
  it('infers whoFor=friend when a real connected friend id is present', () => {
    const params = resolveDecidedGroupPlanParams({
      occasionType: 'birthday',
      whoForName: 'Sarah',
      whoForFriendId: 'friend-1',
      whenPreset: 'tonight',
      scheduledDate: '2026-10-05',
      activityType: 'dinner',
      label: null,
      partySize: 8,
    });
    expect(params).toEqual({
      initialOccasion: 'birthday',
      initialWhoFor: 'friend',
      initialWhoForName: 'Sarah',
      initialWhoForFriendId: 'friend-1',
      initialActivityType: 'dinner',
      initialWhenPreset: 'tonight',
      initialScheduledAtISO: '2026-10-05T12:00:00',
      initialPartySize: 8,
    });
  });

  it('infers whoFor=someone_else for a real typed name with no connected id', () => {
    const params = resolveDecidedGroupPlanParams({
      occasionType: 'graduation',
      whoForName: 'Alex',
      whoForFriendId: null,
      whenPreset: 'custom',
      scheduledDate: '2026-11-01',
      activityType: 'party',
      label: 'Backyard party',
      partySize: null,
    });
    expect(params.initialWhoFor).toBe('someone_else');
    expect(params.initialPartySize).toBeNull();
  });

  it('infers whoFor=me when neither a name nor a friend id is present', () => {
    const params = resolveDecidedGroupPlanParams({
      occasionType: 'milestone',
      whoForName: null,
      whoForFriendId: null,
      whenPreset: 'now',
      scheduledDate: null,
      activityType: 'activity',
      label: null,
      partySize: 3,
    });
    expect(params.initialWhoFor).toBe('me');
    expect(params.initialScheduledAtISO).toBeNull();
  });
});
