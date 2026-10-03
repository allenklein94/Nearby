// Item 149 (owner, LOCKED): opportunity cards may show "Potential value" = what the opportunity could be worth if it
// converts. Not revenue, never earnings; request data only; informational only.
const fs = require('fs');
const path = require('path');
import { potentialValue, buildOpportunityCard } from './businessOpportunityCard';

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', '__fixtures__'].includes(e.name)) walk(rel, out); }
    else if (/\.(js|ts|sql)$/.test(e.name) && !/\.test\.js$|\.journey\.js$/.test(e.name)) out.push(rel);
  }
  return out;
}
const SOURCES = [...walk('src'), ...walk('supabase')];

describe('1. valid request data -> value shown', () => {
  test('party size x the per-person budget the customer stated', () => {
    const v = potentialValue({ party_size: 4, budget_max: 10 });
    expect(v.amount).toBe(40);
    expect(v.line).toBe('Potential value: up to $40');
    expect(v.basis).toBe('4 people × their budget of $10 per person');
    expect(v.note).toBe('What this could be worth, not money earned.');
  });
  test('the card carries it and says the party total once', () => {
    const card = buildOpportunityCard({ party_size: 6, budget_max: 60 }, {});
    expect(card.potential.line).toBe('Potential value: up to $360');
    expect(card.feelLine).not.toContain('for the party');
  });
});

describe('2. insufficient data -> no invented value', () => {
  test.each([
    [{ party_size: 4 }],
    [{ budget_max: 30 }],
    [{ party_size: 0, budget_max: 30 }],
    [{ party_size: 2.5, budget_max: 30 }],
    [{ party_size: 4, budget_max: 0 }],
    [{ party_size: 4, budget_max: -5 }],
    [{ party_size: 4, price_level: '$$' }],
    [null],
  ])('%j -> null', (req) => {
    expect(potentialValue(req)).toBeNull();
  });
  test("never from the business's general pricing (typical spend, minimum spend, price tier)", () => {
    const src = read('src/utils/businessOpportunityCard.js');
    const fn = src.slice(src.indexOf('export function potentialValue'), src.indexOf('// "Why this matches"'));
    expect(fn).not.toMatch(/typical|min_spend|price_level|selectedPartner/);
    expect(potentialValue.length).toBe(1);
  });
});

describe('3. potential value is never called earnings or revenue', () => {
  test('the English wording is "Potential value", with no earnings words', () => {
    const en = JSON.parse(read('scripts/i18n/strings/bizHelp.json')).en;
    const keys = Object.keys(en).filter((k) => k.startsWith('opportunity.potential'));
    expect(keys.length).toBeGreaterThan(0);
    keys.forEach((k) => expect(en[k]).not.toMatch(/earning|revenue|income|profit|projected|expected/i));
    expect(en['opportunity.potentialValueUpTo']).toMatch(/^Potential value/);
  });
  test('the locked-out phrases appear nowhere in the app or business copy', () => {
    const banned = /estimated earnings|expected revenue|projected earnings/i;
    const files = [...SOURCES.filter((f) => f.startsWith('src')), ...fs.readdirSync(path.join(ROOT, 'scripts/i18n/strings')).map((f) => `scripts/i18n/strings/${f}`)];
    expect(files.filter((f) => banned.test(read(f)))).toEqual([]);
  });
  test('every language has the potential-value strings', () => {
    const all = JSON.parse(read('scripts/i18n/strings/bizHelp.json'));
    for (const strings of Object.values(all)) {
      ['opportunity.potentialValueUpTo', 'opportunity.potentialBasisBudget', 'opportunity.potentialNote'].forEach((k) => expect(strings[k]).toBeTruthy());
    }
  });
});

describe('4. potential value does not enter ranking, routing, eligibility, offer selection or sponsored placement', () => {
  test('only the card builder and the dashboard render read it; no server code mentions it', () => {
    const users = SOURCES.filter((f) => !f.startsWith('src/i18n/ui/') && /potentialValue|potential_value|\.potential\b/.test(read(f)));
    expect(users.sort()).toEqual(['src/screens/BusinessDashboardScreen.js', 'src/utils/businessOpportunityCard.js'].sort());
  });
  test('in the dashboard it is only rendered, on a card the business can still answer', () => {
    const src = read('src/screens/BusinessDashboardScreen.js');
    const uses = src.match(/[^\n]*\.potential\b[^\n]*/g);
    uses.forEach((line) => expect(line).toMatch(/<Text|&& \(|\{ctx\.potential &&|card\.potential &&/));
    expect(src).toMatch(/oppAction\.kind === 'send_offer' && card\.potential/);
    expect(src).not.toMatch(/sort\([^)]*potential|potential[^\n]*sort\(/);
  });
});

describe('5. financial metrics stay on realized transactions', () => {
  test('billing, invoices, offer value and the Home brief never read potential value', () => {
    ['src/utils/dashboardGlance.js', 'src/utils/billingBreakdown.js', 'src/utils/invoiceDisplay.js', 'src/utils/businessPipeline.js']
      .forEach((f) => expect(read(f)).not.toMatch(/potential/i));
  });
  test('the dashboard fills its money figures from the server records', () => {
    const src = read('src/screens/BusinessDashboardScreen.js');
    expect(src).toMatch(/getPartnerOfferValue\(partnerId\)\.then\(setOfferValue\)/);
    expect(src).not.toMatch(/set(OfferValue|EstimatedOwed)\([^)]*potential/);
  });
  test('the redeemed-offer value counts only completed offers', () => {
    const migs = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).sort();
    const latest = migs.filter((m) => /function\s+(public\.)?get_partner_offer_value\s*\(/i.test(read(`supabase/migrations/${m}`))).pop();
    expect(latest).toBeTruthy();
    expect(read(`supabase/migrations/${latest}`)).toMatch(/status\s*=\s*'completed'/);
  });
});
