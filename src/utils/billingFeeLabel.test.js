// Item 37 (owner, 2026-10-08): the billing estimate is the platform FEE the business owes Nearby (a hybrid plan's fixed
// monthly fee shows even with 0 redemptions), never performance, revenue, earnings or potential. Its label must say so.
const fs = require('fs');
const path = require('path');

const strings = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/i18n/strings/bizDash2.json'), 'utf8'));
const FEE = { en: /fee/i, es: /tarifa/i, de: /Gebühr/, fr: /frais/i, pt: /taxa/i, ht: /Frè/, zh: /费用/, vi: /Phí/, tl: /bayad/i, ru: /плата/i, ko: /이용료/ };
const MONEY_IN = /revenue|earn|income|profit|potential|ingres|ganancia|Einnahm|Umsatz|revenu|receita|lucro|收入|收益|doanh thu|kita|выручк|доход|매출|수익/i;

test('the billing estimate is labelled as the Nearby fee in all 11 languages, never as revenue or potential', () => {
  expect(Object.keys(strings)).toHaveLength(11);
  for (const [lang, v] of Object.entries(strings)) {
    const label = v.estimatedThisMonth;
    expect({ lang, label, fee: FEE[lang].test(label), moneyIn: MONEY_IN.test(label) }).toEqual({ lang, label, fee: true, moneyIn: false });
  }
});

test('the fee amount is the server estimate, not forced to $0 when nothing was redeemed', () => {
  const src = fs.readFileSync(path.join(__dirname, '../screens/BusinessDashboardScreen.js'), 'utf8');
  expect(src).toMatch(/t\('ui\.bizDash2\.estimatedThisMonth'\)[\s\S]{0,200}offerPriceLabel\(estimatedOwed\.estimatedAmount\)/);
});
