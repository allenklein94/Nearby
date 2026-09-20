// The one-tap business responses must not need an AI call (works with no Anthropic credit). The edge function
// mirrors the client's fixed strings; this fails if the two drift or the bypass is loosened.
const fs = require('fs');
const path = require('path');
const { STANDARD_AVAILABILITY_TEXT, buildAlternativeText, usualTermsLine } = require('../utils/quickOfferResponse');

const src = fs.readFileSync(path.join(__dirname, '../../supabase/functions/screen-business-content/index.ts'), 'utf8');

test('edge function fixed strings equal the client constants', () => {
  expect(src).toContain(`const STANDARD_AVAILABILITY_TEXT = '${STANDARD_AVAILABILITY_TEXT}';`);
  expect(src).toContain(`const ALTERNATIVE_TIME_TEXT = "${buildAlternativeText('')}";`);
});
test('terms wording matches the client', () => {
  const t = usualTermsLine({ min_spend_per_person: 20, deposit_amount: 50, cancellation_window_hours: 24 });
  expect(t).toBe('Our usual terms: $20 per person minimum spend; $50 deposit, arranged directly with us; cancellation window: 24 hours.');
  expect(src).toContain('per person minimum spend');
  expect(src).toContain('deposit, arranged directly with us');
  expect(src).toContain('cancellation window: ');
});
test('the classifier is skipped only for exact fixed text with no owner-authored fields', () => {
  expect(src).toContain('if (!offerTitle && includedItems.length === 0 && !mediaPath) {');
  expect(src).toContain('if (fixedTexts.includes(offerDescription)) {');
});
