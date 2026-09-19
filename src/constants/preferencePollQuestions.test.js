const { PREFERENCE_POLL_QUESTIONS, preferencePollQuestion, preferencePollOptionLabel } = require('./preferencePollQuestions');
const { CUISINE_OPTIONS, VENUE_PREFERENCE_OPTIONS } = require('./businessAttributes');

describe('PREFERENCE_POLL_QUESTIONS', () => {
  it('has exactly the two real question keys the DB CHECK constraint allows', () => {
    expect(PREFERENCE_POLL_QUESTIONS.map((q) => q.key).sort()).toEqual(['cuisine_mood', 'venue_vibe']);
  });

  it('reuses the real CUISINE_OPTIONS/VENUE_PREFERENCE_OPTIONS vocabulary, never a third copy', () => {
    expect(preferencePollQuestion('cuisine_mood').options).toBe(CUISINE_OPTIONS);
    expect(preferencePollQuestion('venue_vibe').options).toBe(VENUE_PREFERENCE_OPTIONS);
  });
});

describe('preferencePollQuestion', () => {
  it('returns null for an unrecognized key', () => {
    expect(preferencePollQuestion('not_a_real_key')).toBeNull();
  });
});

describe('preferencePollOptionLabel', () => {
  it('resolves a real label for a real question/option pair', () => {
    expect(preferencePollOptionLabel('cuisine_mood', 'italian')).toBe('Italian');
    expect(preferencePollOptionLabel('venue_vibe', 'live_music')).toBe('Live Music');
  });

  it('falls back to the raw key for an unrecognized question or option', () => {
    expect(preferencePollOptionLabel('not_a_real_key', 'italian')).toBe('italian');
    expect(preferencePollOptionLabel('cuisine_mood', 'not_a_real_option')).toBe('not_a_real_option');
  });
});
