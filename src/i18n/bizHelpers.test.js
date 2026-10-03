// Business dashboard localization, phase 6: the helper files that compose dashboard sentences read ui.bizHelp in the owner's
// language; English stays word for word what it was.
import { setCurrentLanguage } from './translate';
import { UI_NAMESPACES } from './ui';
import { EMPTY_STATES } from '../constants/emptyStates';
import { billingBreakdownLines } from '../utils/billingBreakdown';
import { describeDemandSignals } from '../utils/demandSignals';
import { buildOpportunityCard, buildMatchReasons } from '../utils/businessOpportunityCard';
import { submissionView } from '../utils/offerSubmission';
import { statsLine } from '../utils/sponsoredPromotions';
import { discountCapProblem } from '../utils/discountCap';
import { matchFitLine } from '../utils/matchFitLine';
import { offerValueLines } from '../utils/offerValue';
import { operatingHoursProblem } from '../utils/operatingStatus';

afterEach(() => setCurrentLanguage('en'));

const owed = { billingModel: 'hybrid', redemptionCount: 3, billableCount: 3, baseFeeAmount: 20, redemptionFee: 1, redemptionAmount: 3 };
const signals = { signals: [{ kind: 'category', category: 'Coffee', people_count: 7, party_bucket: '3-4', when_day: 'friday', when_period: 'evening', unfulfilled_count: 5, supply_count: 2 }] };
const req = { party_size: 4, date: '2026-10-09', time_window_start: '19:00:00', time_window_end: '20:00:00', category: 'Coffee', budget_max: 30 };

test('English is unchanged', () => {
  expect(billingBreakdownLines(owed)).toEqual(['3 redemptions this month', 'Monthly fee $20.00 + 3 billable redemptions x $1.00 = $3.00', 'Final invoice may differ slightly']);
  const d = describeDemandSignals(signals)[0];
  expect(d.headline).toBe('Coffee for 3–4 people is being searched nearby');
  expect(d.detail).toBe('Friday evening · 7 people · last 14 days · 5 still waiting for an offer · 2 businesses offer this nearby');
  const card = buildOpportunityCard(req, {});
  expect(card.whenLine).toMatch(/^4 people · .+ · 7–8 PM$/);
  expect(card.feelLine).toBe('Up to $30/person · $$');
  expect(card.potential.line).toBe('Potential value: up to $120');
  expect(buildMatchReasons([{ key: 'offered_occasion' }], { occasion: 'birthday' })).toEqual(['You offer birthday experiences', 'You are within the area they asked for']);
  expect(submissionView({ status: 'needs_changes', matched_categories: ['weapons', 'fraud_scams'] }).detail).toBe("Your offer or its photo or video appears to involve weapons and fraud or scams, which Nearby doesn't allow. Edit your offer and send it again.");
  expect(statsLine({ status: 'active', impressions: 3, taps: 1 })).toBe('About 3 views · 1 tap · about 33% tapped');
  expect(discountCapProblem({ offerType: 'discount', pctInput: '40', cap: 30 })).toBe('This discount (40%) is above your maximum discount of 30%.');
  expect(matchFitLine({ pct_yes: 80, pct_somewhat: 20, pct_no: 0 })).toBe('How well your matches land: 80% yes · 20% somewhat');
  expect(offerValueLines({ month_redemptions: 1, month_value: 12, month_unpriced: 0 }).headline).toBe('1 redemption · $12 in offers redeemed');
  expect(operatingHoursProblem({ timezone: 'UTC', week: { sun: [] } })).toBe('Sunday: choose Closed, 24 hours, or add hours.');
});

test('German follows the language, numbers and days included', () => {
  setCurrentLanguage('de');
  expect(billingBreakdownLines(owed)[1]).toBe('Monatsgebühr $20,00 + 3 abrechenbare Einlösungen x $1,00 = $3,00');
  expect(describeDemandSignals(signals)[0].headline).toBe('In der Nähe wird nach Kaffee für 3–4 Personen gesucht');
  expect(buildOpportunityCard(req, {}).whenLine).toMatch(/^4 Personen · /);
  expect(statsLine({ status: 'active', impressions: 3, taps: 1 })).toBe('Etwa 3 Aufrufe · 1 Tipp · etwa 33% getippt');
  expect(operatingHoursProblem({ timezone: 'UTC', week: { sun: [] } })).toBe('Sonntag: wähle Geschlossen, 24 Stunden oder füge Zeiten hinzu.');
});

test('business empty states: English equals the registry, every language has both lines', () => {
  const en = UI_NAMESPACES.bizHelp.en.empty;
  for (const [id, copy] of Object.entries(en)) expect([id, copy]).toEqual([id, EMPTY_STATES[id]]);
  for (const lang of Object.keys(UI_NAMESPACES.bizHelp)) {
    for (const id of Object.keys(en)) expect([lang, id, !!UI_NAMESPACES.bizHelp[lang].empty[id]?.title, !!UI_NAMESPACES.bizHelp[lang].empty[id]?.body]).toEqual([lang, id, true, true]);
  }
});
