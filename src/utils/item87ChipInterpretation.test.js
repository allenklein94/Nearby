// Item 87 (owner, 2026-10-15): the understood chips of an ask, checked piece by piece against the REAL resolver, and the ONE
// counting rule (LOCKED, Option 1): the People chip is the TOTAL headcount including the person. A count of people ("4 people",
// "4 of us", "party of 4", "table for 4") is already the total; a count of companions ("with 4 friends", "me and 3 friends") adds
// the person. The same total reaches Create and Ask a Business. Correction stays remove-only.
jest.mock('../services/intentOutcomes', () => ({ recordIntentSelection: jest.fn() }));
import { partySizeFromText } from './gatheringInference';
import { tagsForPhrase } from '../constants/categorySynonyms';
import { resolveAsk, toClassification, createParamsFromAsk } from './askResolver';
import { understoodPieces, removeUnderstoodPiece } from './askUnderstood';
import { askBusinessParamsFromAsk } from '../services/askToBusiness';

const classify = (t) => toClassification(resolveAsk(t));
const piece = (c, t, k) => understoodPieces(c, t).find((p) => p.key === k) ?? null;

describe('the counting rule: total people including you', () => {
  test.each([
    ['coffee tonight with 4 friends', 5],
    ['coffee tonight, me and 3 friends', 4],
    ['coffee tonight for 4 people', 4],
    ['coffee tonight, 4 of us', 4],
    ['coffee tonight, party of 4', 4],
    ['coffee tonight, table for 4', 4],
  ])('"%s" -> %i people on the chip, in Create and in Ask a Business', (t, n) => {
    expect(partySizeFromText(t)).toBe(n);
    const c = classify(t);
    expect(piece(c, t, 'people')).toEqual({ key: 'people', count: n });
    expect(createParamsFromAsk(c.structured, t, c).quickStartPartySize).toBe(n);
    expect(askBusinessParamsFromAsk({ classifyResult: c, typedText: t }).prefillPartySize).toBe(n);
  });
});

describe("the owner's three examples, each piece checked on its own", () => {
  test.each([
    ['Coffee outside tonight for 4 people.', 4],
    ['Grab coffee outside tonight, 4 of us.', 4],
    ['Coffee outdoors tonight with 4 friends.', 5],
  ])('%s', (t, n) => {
    const c = classify(t);
    expect(piece(c, t, 'what')).toMatchObject({ category: 'Coffee' });
    expect(piece(c, t, 'when')).toMatchObject({ window: 'tonight' });
    expect(piece(c, t, 'where')).toMatchObject({ environment: 'outdoor' });
    expect(piece(c, t, 'people')).toEqual({ key: 'people', count: n });
    expect(understoodPieces(c, t).map((p) => p.key).sort()).toEqual(['people', 'what', 'when', 'where']);
  });

  test('removing People keeps it removed (Create and Ask a Business carry no count) and leaves the other pieces', () => {
    const t = 'Coffee outdoors tonight with 4 friends.';
    const c = removeUnderstoodPiece(classify(t), 'people');
    expect(piece(c, t, 'people')).toBeNull();
    expect(understoodPieces(c, t).map((p) => p.key).sort()).toEqual(['what', 'when', 'where']);
    expect(createParamsFromAsk(c.structured, t, c).quickStartPartySize).toBeNull();
    expect(askBusinessParamsFromAsk({ classifyResult: c, typedText: t }).prefillPartySize).toBeNull();
  });
});

describe('"outdoors" is the setting, the activity only when nothing else is named', () => {
  test.each([
    ['coffee outdoors', 'Coffee'],
    ['hike outdoors', 'Hiking'],
    ['outdoor yoga', 'Yoga'],
    ['dinner outdoors', 'Restaurants'],
    ['outdoors', 'Outdoors'],
    ['something outdoors', 'Outdoors'],
    ['be outdoors', 'Outdoors'],
    ['find a class', 'Classes'],
    ['yoga class', 'Yoga'],
  ])('%s -> %s', (t, tag) => expect(tagsForPhrase(t)).toEqual([tag]));
});
