const fs = require('fs');
const path = require('path');
const { VIBES, VIBE_ATTRIBUTE_KEYS, NEW_VIBE_ATTRIBUTE_KEYS, vibesFromText, vibeFit, applyVibesToCandidates, vibeKeysFromAttributes, vibesOf } = require('./vibe');
const { BUSINESS_ATTRIBUTE_OPTIONS, BUSINESS_ONLY_ATTRIBUTE_KEYS } = require('./businessAttributes');
const { attributesFromAsk } = require('./askFacets');
const { extractAttributesFromText } = require('./businessAttributeExtraction');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

describe('vibe is a named view over the one attribute vocabulary', () => {
  it('names the twelve vibes the owner listed, energetic folded into lively', () => {
    expect(VIBES.map((v) => v.label)).toEqual(['Casual', 'Upscale', 'Romantic', 'Lively', 'Quiet', 'Trendy', 'Family-friendly', 'Relaxed', 'Social', 'Cozy', 'Professional']);
    expect(vibesFromText('somewhere energetic')).toEqual(['lively']);
  });
  it('every vibe points at a real attribute key; no second store', () => {
    const keys = BUSINESS_ATTRIBUTE_OPTIONS.map((o) => o.key);
    for (const a of VIBE_ATTRIBUTE_KEYS) expect(keys).toContain(a);
    expect(VIBES.find((v) => v.key === 'family_friendly').attribute).toBe('kid_friendly');
    for (const k of NEW_VIBE_ATTRIBUTE_KEYS) expect(read('supabase/migrations/20270219_vibe_attributes.sql')).toContain(`'${k}'`);
  });
  it('vibes are personal venue preferences too, never business-only', () => {
    for (const a of VIBE_ATTRIBUTE_KEYS) expect(BUSINESS_ONLY_ATTRIBUTE_KEYS).not.toContain(a);
  });
});

describe('reading a vibe from the words (deterministic)', () => {
  it('"somewhere relaxed and quiet" works', () => {
    expect(vibesFromText('I want somewhere relaxed and quiet.')).toEqual(['quiet', 'relaxed']);
    expect(attributesFromAsk('I want somewhere relaxed and quiet.')).toEqual(expect.arrayContaining(['quiet', 'relaxed']));
  });
  it('reads each vibe from ordinary phrasing', () => {
    expect(vibesFromText('a cozy spot for coffee')).toEqual(['cozy']);
    expect(vibesFromText('somewhere trendy tonight')).toEqual(['trendy']);
    expect(vibesFromText('a lively bar')).toEqual(['lively']);
    expect(vibesFromText('fancy dinner')).toEqual(['upscale']);
    expect(vibesFromText('a family-friendly brunch')).toEqual(['family_friendly']);
    expect(vibesFromText('a social place to have a drink')).toEqual(['social']);
    expect(vibesFromText('somewhere for a client meeting')).toEqual(['professional']);
    expect(vibesFromText('somewhere casual for lunch')).toEqual(['casual']);
    expect(vibesFromText('a romantic dinner')).toEqual(['romantic']);
  });
  it('negation is never a vibe; "nothing fancy" asks for casual', () => {
    expect(vibesFromText('nothing fancy')).toEqual(['casual']);
    expect(vibesFromText('not too quiet, something lively')).toEqual(['lively']);
    expect(vibesFromText("I don't want anything trendy")).toEqual([]);
    expect(vibesFromText('not high-energy please')).toEqual([]);
  });
  it('does not fire on look-alikes', () => {
    expect(vibesFromText('hip hop night')).toEqual([]);
    expect(vibesFromText('social media workshop')).toEqual([]);
    expect(vibesFromText('a casual date')).toEqual([]);
    expect(vibesFromText('casual tennis')).toEqual([]);
    expect(vibesFromText('professional development class')).toEqual([]);
    expect(vibesFromText('coffee tonight')).toEqual([]);
    expect(vibesFromText('')).toEqual([]);
    expect(vibesFromText(null)).toEqual([]);
  });
  it('maps extractor attributes back to vibes', () => {
    expect(vibeKeysFromAttributes(['kid_friendly', 'wifi', 'cozy'])).toEqual(['family_friendly', 'cozy']);
  });
});

describe('ranking: declared only, never a filter', () => {
  it('a business that declared both asked vibes beats one that declared one', () => {
    expect(vibeFit(['relaxed', 'quiet'], ['quiet', 'relaxed'])).toEqual({ delta: 3, reason: 'Quiet and relaxed' });
    expect(vibeFit(['quiet'], ['quiet', 'relaxed'])).toEqual({ delta: 2, reason: 'Quiet' });
    expect(vibeFit(['cozy'], ['cozy'])).toEqual({ delta: 2, reason: 'Cozy' });
  });
  it('a declared opposite sinks a little; undeclared is neutral', () => {
    expect(vibeFit(['lively'], ['quiet']).delta).toBe(-1);
    expect(vibeFit(['upscale'], ['casual']).delta).toBe(-1);
    expect(vibeFit(['wifi'], ['quiet']).delta).toBe(0);
    expect(vibeFit([], ['quiet']).delta).toBe(0);
    expect(vibeFit(['quiet'], []).delta).toBe(0);
  });
  it('applies to business results by their partner row, never removes, leaves gatherings and perks alone', () => {
    const items = [
      { id: 'a', type: 'business_availability', score: 5, businessPartner: { attributes: ['quiet', 'relaxed'] } },
      { id: 'b', type: 'business_availability', score: 5, businessPartner: { attributes: ['lively'] } },
      { id: 'c', type: 'business_availability', score: 5, businessPartner: { attributes: [] } },
      { id: 'g', type: 'gathering', score: 5, category: 'Coffee' },
      { id: 'p', type: 'perk', score: 5 },
    ];
    const out = applyVibesToCandidates(items, ['quiet', 'relaxed']);
    expect(out).toHaveLength(5);
    expect(out.map((c) => c.score)).toEqual([8, 4, 5, 5, 5]);
    expect(out[0].vibeReason).toBe('Quiet and relaxed');
    expect(applyVibesToCandidates(items, [])).toBe(items);
  });
  it('reads a business\'s vibes from its declared attributes only', () => {
    expect(vibesOf({ attributes: ['cozy', 'wifi'], category: 'Coffee' }).map((v) => v.key)).toEqual(['cozy']);
    expect(vibesOf({ category: 'Nightclubs' })).toEqual([]);
  });
});

describe('wiring', () => {
  it('the resolver runs the vibe pass and keeps vibes out of the generic posting overlap (no double lift)', () => {
    const src = read('src/services/intentResolver.js');
    expect(src).toMatch(/applyVibesToCandidates\(deduped, askedVibes\)/);
    expect(src).toMatch(/resolveBusinessAvailability\(category, location, overlapAttributes,/);
  });
  it('the structured ask carries vibes', () => {
    expect(read('src/utils/askResolver.js')).toMatch(/vibes: vibesFromText\(t\)/);
  });
  it('"Teach Nearby" finds the new vibes from plain text without false hits', () => {
    expect(extractAttributesFromText('A cozy, laid-back cafe with a lively patio')).toEqual(expect.arrayContaining(['cozy', 'relaxed', 'lively']));
    expect(extractAttributesFromText('Best fried chicken in town')).not.toContain('trendy');
  });
  it('the owner picks vibes in their own section on the profile editor', () => {
    const src = read('src/screens/BusinessDashboardScreen.js');
    expect(src).toMatch(/What's the vibe\?/);
    expect(src).toMatch(/!VIBE_ATTRIBUTE_KEYS\.includes\(a\.key\)/);
  });
});
