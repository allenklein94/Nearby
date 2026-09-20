const fs = require('fs');
const path = require('path');
const { datingCardFacts } = require('./datingCardReasons');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

describe('Dating cards explain themselves (item 77)', () => {
  test('shared interests are the WHY; the crossing is the WHERE/WHEN', () => {
    const f = datingCardFacts({ sharedInterests: ['Live Music', 'Coffee'] }, { crossedPathsTime: '2 hours ago' });
    expect(f.reason).toEqual({ kind: 'shared_interests', tags: ['Live Music', 'Coffee'] });
    expect(f.where).toBe('📍 Within about 35 feet · 2 hours ago');
  });
  test('a shared gathering replaces the crossing text', () => {
    expect(datingCardFacts({ sharedInterests: [] }, { gatheringText: 'You both went to Trivia' }).where).toBe('🗓️ You both went to Trivia');
  });
  test('Crossed Paths with no shared interest lets the crossing be the reason (no invented one)', () => {
    expect(datingCardFacts({ sharedInterests: [] }, { mode: 'crossedPaths' }).reason).toBeNull();
  });
  test('Browse says the one true thing and never a bare "Matches your filters" or an invented mileage', () => {
    const f = datingCardFacts({ sharedInterests: [] }, { mode: 'browse' });
    expect(f.reason).toEqual({ kind: 'preferences', text: 'Fits your dating preferences' });
    expect(f.where).toBe('📍 In your area');
    expect(f.where).not.toMatch(/\d+(\.\d+)? mi/);
  });
  test('no availability claim is ever made for a stranger', () => {
    const src = read('./datingCardReasons.js').replace(/\/\/[^\n]*/g, '');
    expect(src).not.toMatch(/available/i);
  });
  test('both the list card and the swipe deck render through the one helper', () => {
    expect(read('../screens/DiscoveryScreen.js')).toMatch(/datingCardFacts\(item/);
    expect(read('../components/SwipeableDiscoveryCards.js')).toMatch(/datingCardFacts\(item/);
    expect(read('../screens/DiscoveryScreen.js')).not.toMatch(/Matches your filters/);
    expect(read('../components/SwipeableDiscoveryCards.js')).not.toMatch(/Matches your filters/);
  });
  test('the reason sits above the proximity line on the list card', () => {
    const src = read('../screens/DiscoveryScreen.js');
    expect(src.indexOf('facts.reason &&')).toBeGreaterThan(-1);
    expect(src.indexOf('facts.reason &&')).toBeLessThan(src.indexOf('{facts.where}'));
  });
});
