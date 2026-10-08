// Item 36 (owner, 2026-10-08): business Home = summary (Opportunities / Offers / Performance), each one tap into its
// collection; the rich opportunity card stays the entity + action (item 40, LOCKED); no request detail screen.
const fs = require('fs');
const path = require('path');
const { businessHomeTiles } = require('./businessHomeTiles');
const { businessPipeline } = require('./businessPipeline');

const NOW = new Date(2026, 9, 15, 14, 0);
const open = { status: 'open', expires_at: new Date(2026, 9, 20).toISOString() };
const row = (over) => ({ id: over.id, request_id: over.request_id ?? `r${over.id}`, status: 'pending', business_requests: open, ...over });
const OPPS = [
  row({ id: 1 }), row({ id: 2 }), row({ id: 3 }), // 3 new
  row({ id: 4, status: 'offered' }), row({ id: 5, status: 'offered' }), // 2 pending
  row({ id: 6, status: 'offered', valid_until: new Date(2026, 9, 15, 13).toISOString() }), // expired: not pending
  row({ id: 7, business_requests: { status: 'expired' } }), // closed: not new
];
const FUNNEL = { opportunities: 9, offers_sent: 4, accepted: 2, redemptions: 1 };
const tiles = (over = {}) => businessHomeTiles({ opportunities: OPPS, loaded: true, funnel: FUNNEL, value: null, now: NOW, ...over });
const byKey = (list) => Object.fromEntries(list.map((t) => [t.key, t]));

describe('the three Home tiles', () => {
  test('owner example: 3 new requests, 2 pending, this month funnel; in that order', () => {
    const list = tiles();
    expect(list.map((t) => t.key)).toEqual(['opportunities', 'offers', 'performance']);
    const t = byKey(list);
    expect(t.opportunities.line).toBe('3 new requests');
    expect(t.offers.line).toBe('2 pending');
    expect(t.performance.line).toBe('This month: 4 sent · 2 accepted · 1 redeemed');
  });
  test('counts are exactly the pipeline\'s New and Offered stages (Home and the tab never disagree)', () => {
    const subs = [{ request_id: 'r1', status: 'reviewing' }];
    const p = businessPipeline(OPPS, subs, { now: NOW });
    const t = byKey(tiles({ submissions: subs }));
    expect(t.opportunities.count).toBe(p.new);
    expect(t.offers.count).toBe(p.offered);
  });
  test('each tile opens its collection: Opportunities and Offers the Opportunities tab, Performance Offer Performance', () => {
    const t = byKey(tiles());
    expect([t.opportunities.target, t.offers.target, t.performance.target]).toEqual(['opportunities', 'opportunities', 'performance']);
  });
  test('singular wording and real zeros once loaded', () => {
    const t = byKey(tiles({ opportunities: [row({ id: 1 }), row({ id: 2, status: 'offered' })] }));
    expect(t.opportunities.line).toBe('1 new request');
    expect(t.offers.line).toBe('1 pending');
    const z = byKey(tiles({ opportunities: [] }));
    expect(z.opportunities.line).toBe('0 new requests');
    expect(z.opportunities.highlight).toBe(false);
  });
  test('nothing invented before a source loaded: no request tiles until loaded, no Performance tile without a funnel', () => {
    expect(tiles({ loaded: null }).map((t) => t.key)).toEqual(['performance']);
    expect(tiles({ loaded: false }).map((t) => t.key)).toEqual(['performance']);
    expect(tiles({ funnel: null }).map((t) => t.key)).toEqual(['opportunities', 'offers']);
  });
});

describe('Performance never claims revenue (item 205)', () => {
  test('value of offers redeemed only with a priced redemption; no $0, never "revenue"', () => {
    expect(byKey(tiles({ value: null })).performance.valueLine).toBeNull();
    expect(byKey(tiles({ value: { month_redemptions: 1, month_unpriced: 1, month_value: 0 } })).performance.valueLine).toBeNull();
    const priced = byKey(tiles({ value: { month_redemptions: 1, month_unpriced: 0, month_value: 12.5 } })).performance;
    expect(priced.valueLine).toMatch(/^Value of offers redeemed: \$12\.50$/);
    for (const t of tiles({ value: { month_redemptions: 1, month_unpriced: 0, month_value: 12.5 } })) {
      expect(JSON.stringify(t)).not.toMatch(/revenue|earn|income|profit|spent/i);
    }
  });
  test('the tile strings carry no revenue/earnings words in any language', () => {
    const strings = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/i18n/strings/bizDash1.json'), 'utf8'));
    expect(Object.keys(strings)).toHaveLength(11);
    for (const [lang, v] of Object.entries(strings)) {
      for (const k of ['tiles.opportunities', 'tiles.offers', 'tiles.performance', 'tiles.newRequests', 'tiles.pendingOffers', 'tiles.funnelLine']) {
        expect({ lang, k, present: v[k] != null }).toEqual({ lang, k, present: true });
      }
      expect({ lang, clean: !/revenue|earning|ingres|einnahm|revenu|receita|收入|doanh thu|kita|выручк|доход|매출|수익/i.test(JSON.stringify([v['tiles.performance'], v['tiles.funnelLine']])) }).toEqual({ lang, clean: true });
    }
  });
});

describe('wiring: summary -> collection -> entity -> action, no new screen', () => {
  const src = fs.readFileSync(path.join(__dirname, '../screens/BusinessDashboardScreen.js'), 'utf8');
  test('Home renders the tiles and each opens its collection', () => {
    expect(src).toMatch(/businessHomeTiles\(\{ opportunities, submissions: offerSubmissions, loaded: opportunitiesLoaded, funnel: offerFunnel, value: offerValue \}\)/);
    expect(src).toMatch(/onPress=\{\(\) => openHomeTile\(tile\.target\)\}/);
    expect(src).toMatch(/setSection\('insights'\)/); // Performance -> More tools -> Analytics (Offer Performance)
  });
  test('Home does not repeat the tiles: no "new opportunities" / "awaiting a reply" chips, no month line in the glance', () => {
    expect(src).toMatch(/glance\.today\.filter\(\(item\) => item\.key !== 'new'\)/);
    expect(src).toMatch(/glance\.upcoming\.filter\(\(item\) => item\.key !== 'awaiting'\)/);
    expect(src).not.toMatch(/glance\.month\.map/);
  });
  test('no business request detail screen or compact list mode (item 40 stands)', () => {
    const { SCREEN_REGISTRY } = require('../constants/screenRegistry');
    expect(Object.keys(SCREEN_REGISTRY).filter((k) => /^Business(Opportunity|RequestDetail)/.test(k) && k !== 'BusinessRequestDetail')).toEqual([]);
    expect(fs.existsSync(path.join(__dirname, '../screens/BusinessOpportunityDetailScreen.js'))).toBe(false);
  });
});
