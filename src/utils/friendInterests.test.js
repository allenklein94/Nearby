import { friendsInterestReason, FRIEND_INTEREST_PATTERN } from './friendInterests';
import { mergeHomeGatheringSignals } from './homeSignalMerge';
import { reasonKind, reasonTier, SIGNAL_TIERS } from '../constants/signalPriority';
import { categorizeReasonText, REASON_CATEGORIES } from '../constants/recommendationReasonVocabulary';
import { recommendationConfidence } from './recommendationConfidence';

describe('friends who like a tag', () => {
  test('wording is what it is: a friend is into it, never "you like"', () => {
    expect(friendsInterestReason('Coffee', { friend_count: 1, sample_names: ['Sam'] })).toBe('Sam is into Coffee');
    expect(friendsInterestReason('Coffee', { friend_count: 2, sample_names: ['Alex', 'Sam'] })).toBe('Alex and Sam are into Coffee');
    expect(friendsInterestReason('Coffee', { friend_count: 5, sample_names: ['Alex', 'Sam'] })).toBe('Alex, Sam and 3 more friends are into Coffee');
    expect(friendsInterestReason('Coffee', { friend_count: 3, sample_names: [] })).toBe('3 friends are into Coffee');
    expect(friendsInterestReason('Coffee', { friend_count: 1, sample_names: [] })).toBe('A friend is into Coffee');
  });
  test('no friend, no tag, or a bad count = no reason', () => {
    expect(friendsInterestReason('Coffee', undefined)).toBeNull();
    expect(friendsInterestReason('Coffee', { friend_count: 0 })).toBeNull();
    expect(friendsInterestReason('', { friend_count: 2 })).toBeNull();
    expect(friendsInterestReason('Coffee', { friend_count: 'x' })).toBeNull();
  });
  test('classified as a weak social interest reason, never strong evidence on its own', () => {
    const text = friendsInterestReason('Coffee', { friend_count: 1, sample_names: ['Sam'] });
    expect(FRIEND_INTEREST_PATTERN.test(text)).toBe(true);
    expect(categorizeReasonText(text)).toBe(REASON_CATEGORIES.INTEREST);
    expect(reasonKind(text)).toBe('social');
    expect(reasonTier(text)).toBeGreaterThan(SIGNAL_TIERS.interest);
    expect(recommendationConfidence([{ text }])).toBe('low');
    // ...but a friend GOING is still strong
    expect(recommendationConfidence([{ text: 'Sam is going' }])).toBe('medium');
  });
  test('Home adds it as a reason to a card already shown; the hero absorbs it too', () => {
    const fi = { Coffee: { friend_count: 1, sample_names: ['Sam'] } };
    const merged = mergeHomeGatheringSignals({
      bestPick: { id: 'h', interest_tag: 'Coffee', reasons: [] },
      becauseYouLike: [{ id: 'a', interest_tag: 'Coffee' }, { id: 'b', interest_tag: 'Hiking' }],
      declaredInterests: ['Coffee', 'Hiking'],
      friendInterests: fi,
    });
    expect(merged.hero.reasons).toContain('Sam is into Coffee');
    const a = merged.cards.find((c) => c.gathering.id === 'a');
    expect(a.reasons).toEqual(['Because you like Coffee', 'Sam is into Coffee']);
    expect(merged.cards.find((c) => c.gathering.id === 'b').reasons).toEqual(['Because you like Hiking']);
  });
  test('server contract: accepted friends only, blocks excluded, authenticated only, counts and names only', () => {
    const fs = require('fs'); const path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270185_friends_interested_in.sql'), 'utf8');
    expect(sql).toMatch(/f\.status = 'accepted'/);
    expect(sql).not.toMatch(/matches/);
    expect(sql).toMatch(/from blocks/);
    expect(sql).toMatch(/revoke all on function public\.get_friends_interested_in\(text\[\]\) from public, anon/);
    expect(sql).toMatch(/returns table \(tag text, friend_count integer, sample_names text\[\]\)/);
  });
});
