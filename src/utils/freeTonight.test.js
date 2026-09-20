import { endOfTonight, matchDistanceLabel, MUTUAL_FREE_TONIGHT_LINE } from './freeTonight';
import { datingCardFacts } from './datingCardReasons';
import fs from 'fs';

describe('free tonight + match distance (item 77 follow-ups)', () => {
  it('tonight ends at the next 4 AM local', () => {
    const e = endOfTonight(new Date(2026, 8, 20, 19, 0));
    expect([e.getDate(), e.getHours()]).toEqual([21, 4]);
    const late = endOfTonight(new Date(2026, 8, 21, 1, 0));
    expect([late.getDate(), late.getHours()]).toEqual([21, 4]);
  });
  it('a card claims "Both free tonight" only when the server said so', () => {
    expect(datingCardFacts({}, { mode: 'browse' }).availability).toBeNull();
    expect(datingCardFacts({}, { mode: 'browse', mutualFreeTonight: false }).availability).toBeNull();
    expect(datingCardFacts({}, { mode: 'browse', mutualFreeTonight: true }).availability).toBe(MUTUAL_FREE_TONIGHT_LINE);
  });
  it('distance is whole miles and unknown says nothing', () => {
    expect(matchDistanceLabel(0)).toBe('Within about 1 mi');
    expect(matchDistanceLabel(3)).toBe('About 3 mi away');
    for (const v of [null, undefined, NaN, -1]) expect(matchDistanceLabel(v)).toBeNull();
  });
  it('stranger cards never carry a distance and only Matches asks for one', () => {
    const src = (f) => fs.readFileSync(`${__dirname}/../${f}`, 'utf8');
    expect(src('utils/datingCardReasons.js')).not.toMatch(/formatDistance\(/);
    expect(src('screens/DiscoveryScreen.js')).not.toContain('getMatchDistanceMiles');
    expect(src('screens/MatchesScreen.js')).toContain('getMatchDistanceMiles');
  });
});
