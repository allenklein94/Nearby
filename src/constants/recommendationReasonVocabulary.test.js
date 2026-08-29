const {
  REASON_CATEGORIES,
  REASON_CATEGORY_ICONS,
  REASON_TEXT,
  categorizeReasonText,
} = require('./recommendationReasonVocabulary');

describe('REASON_CATEGORIES / REASON_CATEGORY_ICONS', () => {
  it('has exactly the 7 named categories, each with a real icon', () => {
    const keys = Object.values(REASON_CATEGORIES);
    expect(keys).toEqual(['interest', 'distance', 'time', 'context', 'availability', 'capacity', 'popularity']);
    for (const key of keys) {
      expect(typeof REASON_CATEGORY_ICONS[key]).toBe('string');
      expect(REASON_CATEGORY_ICONS[key].length).toBeGreaterThan(0);
    }
  });
});

describe('categorizeReasonText', () => {
  it('classifies every shared REASON_TEXT constant correctly', () => {
    expect(categorizeReasonText(REASON_TEXT.MATCHES_INTERESTS.text)).toBe(REASON_CATEGORIES.INTEREST);
    expect(categorizeReasonText(REASON_TEXT.HAPPENING_TODAY.text)).toBe(REASON_CATEGORIES.TIME);
    expect(categorizeReasonText(REASON_TEXT.WEATHER_GOOD_INDOOR.text)).toBe(REASON_CATEGORIES.CONTEXT);
    expect(categorizeReasonText(REASON_TEXT.WEATHER_GOOD_OUTDOOR.text)).toBe(REASON_CATEGORIES.CONTEXT);
  });

  it('classifies homeRecommendations.js\'s own distance/context reasons', () => {
    expect(categorizeReasonText('Close by')).toBe(REASON_CATEGORIES.DISTANCE);
    expect(categorizeReasonText('You loved a gathering with this host before')).toBe(REASON_CATEGORIES.CONTEXT);
    expect(categorizeReasonText('You loved this business last time')).toBe(REASON_CATEGORIES.CONTEXT);
  });

  it('classifies getGatheringFitReasons()\'s real parameterized reasons', () => {
    expect(categorizeReasonText('1 person attending')).toBe(REASON_CATEGORIES.POPULARITY);
    expect(categorizeReasonText('12 people attending')).toBe(REASON_CATEGORIES.POPULARITY);
    expect(categorizeReasonText('1 attendee is also first-timers')).toBe(REASON_CATEGORIES.CONTEXT);
    expect(categorizeReasonText('3 attendees are also first-timers')).toBe(REASON_CATEGORIES.CONTEXT);
    expect(categorizeReasonText('Beginner friendly')).toBe(REASON_CATEGORIES.CONTEXT);
    expect(categorizeReasonText('Very close')).toBe(REASON_CATEGORIES.DISTANCE);
    expect(categorizeReasonText('0.3 mi away')).toBe(REASON_CATEGORIES.DISTANCE);
    expect(categorizeReasonText('12.7 mi away')).toBe(REASON_CATEGORIES.DISTANCE);
  });

  it('classifies FriendDiscoverySwipeCards.js\'s real shared-context bits and distance bucket', () => {
    expect(categorizeReasonText('1 interest in common')).toBe(REASON_CATEGORIES.INTEREST);
    expect(categorizeReasonText('4 interests in common')).toBe(REASON_CATEGORIES.INTEREST);
    expect(categorizeReasonText('in 2 of your communities')).toBe(REASON_CATEGORIES.CONTEXT);
    expect(categorizeReasonText('1 mutual friend')).toBe(REASON_CATEGORIES.CONTEXT);
    expect(categorizeReasonText('3 mutual friends')).toBe(REASON_CATEGORIES.CONTEXT);
    expect(categorizeReasonText('Nearby')).toBe(REASON_CATEGORIES.DISTANCE);
    expect(categorizeReasonText('A few miles away')).toBe(REASON_CATEGORIES.DISTANCE);
    expect(categorizeReasonText('In the wider area')).toBe(REASON_CATEGORIES.DISTANCE);
  });

  it('classifies real gathering-fullness and business-availability labels', () => {
    expect(categorizeReasonText('🔒 Full — Join Waitlist')).toBe(REASON_CATEGORIES.CAPACITY);
    expect(categorizeReasonText('🔒 Full — Join Waitlist (5/5 spots taken)')).toBe(REASON_CATEGORIES.CAPACITY);
    expect(categorizeReasonText('🔥 1 spot left')).toBe(REASON_CATEGORIES.CAPACITY);
    expect(categorizeReasonText('🟢 3 spots left')).toBe(REASON_CATEGORIES.CAPACITY);
    expect(categorizeReasonText('🟢 A business has this ready')).toBe(REASON_CATEGORIES.AVAILABILITY);
    expect(categorizeReasonText('🟡 A business may be able to help')).toBe(REASON_CATEGORIES.AVAILABILITY);
    expect(categorizeReasonText('May be available — business confirmation required')).toBe(REASON_CATEGORIES.AVAILABILITY);
  });

  it('never guesses -- returns null for anything genuinely unclassified', () => {
    expect(categorizeReasonText('At Coastal Coffee')).toBeNull();
    expect(categorizeReasonText('Some made-up reason nobody produces')).toBeNull();
    expect(categorizeReasonText('')).toBeNull();
    expect(categorizeReasonText(null)).toBeNull();
    expect(categorizeReasonText(undefined)).toBeNull();
  });
});
