// Business phone + website rules (migration 20270423). The SAME cases run through the server's functions in journey
// `businessContactDetails` (CONTACT_CASES is shared), so the form and the database can't drift apart.
const fs = require('fs');
const path = require('path');
const { normalizeBusinessPhone, normalizeBusinessWebsite, contactDetailsProblem, contactDetailsRefusal } = require('./businessContactDetails');
const { CONTACT_CASES } = require('./businessContactDetails.cases');

describe('business phone', () => {
  for (const [input, want] of CONTACT_CASES.phone) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(want)}`, () => expect(normalizeBusinessPhone(input)).toBe(want));
  }
});

describe('business website', () => {
  for (const [input, want] of CONTACT_CASES.website) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(want)}`, () => expect(normalizeBusinessWebsite(input)).toBe(want));
  }
});

describe('form problems', () => {
  it('empty fields clear, never a problem', () => {
    expect(contactDetailsProblem({ phone: '', website: '  ' })).toBeNull();
    expect(contactDetailsProblem({ phone: null, website: undefined })).toBeNull();
  });
  it('names the first bad field', () => {
    expect(contactDetailsProblem({ phone: 'call me', website: 'x' })).toBe('phone');
    expect(contactDetailsProblem({ phone: '561 555 0100', website: 'not a site' })).toBe('website');
  });
  it('server hints map to the same problems; others are not form problems', () => {
    expect(contactDetailsRefusal({ hint: 'invalid_phone' })).toBe('phone');
    expect(contactDetailsRefusal({ hint: 'invalid_website' })).toBe('website');
    expect(contactDetailsRefusal({ hint: 'not_business_manager' })).toBeNull();
    expect(contactDetailsRefusal(null)).toBeNull();
  });
});

describe('privacy wiring', () => {
  const root = path.join(__dirname, '..', '..');
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20270423_business_contact_details.sql'), 'utf8');
  it('the details never go on brand_partners and the table has no client grant', () => {
    expect(migration).not.toMatch(/alter table (public\.)?brand_partners/i);
    expect(migration).toMatch(/create table private\.business_contact_details/);
    expect(migration).toMatch(/revoke all on private\.business_contact_details from public, anon, authenticated/);
    expect(migration).not.toMatch(/grant [a-z, ]+ on private\.business_contact_details to (anon|authenticated)/i);
  });
  it('only the business dashboard section and its service read them', () => {
    const hits = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (/\.js$/.test(f) && !/\.test\.js$|\.journey\.js$|\.compat\.js$/.test(f)) {
          const src = fs.readFileSync(full, 'utf8');
          if (/get_business_contact_details|getBusinessContactDetails/.test(src)) hits.push(path.relative(root, full));
        }
      }
    };
    walk(path.join(root, 'src'));
    expect(hits.sort()).toEqual(['src/components/BusinessContactDetails.js', 'src/services/brandOffers.js']);
  });
});
