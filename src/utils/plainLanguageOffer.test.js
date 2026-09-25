const fs = require('fs');
const path = require('path');
const {
  sanitizePlainLanguageSuggestion, hasPlainLanguageSuggestion, plainLanguageDiffers, plainLanguageContext,
  claimProblem, acceptPlainLanguage, PLAIN_LANGUAGE_CLAIM_WORDS, PLAIN_LANGUAGE_TIME_WORDS, PLAIN_LANGUAGE_CLAIM_PHRASES,
} = require('./plainLanguageOffer');

const ROOT = path.join(__dirname, '..', '..');
const FN = fs.readFileSync(path.join(ROOT, 'supabase/functions/rewrite-offer-plain-language/index.ts'), 'utf8');
const SCREEN = fs.readFileSync(path.join(ROOT, 'src/screens/BusinessDashboardScreen.js'), 'utf8');
const JARGON = { title: '', description: 'Off-peak inventory optimization' };

describe('claimProblem: the suggestion may only reword what the owner said', () => {
  it('plain rewording passes', () => {
    expect(claimProblem({ description: 'A special price during our quieter hours' }, JARGON)).toBeNull();
  });
  it('an added number, price or percent is refused', () => {
    expect(claimProblem({ description: 'Get 20 off during quieter hours' }, JARGON)).toBe('number');
    expect(claimProblem({ description: 'Save on coffee, $ off' }, JARGON)).toBe('symbol');
    expect(claimProblem({ description: 'Coffee for 5' }, { description: 'Coffee for 5' })).toBeNull();
  });
  it('an added day or time is refused, one the owner wrote is kept', () => {
    expect(claimProblem({ description: 'Quieter-hours special this afternoon' }, JARGON)).toBe('time');
    expect(claimProblem({ description: 'Tonight only' }, { description: 'Special for tonight' })).toBeNull();
    expect(claimProblem({ description: 'Weekday deal' }, { description: 'Available weekdays' })).toBeNull();
  });
  it('an added claim or urgency is refused', () => {
    expect(claimProblem({ description: 'Our best coffee' }, JARGON)).toBe('claim');
    expect(claimProblem({ description: 'Guaranteed quiet table' }, JARGON)).toBe('claim');
    expect(claimProblem({ description: 'Free pastry with coffee' }, { description: 'Pastry with coffee' })).toBe('claim');
    expect(claimProblem({ description: 'For a limited time: quieter-hours special' }, JARGON)).toBe('claim');
    expect(claimProblem({ description: 'Exclusive tasting' }, { description: 'Exclusive tasting menu' })).toBeNull();
  });
  it('an empty suggestion is a problem', () => {
    expect(claimProblem({ description: '' }, JARGON)).toBe('empty');
  });
});

describe('acceptPlainLanguage: only an explicit accept writes, and only title/description', () => {
  it('returns just title + description; a null title keeps the owner title', () => {
    expect(acceptPlainLanguage({ title: null, description: 'A special price during our quieter hours' }, { title: 'Mine', description: 'Off-peak inventory optimization' }))
      .toEqual({ title: 'Mine', description: 'A special price during our quieter hours' });
  });
  it('refuses a suggestion the guard would refuse (never applied)', () => {
    expect(acceptPlainLanguage({ description: 'Best deal, 50% off' }, JARGON)).toBeNull();
  });
});

describe('client and edge function stay in lockstep', () => {
  const list = (name) => {
    const m = FN.match(new RegExp(`export const ${name} = (\\[[^\\]]*\\]);`));
    return eval(m[1]); // eslint-disable-line no-eval
  };
  it('word and phrase lists are identical', () => {
    expect(list('PLAIN_LANGUAGE_CLAIM_WORDS')).toEqual(PLAIN_LANGUAGE_CLAIM_WORDS);
    expect(list('PLAIN_LANGUAGE_TIME_WORDS')).toEqual(PLAIN_LANGUAGE_TIME_WORDS);
    expect(list('PLAIN_LANGUAGE_CLAIM_PHRASES')).toEqual(PLAIN_LANGUAGE_CLAIM_PHRASES);
  });
  it('the function writes nothing, runs the guard, and screens original + suggestion before showing', () => {
    expect(FN).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(FN).toMatch(/claimProblem\(suggestion/);
    expect(FN).toMatch(/classifyContent\(/);
    expect(FN).toMatch(/Original offer description[\s\S]*Suggested description/);
    expect(FN).toMatch(/riskTier !== 'low'/);
  });
  it('the screen only changes the form inside the explicit accept handler', () => {
    const handler = SCREEN.slice(SCREEN.indexOf('async function handlePlainLanguage'), SCREEN.indexOf('function applyPlainLanguageSuggestion'));
    expect(handler).not.toMatch(/setOffer(Title|Description)Input/);
    const apply = SCREEN.slice(SCREEN.indexOf('function applyPlainLanguageSuggestion'), SCREEN.indexOf('// One validation for both Preview and Send'));
    expect(apply).toMatch(/acceptPlainLanguage\(/);
    expect(apply).not.toMatch(/setOffer(Price|Discount|Redemption|Valid|Avail|Type|ProposedTime)/);
  });
  it('offer editor only: no other surface calls it', () => {
    const { execSync } = require('child_process');
    const hits = execSync('grep -rl "rewriteOfferPlainLanguage" src --include=*.js --exclude=*.test.js', { cwd: ROOT }).toString().trim().split('\n').sort();
    expect(hits).toEqual(['src/screens/BusinessDashboardScreen.js', 'src/services/businessFulfillment.js']);
  });
});


describe('sanitizePlainLanguageSuggestion', () => {
  it('keeps valid strings, trims whitespace, drops junk', () => {
    expect(sanitizePlainLanguageSuggestion({ title: '  Special this afternoon ', description: 'Come get a great deal on coffee' }))
      .toEqual({ title: 'Special this afternoon', description: 'Come get a great deal on coffee' });
    expect(sanitizePlainLanguageSuggestion({ title: 5, description: null })).toEqual({ title: null, description: null });
    expect(sanitizePlainLanguageSuggestion(null)).toEqual({ title: null, description: null });
  });
  it('has no price/discount/date/time/redemption field -- the shape itself cannot carry one', () => {
    const s = sanitizePlainLanguageSuggestion({ title: 'x', description: 'y', price: 999, discountPct: 90, valid_until: '9pm' });
    expect(Object.keys(s).sort()).toEqual(['description', 'title']);
  });
  it('caps length', () => {
    const s = sanitizePlainLanguageSuggestion({ description: 'a'.repeat(500) });
    expect(s.description.length).toBe(300);
  });
});

describe('hasPlainLanguageSuggestion', () => {
  it('needs a real description', () => {
    expect(hasPlainLanguageSuggestion({ description: 'x' })).toBe(true);
    expect(hasPlainLanguageSuggestion({ description: null })).toBe(false);
    expect(hasPlainLanguageSuggestion(null)).toBe(false);
  });
});

describe('plainLanguageDiffers', () => {
  it('false when the suggestion matches what the owner already has (nothing to offer)', () => {
    expect(plainLanguageDiffers({ description: 'Same text' }, { description: 'Same text' })).toBe(false);
  });
  it('true when the wording actually changed', () => {
    expect(plainLanguageDiffers({ description: 'Special this afternoon' }, { description: 'Off-peak inventory optimization' })).toBe(true);
  });
  it('no suggestion at all -> false', () => {
    expect(plainLanguageDiffers({ description: null }, { description: 'anything' })).toBe(false);
  });
});

describe('plainLanguageContext', () => {
  it('carries only booleans/labels for context, never invents a value the owner did not set', () => {
    expect(plainLanguageContext({})).toEqual({
      price: null, discountPct: null, offerType: null, proposedTime: null,
      availableFrom: null, availableUntil: null, validUntilLabel: null, redemptionInstructions: null,
    });
    expect(plainLanguageContext({ price: 5, discountPct: 20, offerType: 'discount', redemption: 'Ask staff' })).toEqual(
      expect.objectContaining({ price: 5, discountPct: 20, offerType: 'discount', redemptionInstructions: true })
    );
  });
});
