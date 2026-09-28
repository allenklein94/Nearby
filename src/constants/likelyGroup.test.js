// Item 130 (owner, LOCKED): "probably a group" is a social-context ranking nudge, never a group-size fact.
import fs from 'fs';
import path from 'path';
import { likelyGroupFromAsk, welcomesGroups, applyLikelyGroupToCandidates, LIKELY_GROUP_MIN_CAPACITY, LIKELY_GROUP_POINTS, CAPACITY_FIT_POINTS } from './businessCapabilities';
import { LARGE_GROUP_PARTY_SIZE } from '../services/intentResolverScoring';
import { resolveAsk } from '../utils/askResolver';

const lg = (text) => { const r = resolveAsk(text); return likelyGroupFromAsk({ text, occasion: r.occasion, partyType: r.group.partyType, partySize: r.group.partySize }); };

describe('likelyGroupFromAsk', () => {
  test.each([
    ["I need a place for my daughter's birthday Saturday", true],
    ['graduation party for my son', true],
    ['baby shower this weekend', true],
    ['dinner with my family tonight', true],
    ['housewarming party saturday', true],
    ['birthday dinner for 6', false], // the stated number decides
    ['birthday dinner with my wife', false],
    ['anniversary dinner', false],
    ['date night tonight', false],
    ['first date somewhere casual', false],
    ['coffee tomorrow', false],
    ['dinner tonight', false],
    ['celebrate my promotion', false],
  ])('%s -> %s', (text, want) => expect(lg(text)).toBe(want));

  it('resolveAsk carries the signal and keeps party size unknown', () => {
    const r = resolveAsk("I need a place for my daughter's birthday Saturday");
    expect(r.likelyGroup).toBe(true);
    expect(r.group.partySize).toBeNull();
  });
});

describe('welcomesGroups: only what the business declared', () => {
  it('reads the attribute, the party types it takes, or a large declared max', () => {
    expect(welcomesGroups({ attributes: ['group_friendly'] })).toBe(true);
    expect(welcomesGroups({ accommodates_party_types: ['groups'] })).toBe(true);
    expect(welcomesGroups({ max_group_size: LIKELY_GROUP_MIN_CAPACITY })).toBe(true);
    expect(welcomesGroups({ max_group_size: LIKELY_GROUP_MIN_CAPACITY - 1 })).toBe(false);
    expect(welcomesGroups({ attributes: ['quiet'], accommodates_party_types: ['date'] })).toBe(false);
    expect(welcomesGroups(null)).toBe(false);
  });
  it('the capacity threshold is the one large-group size, and the nudge stays below a stated fit', () => {
    expect(LIKELY_GROUP_MIN_CAPACITY).toBe(LARGE_GROUP_PARTY_SIZE);
    expect(LIKELY_GROUP_POINTS).toBeLessThan(CAPACITY_FIT_POINTS);
  });
  it('lifts, never removes, never penalizes, never adds a party size', () => {
    const cs = [{ id: 'a', score: 3, businessPartner: { attributes: ['group_friendly'] } }, { id: 'b', score: 3, businessPartner: { max_group_size: 2 } }, { id: 'c', score: 3 }];
    const out = applyLikelyGroupToCandidates(cs, true);
    expect(out.map((c) => [c.id, c.score])).toEqual([['a', 4], ['b', 3], ['c', 3]]);
    expect(out.some((c) => 'partySize' in c)).toBe(false);
    expect(applyLikelyGroupToCandidates(cs, false)).toBe(cs);
  });
});

describe('never leaves the client ranking', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
  it('no migration, edge function, business request or business-facing file mentions it', () => {
    const dirs = ['supabase/migrations', 'supabase/functions'];
    for (const d of dirs) {
      const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
      for (const f of walk(path.join(__dirname, '..', '..', d))) expect([f, /likely_?group/i.test(fs.readFileSync(f, 'utf8'))]).toEqual([f, false]);
    }
    for (const f of ['src/services/askToBusiness.js', 'src/services/businessFulfillment.js', 'src/screens/AskBusinessScreen.js', 'src/utils/typedAskAudit.js'.replace('typedAskAudit', 'businessOpportunityCard')]) {
      expect([f, /likely_?group/i.test(read(f))]).toEqual([f, false]);
    }
  });
});
