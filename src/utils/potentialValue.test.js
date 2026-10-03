// Item 149 (owner, LOCKED): business opportunity cards show "Potential value", never earnings/revenue.
const fs = require('fs');
const path = require('path');
import { potentialValue, buildOpportunityCard } from './businessOpportunityCard';

describe('potentialValue', () => {
  test("party size x the business's own typical spend", () => {
    const v = potentialValue({ party_size: 4 }, 10);
    expect(v).toMatchObject({ amount: 40, upTo: false, source: 'typical' });
    expect(v.line).toBe('Potential value: $40');
    expect(v.basis).toBe('4 people × your usual $10 per person');
    expect(v.note).toBe('What this could be worth, not money earned.');
  });

  test("customer budget alone is a ceiling, worded 'up to'", () => {
    const v = potentialValue({ party_size: 6, budget_max: 60 }, null);
    expect(v).toMatchObject({ amount: 360, upTo: true, source: 'budget' });
    expect(v.line).toBe('Potential value: up to $360');
    expect(v.basis).toBe('6 people × their budget of $60 per person');
  });

  test('a lower customer budget caps the typical spend', () => {
    expect(potentialValue({ party_size: 4, budget_max: 8 }, 10)).toMatchObject({ amount: 32, upTo: true, source: 'budget' });
  });

  test('a higher customer budget does not raise the typical spend', () => {
    expect(potentialValue({ party_size: 4, budget_max: 50 }, 10)).toMatchObject({ amount: 40, upTo: false, source: 'typical' });
  });

  test('nothing real = no value (never $0, never a guess)', () => {
    expect(potentialValue({ party_size: 4 }, null)).toBeNull();
    expect(potentialValue({ budget_max: 30 }, 10)).toBeNull();
    expect(potentialValue({ party_size: 0, budget_max: 30 }, 10)).toBeNull();
    expect(potentialValue({ party_size: 4, budget_max: 0 }, 0)).toBeNull();
    expect(potentialValue({ party_size: 4, price_level: '$$' }, null)).toBeNull();
    expect(potentialValue(null, 10)).toBeNull();
  });

  test('the card says the party total once: the budget line drops "for the party" when a value is shown', () => {
    const withValue = buildOpportunityCard({ party_size: 6, budget_max: 60 }, {});
    expect(withValue.potential.line).toBe('Potential value: up to $360');
    expect(withValue.feelLine).not.toContain('for the party');
    const without = buildOpportunityCard({ budget_max: 60 }, {});
    expect(without.potential).toBeNull();
  });
});

describe('potential value is never called earnings or revenue', () => {
  test('business strings for potential value avoid earnings/revenue wording', () => {
    const json = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/i18n/strings/bizHelp.json'), 'utf8'));
    for (const [lang, strings] of Object.entries(json)) {
      for (const [k, v] of Object.entries(strings)) {
        if (!k.startsWith('opportunity.potential')) continue;
        if (lang === 'en') expect(v).not.toMatch(/earning|revenue|income|profit/i);
      }
    }
    expect(json.en['opportunity.potentialValue']).toMatch(/^Potential value/);
  });

  test('the dashboard shows it only while the business can still answer', () => {
    const src = fs.readFileSync(path.join(__dirname, '../screens/BusinessDashboardScreen.js'), 'utf8');
    expect(src).toMatch(/oppAction\.kind === 'send_offer' && card\.potential/);
    expect(src).not.toMatch(/[Ee]stimated earnings/);
  });
});
