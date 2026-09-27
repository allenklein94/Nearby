// Item 102 (2026-09-27): an intent plus stated modifiers is read by the ONE ask resolver. Regression for two parser gaps found
// against the owner's example: spelled-out counts ("four people") and sitting outside AT a place (outdoor_seating, not an
// outdoor activity that would sink an indoor-category café).
import { resolveAsk } from './askResolver';
import { partySizeFromText } from './gatheringInference';
import { attributesFromAsk, parseAskFacets } from '../constants/askFacets';

describe('intent + modifiers (item 102)', () => {
  test("the owner's example resolves every modifier from the words alone", () => {
    const r = resolveAsk('Find me coffee for four people tonight under $20 somewhere quiet where we can sit outside', null);
    expect(r.subcategory).toBe('Coffee');
    expect(r.group.partySize).toBe(4);
    expect(r.time.dateWindow).toBe('tonight');
    expect(r.budget.budgetMax).toBe(20);
    expect(r.attributes).toEqual(expect.arrayContaining(['quiet', 'outdoor_seating']));
  });

  test('spelled-out counts read like digits; "one" and non-party numbers do not', () => {
    expect(partySizeFromText('four people')).toBe(4);
    expect(partySizeFromText('a table for six')).toBe(6);
    expect(partySizeFromText('dinner for two')).toBe(2);
    expect(partySizeFromText('me and three friends')).toBe(4);
    expect(partySizeFromText('for two hours')).toBeNull();
    expect(partySizeFromText('one more drink')).toBeNull();
    expect(partySizeFromText('someone fun')).toBeNull();
  });

  test('sitting outside at a place is the outdoor_seating attribute, not the outdoor environment', () => {
    expect(attributesFromAsk('coffee where we can sit outside')).toContain('outdoor_seating');
    expect(parseAskFacets('coffee where we can sit outside').environment).toBeNull();
    expect(attributesFromAsk('lunch with outside seating')).toContain('outdoor_seating');
    // A real outdoor activity keeps the environment.
    expect(parseAskFacets('something outside tonight').environment).toBe('outdoor');
  });

  test('negated seating is never an ask for it', () => {
    expect(attributesFromAsk("coffee, don't want to sit outside")).not.toContain('outdoor_seating');
    expect(attributesFromAsk('dinner, nothing outside')).not.toContain('outdoor_seating');
  });
});
