const fs = require('fs');
const path = require('path');
const { BUSINESS_ATTRIBUTE_OPTIONS, VENUE_PREFERENCE_OPTIONS } = require('./businessAttributes');
const { extractAttributesFromText } = require('./businessAttributeExtraction');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const keys = BUSINESS_ATTRIBUTE_OPTIONS.map((o) => o.key).sort();
const quoted = (s) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

describe('business attribute vocabulary (one list, everywhere it is enforced)', () => {
  it('includes private dining and corporate events with labels', () => {
    expect(BUSINESS_ATTRIBUTE_OPTIONS.find((o) => o.key === 'private_dining')?.label).toBe('Private Dining');
    expect(BUSINESS_ATTRIBUTE_OPTIONS.find((o) => o.key === 'corporate_events')?.label).toBe('Corporate Events');
  });
  it('the four cross-activity attributes exist with labels and are found from plain text', () => {
    expect(BUSINESS_ATTRIBUTE_OPTIONS.find((o) => o.key === 'wifi')?.label).toBe('Wi-Fi');
    expect(extractAttributesFromText('Free wifi and beginners welcome')).toEqual(expect.arrayContaining(['wifi', 'beginner_friendly']));
    expect(extractAttributesFromText('Reservation required, full menu')).toEqual(expect.arrayContaining(['reservation_required', 'food_available']));
    expect(extractAttributesFromText('A cozy coffee shop')).not.toContain('wifi');
  });
  it('every DB constraint in the widening migration lists exactly the client keys', () => {
    const mig = read('supabase/migrations/20270216_business_capabilities_catering_max_group.sql');
    const list = quoted(mig.match(/new_list text := \$q\$([^$]*)\$q\$/)[1]);
    expect(list).toEqual(keys);
    expect((mig.match(/<@ array\[' \|\| new_list/g) ?? []).length).toBe(6);
  });
  it('the three edge functions accept exactly the client keys', () => {
    for (const [f, re] of [
      ['create-assistant', /VALID_ATTRIBUTES = \[([^\]]*)\]/],
      ['business-onboarding-assistant', /VALID_ATTRIBUTES = \[([^\]]*)\]/],
      ['screen-business-content', /ATTRIBUTE_OPTIONS = \[([^\]]*)\]/],
    ]) {
      expect(quoted(read(`supabase/functions/${f}/index.ts`).match(re)[1])).toEqual(keys);
    }
  });
  it('"Teach Nearby" extraction finds them from plain text, and only when actually mentioned', () => {
    expect(extractAttributesFromText('We have a private dining room for parties')).toContain('private_dining');
    expect(extractAttributesFromText('Great spot for a team dinner or client dinner')).toContain('corporate_events');
    expect(extractAttributesFromText('A cozy coffee shop')).not.toContain('private_dining');
  });
  it('business-only tags stay out of every consumer dining-preference surface', () => {
    const venue = VENUE_PREFERENCE_OPTIONS.map((o) => o.key);
    expect(venue).not.toContain('private_dining');
    expect(venue).not.toContain('corporate_events');
    expect(venue).not.toContain('reservation_required');
    expect(venue).toEqual(expect.arrayContaining(['wifi', 'beginner_friendly']));
    expect(venue).toHaveLength(BUSINESS_ATTRIBUTE_OPTIONS.length - 12);
    for (const k of ['wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly', 'stroller_friendly', 'family_seating', 'kid_menu']) expect(venue).not.toContain(k);
    for (const f of ['src/components/DiningPreferencesPromptModal.js', 'src/screens/ProfileScreen.js', 'src/constants/preferencePollQuestions.js']) {
      expect(read(f)).toMatch(/VENUE_PREFERENCE_OPTIONS/);
      expect(read(f)).not.toMatch(/\bBUSINESS_ATTRIBUTE_OPTIONS\.map/);
    }
  });
});

describe('business-onboarding-assistant occasions-we-offer and party types', () => {
  const { OFFERED_OCCASION_KEYS, ACCOMMODATE_PARTY_TYPE_OPTIONS } = require('./businessAttributes');
  const src = read('supabase/functions/business-onboarding-assistant/index.ts');
  it('accepts exactly the six offerable occasions and the four party types', () => {
    expect(quoted(src.match(/VALID_OFFERED_OCCASIONS = \[([^\]]*)\]/)[1])).toEqual([...OFFERED_OCCASION_KEYS].sort());
    expect(quoted(src.match(/VALID_PARTY_TYPES = \[([^\]]*)\]/)[1])).toEqual(ACCOMMODATE_PARTY_TYPE_OPTIONS.map((o) => o.key).sort());
  });
  it('never asks the model for availability or price', () => {
    expect(src).not.toMatch(/"availability"|"priceRange"|min_spend/);
  });
});
