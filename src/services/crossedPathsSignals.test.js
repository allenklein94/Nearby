// Unified Crossed Paths (CLAUDE.md, 2026-09-10 plan, step 7). Unit tests
// for crossedPathsSignals.js's pure functions -- run anywhere, no
// device/network needed, same pattern as intentResolverScoring.test.js.
const {
  mergeCrossedPathsSignals,
  filterFriendCrossedPathsCandidates,
  formatCrossedPathsTime,
  formatCrossedPathsTimeShort,
  gatheringReasonText,
} = require('./crossedPathsSignals');

describe('mergeCrossedPathsSignals', () => {
  it('returns a proximity-reasoned candidate when only a sighting exists', () => {
    const result = mergeCrossedPathsSignals(
      [{ otherUserId: 'u1', last_seen_at: '2026-09-10T10:00:00.000Z', sightingId: 's1' }],
      []
    );
    expect(result).toEqual([{
      otherUserId: 'u1',
      last_seen_at: '2026-09-10T10:00:00.000Z',
      sightingId: 's1',
      sightingLat: null,
      sightingLng: null,
      crossedPathsReason: { type: 'proximity', lastSeenAt: '2026-09-10T10:00:00.000Z' },
    }]);
  });

  it('returns a gathering-reasoned candidate when only shared attendance exists', () => {
    const result = mergeCrossedPathsSignals(
      [],
      [{ other_user_id: 'u2', gathering_id: 'g1', gathering_title: 'Sunset Hike', scheduled_at: '2026-09-01T18:00:00.000Z' }]
    );
    expect(result).toEqual([{
      otherUserId: 'u2',
      last_seen_at: null,
      sightingId: null,
      sightingLat: null,
      sightingLng: null,
      crossedPathsReason: { type: 'gathering', gatheringId: 'g1', gatheringTitle: 'Sunset Hike', scheduledAt: '2026-09-01T18:00:00.000Z' },
    }]);
  });

  // The locked rule this whole feature hinges on: when both a real
  // sighting AND a real shared gathering exist for the same pair, the
  // gathering explanation always wins -- never blended into one generic
  // line -- but the real sighting fields (last_seen_at/sightingId) are
  // still preserved on the merged candidate for any caller that wants
  // them (e.g. "View on map").
  it('prefers the gathering reason over proximity for the same pair, without discarding sighting fields', () => {
    const result = mergeCrossedPathsSignals(
      [{ otherUserId: 'u3', last_seen_at: '2026-09-10T10:00:00.000Z', sightingId: 's3' }],
      [{ other_user_id: 'u3', gathering_id: 'g3', gathering_title: 'Trivia Night', scheduled_at: '2026-08-20T20:00:00.000Z' }]
    );
    expect(result).toHaveLength(1);
    expect(result[0].crossedPathsReason).toEqual({
      type: 'gathering', gatheringId: 'g3', gatheringTitle: 'Trivia Night', scheduledAt: '2026-08-20T20:00:00.000Z',
    });
    expect(result[0].last_seen_at).toBe('2026-09-10T10:00:00.000Z');
    expect(result[0].sightingId).toBe('s3');
  });

  it('handles multiple distinct pairs across both sources without cross-contamination', () => {
    const result = mergeCrossedPathsSignals(
      [{ otherUserId: 'u1', last_seen_at: '2026-09-10T10:00:00.000Z', sightingId: 's1' }],
      [{ other_user_id: 'u2', gathering_id: 'g1', gathering_title: 'Book Club', scheduled_at: '2026-09-01T18:00:00.000Z' }]
    );
    const byId = Object.fromEntries(result.map((r) => [r.otherUserId, r]));
    expect(byId.u1.crossedPathsReason.type).toBe('proximity');
    expect(byId.u2.crossedPathsReason.type).toBe('gathering');
  });

  it('returns an empty array when neither source has anything', () => {
    expect(mergeCrossedPathsSignals([], [])).toEqual([]);
    expect(mergeCrossedPathsSignals()).toEqual([]);
  });

  it('ignores malformed rows with no id rather than throwing', () => {
    expect(mergeCrossedPathsSignals([{ last_seen_at: 'x' }], [{ gathering_id: 'g' }])).toEqual([]);
  });
});

describe('filterFriendCrossedPathsCandidates', () => {
  const candidates = [
    { otherUserId: 'friend-already', crossedPathsReason: { type: 'proximity' } },
    { otherUserId: 'blocked-user', crossedPathsReason: { type: 'proximity' } },
    { otherUserId: 'not-opted-in', crossedPathsReason: { type: 'gathering' } },
    { otherUserId: 'eligible-user', crossedPathsReason: { type: 'gathering' } },
  ];

  it('excludes anyone in the exclusion set even if they opted in', () => {
    const result = filterFriendCrossedPathsCandidates(candidates, {
      excludedUserIds: new Set(['friend-already', 'blocked-user']),
      openToFriendDiscoveryUserIds: new Set(['friend-already', 'blocked-user', 'eligible-user']),
    });
    expect(result.map((c) => c.otherUserId)).toEqual(['eligible-user']);
  });

  it('excludes anyone not opted into friend discovery even if not otherwise excluded', () => {
    const result = filterFriendCrossedPathsCandidates(candidates, {
      excludedUserIds: new Set(),
      openToFriendDiscoveryUserIds: new Set(['eligible-user']),
    });
    expect(result.map((c) => c.otherUserId)).toEqual(['eligible-user']);
  });

  it('returns everything when there is nothing to exclude and everyone opted in', () => {
    const ids = candidates.map((c) => c.otherUserId);
    const result = filterFriendCrossedPathsCandidates(candidates, {
      excludedUserIds: new Set(),
      openToFriendDiscoveryUserIds: new Set(ids),
    });
    expect(result).toHaveLength(candidates.length);
  });

  it('defaults to excluding everyone when no options are passed', () => {
    expect(filterFriendCrossedPathsCandidates(candidates)).toEqual([]);
  });
});

describe('formatCrossedPathsTime / formatCrossedPathsTimeShort', () => {
  it('return null for a missing timestamp', () => {
    expect(formatCrossedPathsTime(null)).toBeNull();
    expect(formatCrossedPathsTimeShort(null)).toBeNull();
  });

  it('report "Just now" for a timestamp seconds ago', () => {
    const now = new Date().toISOString();
    expect(formatCrossedPathsTime(now)).toMatch(/^Just now \(/);
    expect(formatCrossedPathsTimeShort(now)).toBe('Just now');
  });

  it('the short formatter returns null past 24 hours, the full formatter falls back to an absolute stamp', () => {
    const twoDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString();
    expect(formatCrossedPathsTimeShort(twoDaysAgo)).toBeNull();
    expect(formatCrossedPathsTime(twoDaysAgo)).toEqual(expect.any(String));
  });
});

describe('gatheringReasonText', () => {
  it('returns null for a non-gathering or missing reason', () => {
    expect(gatheringReasonText(null)).toBeNull();
    expect(gatheringReasonText({ type: 'proximity' })).toBeNull();
  });

  it('names the gathering and includes a relative time when available', () => {
    const now = new Date().toISOString();
    const text = gatheringReasonText({ type: 'gathering', gatheringTitle: 'Sunset Hike', scheduledAt: now });
    expect(text).toBe('You were both at Sunset Hike · Just now');
  });

  it('omits the time clause when it cannot be formatted', () => {
    const text = gatheringReasonText({ type: 'gathering', gatheringTitle: 'Sunset Hike', scheduledAt: null });
    expect(text).toBe('You were both at Sunset Hike');
  });
});
