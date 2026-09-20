const fs = require('fs');
const path = require('path');
const { sanitizeCreativeSuggestions, creativeFormPatch, detectedSummary, extractedDiscountWarning, canReadCreative, hasAnySuggestion } = require('./creativeExtraction');
const { validUntilFromChoice } = require('./offerMedia');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

describe('sanitizeCreativeSuggestions', () => {
  it('keeps valid values and drops junk', () => {
    const s = sanitizeCreativeSuggestions({ product: '  Latte ', offerWording: '$5 lattes', price: '5', discountPct: 250, validity: '7 PM', redemptionInstruction: 'Show at counter' });
    expect(s).toEqual({ product: 'Latte', offerWording: '$5 lattes', price: 5, discountPct: null, validity: null, redemptionInstruction: 'Show at counter' });
  });
  it('validity is only a day hint', () => {
    expect(sanitizeCreativeSuggestions({ validity: 'today' }).validity).toBe('today');
    expect(sanitizeCreativeSuggestions({ validity: 'tomorrow' }).validity).toBe('tomorrow');
    expect(sanitizeCreativeSuggestions({ validity: '2026-09-21T19:00' }).validity).toBeNull();
  });
  it('garbage in gives no suggestion', () => {
    expect(hasAnySuggestion(sanitizeCreativeSuggestions(null))).toBe(false);
    expect(hasAnySuggestion(sanitizeCreativeSuggestions({ price: 'abc', product: 5 }))).toBe(false);
  });
});

describe('creativeFormPatch', () => {
  const s = { product: 'Latte', offerWording: '$5 lattes today', price: 5, discountPct: 20, validity: 'today', redemptionInstruction: 'Show at counter' };
  it('fills only empty fields and never overwrites the owner', () => {
    const patch = creativeFormPatch(s, { title: 'My title', description: '', price: '', discountPct: '', redemption: 'Ask staff', validDay: null, offerType: 'standard' });
    expect(patch.title).toBeUndefined();
    expect(patch.redemption).toBeUndefined();
    expect(patch.description).toBe('$5 lattes today');
    expect(patch.price).toBe('5');
    expect(patch.discountPct).toBe('20');
    expect(patch.offerType).toBe('discount');
  });
  it('maps validity to a day only (no time or date is ever produced) and respects an owner choice', () => {
    expect(creativeFormPatch(s, {}).validDay).toBe('today');
    expect(Object.keys(creativeFormPatch(s, {})).some((k) => /time|until|date/i.test(k))).toBe(false);
    expect(creativeFormPatch(s, { validDay: 'tomorrow' }).validDay).toBeUndefined();
    expect(creativeFormPatch({ validity: null }, {}).validDay).toBeUndefined();
  });
  it('a preselected day with no time is refused at send, never sent as "no end time"', () => {
    expect(validUntilFromChoice('today', null).error).toMatch(/Pick the time/);
  });
  it('does not change a non-standard offer type', () => {
    expect(creativeFormPatch(s, { offerType: 'perk' }).offerType).toBeUndefined();
  });
});

describe('summary, cap warning, platform', () => {
  it('names the business from the account, not the creative', () => {
    expect(detectedSummary({ product: 'Latte', price: 5, validity: 'today' }, 'Coastal Coffee')).toBe('We detected: Latte, $5, Valid today, Coastal Coffee');
    expect(detectedSummary({}, 'Coastal Coffee')).toBeNull();
  });
  it('an extracted discount over the cap warns exactly like a typed one', () => {
    expect(extractedDiscountWarning({ discountPct: 50 }, 30)).toMatch(/above your maximum discount of 30%/);
    expect(extractedDiscountWarning({ discountPct: 20 }, 30)).toBeNull();
    expect(extractedDiscountWarning({ discountPct: 50 }, null)).toBeNull();
  });
  it('web reads images only', () => {
    expect(canReadCreative({ type: 'image' }, 'web')).toBe(true);
    expect(canReadCreative({ type: 'video' }, 'web')).toBe(false);
    expect(canReadCreative({ type: 'video' }, 'ios')).toBe(true);
    expect(canReadCreative(null, 'ios')).toBe(false);
  });
});

describe('guards on the wiring', () => {
  const fn = read('supabase/functions/read-offer-creative/index.ts');
  const screen = read('src/screens/BusinessDashboardScreen.js');
  it('the function is read-only: no writes, no business name, no time/date in its output', () => {
    expect(fn).not.toMatch(/\.(insert|update|upsert|delete)\(|\.rpc\('(?!check_and_increment_ai_use)/);
    expect(fn).toMatch(/Do not return the business name/);
    expect(fn).toMatch(/validity: string \| null|"validity":"today"\|"tomorrow"\|null/);
    expect(fn).toMatch(/managed_partner_id/);
  });
  it('extraction runs only from the explicit tap, never in an effect', () => {
    expect(screen.match(/readOfferCreative\(/g)).toHaveLength(1);
    expect(screen).toMatch(/onPress=\{handleReadCreative\}/);
    expect(screen).not.toMatch(/useEffect\([^)]*handleReadCreative/);
  });
  it('writes into the existing redemption field and adds no new one', () => {
    expect(screen).toMatch(/setOfferRedemptionInput\(patch\.redemption\)/);
    expect(read('src/utils/creativeExtraction.js')).not.toMatch(/redemption_instructions_extracted|newRedemption/);
  });
  it('send still goes through screening with the discount cap check', () => {
    const submit = screen.slice(screen.indexOf('async function handleSubmitOffer'));
    expect(submit.indexOf('discountCapProblem')).toBeGreaterThan(-1);
    expect(submit).toMatch(/submitBusinessOfferResponseForScreening/);
  });
});
