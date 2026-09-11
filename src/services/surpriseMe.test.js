// "Surprise Me" (critique item 28). Pure-function tests only -- same
// testing shape as experienceAssembly.test.js/intentResolverScoring.test.js;
// runSurpriseMe() itself (the async orchestrator) isn't unit tested here,
// same precedent as resolveIntent() itself never being unit tested (it's
// pure I/O wiring around already-tested pure pieces).
const {
  moodToParams,
  categoryPoolForMood,
  pickSampleCategories,
  mergeCandidatePools,
  eligibleCandidates,
  pickSuggestion,
  pickNextFromPool,
  suggestionTags,
  suggestionCandidateKeys,
  findConnectedPerson,
} = require('./surpriseMeLogic');

function candidate(overrides) {
  return { type: 'business_availability', id: 'default', category: null, subcategory: null, categories: [], score: 0, ...overrides };
}

describe('moodToParams', () => {
  it('gives Date mood a real occasion/attribute/party-type and no category pool (breadth via the occasion template)', () => {
    const params = moodToParams('date');
    expect(params.occasion).toBe('date_night');
    expect(params.attributes).toEqual(['date_friendly']);
    expect(params.partyType).toBe('date');
    expect(params.categoryPool).toBeNull();
  });

  it('scopes Active to the real Activities & Recreation tag pool', () => {
    const params = moodToParams('active');
    expect(params.categoryPool).toEqual(expect.arrayContaining(['Running', 'Yoga', 'Pickleball']));
  });

  it('falls back to no-op params for an unknown mood', () => {
    expect(moodToParams('nonsense')).toEqual({ occasion: null, attributes: [], partyType: null, categoryPool: null });
  });
});

describe('categoryPoolForMood', () => {
  it('excludes the caller\'s own already-declared interests for Something New', () => {
    const pool = categoryPoolForMood('something_new', ['Running', 'Yoga']);
    expect(pool).not.toContain('Running');
    expect(pool).not.toContain('Yoga');
    expect(pool.length).toBeGreaterThan(0);
  });

  it('falls back to the full vocabulary if every tag is already an interest', () => {
    const { INTEREST_OPTIONS } = require('../constants/gatheringCategories');
    const pool = categoryPoolForMood('something_new', INTEREST_OPTIONS);
    expect(pool).toEqual(INTEREST_OPTIONS);
  });

  it('returns null (no category filter) for a vibe-only mood', () => {
    expect(categoryPoolForMood('social', [])).toBeNull();
  });
});

describe('pickSampleCategories', () => {
  it('returns [null] when the pool is null (no category filter to sample from)', () => {
    expect(pickSampleCategories(null)).toEqual([null]);
  });

  it('returns at most `count` distinct real tags from the pool', () => {
    const picked = pickSampleCategories(['A', 'B', 'C', 'D'], 2, () => 0.999);
    expect(picked.length).toBe(2);
    expect(new Set(picked).size).toBe(2);
    picked.forEach((tag) => expect(['A', 'B', 'C', 'D']).toContain(tag));
  });
});

describe('mergeCandidatePools', () => {
  it('dedupes by type+id across multiple resolveIntent() calls and sorts by score desc', () => {
    const merged = mergeCandidatePools([
      [candidate({ id: 'a', score: 3 }), candidate({ id: 'b', score: 9 })],
      [candidate({ id: 'a', score: 3 }), candidate({ id: 'c', score: 5 })],
    ]);
    expect(merged.map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('eligibleCandidates', () => {
  it('excludes friend_request results (no honest "surprise activity" framing for someone else\'s ask)', () => {
    const pool = [candidate({ id: 'a', type: 'gathering' }), candidate({ id: 'b', type: 'friend_request' })];
    expect(eligibleCandidates(pool).map((c) => c.id)).toEqual(['a']);
  });
});

describe('pickSuggestion', () => {
  it('prefers a real assembled experience when one exists', () => {
    const experience = { title: 'x', occasion: 'date_night', bundles: [], components: [{ key: 'dinner', label: 'Dinner', items: [candidate({ id: 'd' })] }] };
    const result = pickSuggestion(experience, [candidate({ id: 'z', score: 100 })]);
    expect(result).toEqual({ kind: 'experience', experience });
  });

  it('falls back to the top-scored eligible candidate when there is no experience', () => {
    const pool = [candidate({ id: 'low', score: 1 }), candidate({ id: 'high', score: 9 })];
    expect(pickSuggestion(null, pool)).toEqual({ kind: 'candidate', candidate: pool[1] });
  });

  it('returns null when there is genuinely nothing real to suggest', () => {
    expect(pickSuggestion(null, [])).toBeNull();
    expect(pickSuggestion({ bundles: [], components: [] }, [])).toBeNull();
  });
});

describe('pickNextFromPool', () => {
  it('re-rolls among the already-fetched pool, excluding what was already shown', () => {
    const pool = [candidate({ id: 'a', score: 9 }), candidate({ id: 'b', score: 5 })];
    const next = pickNextFromPool(pool, new Set(['business_availability:a']));
    expect(next).toEqual({ kind: 'candidate', candidate: pool[1] });
  });

  it('returns null when the real pool is exhausted rather than fabricating an alternative', () => {
    const pool = [candidate({ id: 'a' })];
    expect(pickNextFromPool(pool, new Set(['business_availability:a']))).toBeNull();
  });
});

describe('suggestionTags', () => {
  it('collects every real category/subcategory/secondary-category tag from a candidate suggestion', () => {
    const suggestion = { kind: 'candidate', candidate: candidate({ category: 'Foodie', subcategory: 'Coffee', categories: ['Wine'] }) };
    expect(suggestionTags(suggestion).sort()).toEqual(['Coffee', 'Foodie', 'Wine']);
  });

  it('collects tags from every item across an experience\'s bundles and components', () => {
    const suggestion = {
      kind: 'experience',
      experience: {
        bundles: [candidate({ id: 'bun', category: 'Wine' })],
        components: [{ key: 'dinner', items: [candidate({ id: 'd', category: 'Foodie' })] }],
      },
    };
    expect(suggestionTags(suggestion).sort()).toEqual(['Foodie', 'Wine']);
  });
});

describe('suggestionCandidateKeys', () => {
  it('returns the single candidate\'s own type:id key', () => {
    const suggestion = { kind: 'candidate', candidate: candidate({ id: 'x', type: 'gathering' }) };
    expect(suggestionCandidateKeys(suggestion)).toEqual(['gathering:x']);
  });

  it('returns every bundle and component item\'s key for an experience', () => {
    const suggestion = {
      kind: 'experience',
      experience: {
        bundles: [candidate({ id: 'bun' })],
        components: [{ key: 'dinner', items: [candidate({ id: 'd' })] }],
      },
    };
    expect(suggestionCandidateKeys(suggestion).sort()).toEqual(['business_availability:bun', 'business_availability:d']);
  });
});

describe('findConnectedPerson', () => {
  const suggestion = { kind: 'candidate', candidate: candidate({ category: 'Yoga' }) };

  it('names a real connected person whose own declared interests genuinely overlap with the suggestion', () => {
    const people = [{ id: 'p1', name: 'Sarah', photo_url: null, interests: ['Yoga', 'Coffee'] }];
    expect(findConnectedPerson(suggestion, people)).toEqual({ id: 'p1', name: 'Sarah', photo_url: null });
  });

  it('never forces a result when nobody connected has a real overlap', () => {
    const people = [{ id: 'p1', name: 'Sarah', photo_url: null, interests: ['Coffee'] }];
    expect(findConnectedPerson(suggestion, people)).toBeNull();
  });

  it('returns null with no connected people at all', () => {
    expect(findConnectedPerson(suggestion, [])).toBeNull();
  });
});
