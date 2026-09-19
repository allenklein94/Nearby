const fs = require('fs');
const path = require('path');
const { BUSINESS_ATTRIBUTE_OPTIONS } = require('./businessAttributes');
const { extractAttributesFromText } = require('./businessAttributeExtraction');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const keys = BUSINESS_ATTRIBUTE_OPTIONS.map((o) => o.key).sort();
const quoted = (s) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

describe('business attribute vocabulary (one list, everywhere it is enforced)', () => {
  it('includes private dining and corporate events with labels', () => {
    expect(BUSINESS_ATTRIBUTE_OPTIONS.find((o) => o.key === 'private_dining')?.label).toBe('Private Dining');
    expect(BUSINESS_ATTRIBUTE_OPTIONS.find((o) => o.key === 'corporate_events')?.label).toBe('Corporate Events');
  });
  it('every DB constraint in the widening migration lists exactly the client keys', () => {
    const mig = read('supabase/migrations/20261229_private_dining_corporate_events_attributes.sql');
    const lists = [...mig.matchAll(/check \(\w+ <@ array\[([^\]]*)\]/g)].map((m) => quoted(m[1]));
    expect(lists).toHaveLength(6);
    for (const l of lists) expect(l).toEqual(keys);
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
});
