// Owner 2026-11-27: "Italian dinner tomorrow for four" keeps Dinner / Italian / Tomorrow / 4 (no time) as separate facts
// from the words into Create and Ask Nearby Businesses, and the understood chip names both.
jest.mock('../services/intentOutcomes', () => ({ recordIntentSelection: jest.fn() }));
jest.mock('expo-location', () => ({}));
jest.mock('../services/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() }, functionUrl: jest.fn() }));
import { createFromAsk } from '../services/createAssistant';
import { askBusinessParamsFromAsk } from '../services/askToBusiness';
import { understoodPieces, removeUnderstoodPiece } from './askUnderstood';
import { resolveAsk, toClassification } from './askResolver';

const TEXT = 'italian dinner tomorrow for 4';

test('the words alone (AI off) give category + cuisine + day + party, no time', () => {
  const r = resolveAsk(TEXT, null);
  expect(r.cuisine).toBe('italian');
  expect(r.group.partySize).toBe(4);
  expect(r.time.dateWindow).toBe('tomorrow');
  expect(r.clockWindow).toBeNull();
  const c = toClassification(r);
  expect(c.category).toBe('Restaurants');
  expect(c.cuisine).toBe('italian');
});

test('Create and AskBusiness receive the cuisine beside the other facts; nothing invents a time', () => {
  const r = resolveAsk(TEXT, null);
  const c = toClassification(r);
  const create = createFromAsk(r, TEXT, c);
  expect(create.quickStartCuisine).toBe('italian');
  expect(create.quickStartCategory).toBe('Restaurants');
  const ask = askBusinessParamsFromAsk({ classifyResult: c, typedText: TEXT });
  expect(ask.prefillCuisine).toBe('italian');
  expect(ask.prefillStartMinutes ?? null).toBeNull();
  const nr = resolveAsk('coffee tomorrow', null);
  expect(createFromAsk(nr, 'coffee tomorrow', toClassification(nr)).quickStartCuisine).toBeUndefined();
  expect(askBusinessParamsFromAsk({ classifyResult: toClassification(nr), typedText: 'coffee tomorrow' }).prefillCuisine).toBeNull();
});

test('one WHAT chip carries the cuisine and removing WHAT removes both', () => {
  const r = { category: 'Foodie', cuisine: 'italian' };
  const what = understoodPieces(r, TEXT).find((p) => p.key === 'what');
  expect(what).toEqual({ key: 'what', category: 'Foodie', cuisine: 'italian' });
  const cleared = removeUnderstoodPiece(r, 'what');
  expect(cleared.category).toBeNull();
  expect(cleared.cuisine).toBeNull();
});

test('a removed WHAT chip never reaches Create or AskBusiness', () => {
  const r = resolveAsk(TEXT, null);
  const c = { ...removeUnderstoodPiece(toClassification(r), 'what'), removedUnderstood: ['what'] };
  expect(createFromAsk(r, TEXT, c).quickStartCuisine).toBeUndefined();
  expect(askBusinessParamsFromAsk({ classifyResult: c, typedText: TEXT }).prefillCuisine).toBeNull();
});
