// Offer Performance presentation (owner, 2026-11-15): the four real month counts as equal cells, the value of offers
// redeemed apart underneath with its disclosure, the same figures + disclosure on the Home tile, and no view counts.
const fs = require('fs');
const path = require('path');
import { offerFunnelView } from './offerFunnel';
import { businessHomeTiles } from './businessHomeTiles';

const SCREEN = fs.readFileSync(path.join(__dirname, '../screens/BusinessDashboardScreen.js'), 'utf8');
const DISCLOSURE = /Not a measure of what customers spent\.$/;
const FUNNEL = { opportunities: 24, offers_sent: 12, accepted: 5, redemptions: 4 };
const PRICED = { month_redemptions: 4, month_value: 120, month_unpriced: 0 };
const perf = (funnel, value) => businessHomeTiles({ opportunities: [], loaded: true, funnel, value }).find((t) => t.key === 'performance');
const funnelBlock = () => SCREEN.slice(SCREEN.indexOf('const f = offerFunnelView(offerFunnel, offerValue);'), SCREEN.indexOf('{matchFitLine(matchFit)'));

describe('metric accuracy', () => {
  test('the four cells are exactly the server counts, in order, and nothing else', () => {
    const v = offerFunnelView(FUNNEL, PRICED);
    expect(v.stages.map((s) => [s.key, s.count])).toEqual([['opportunities', 24], ['offersSent', 12], ['accepted', 5], ['redemptions', 4]]);
  });
  test('the cells render only the stages: the value is never a fifth cell', () => {
    const block = funnelBlock();
    expect(block).toMatch(/f\.stages\.map\(/);
    expect(block).not.toMatch(/\[\.\.\.f\.stages, \.\.\.\(f\.valueRow/);
    expect(block.indexOf('styles.funnelValue')).toBeGreaterThan(block.indexOf('styles.funnelGrid'));
  });
});

describe('redemption-only value with its disclosure', () => {
  test('value only from priced redemptions; never $0 or a guess', () => {
    expect(offerFunnelView(FUNNEL, PRICED).valueRow.amount).toBe('$120');
    expect(offerFunnelView(FUNNEL, { month_redemptions: 0, month_value: 0, month_unpriced: 0 }).valueRow).toBeNull();
    expect(offerFunnelView(FUNNEL, { month_redemptions: 3, month_value: 0, month_unpriced: 3 }).valueRow).toBeNull();
    expect(offerFunnelView(FUNNEL, null).valueRow).toBeNull();
  });
  test('the disclosure is rendered inside the value block, and only with a value', () => {
    const block = funnelBlock();
    const value = block.slice(block.indexOf('{!!f.valueRow && ('));
    expect(value).toMatch(/f\.note && <Text style=\{styles\.funnelNote\}>\{f\.note\}<\/Text>/);
    expect(offerFunnelView(FUNNEL, PRICED).note).toMatch(DISCLOSURE);
  });
});

describe('Home tile and Performance agree', () => {
  test('same counts, same value, same disclosure', () => {
    const v = offerFunnelView(FUNNEL, PRICED);
    const t = perf(FUNNEL, PRICED);
    expect(t.line).toBe('This month: 12 sent · 5 accepted · 4 redeemed');
    expect(t.valueLine).toBe(`${v.valueRow.label}: ${v.valueRow.amount}`);
    expect(t.valueNote).toBe(v.note);
    expect(t.valueNote).toMatch(DISCLOSURE);
  });
  test('unpriced redemptions: the tile carries the same "had no price" note', () => {
    const value = { month_redemptions: 4, month_value: 90, month_unpriced: 1 };
    expect(perf(FUNNEL, value).valueNote).toBe(offerFunnelView(FUNNEL, value).note);
  });
  test('Home renders the disclosure under the value and reads it to screen readers', () => {
    expect(SCREEN).toMatch(/tile\.valueNote && <Text style=\{styles\.funnelNote\}>\{tile\.valueNote\}<\/Text>/);
    expect(SCREEN).toMatch(/\[tile\.title, tile\.line, tile\.valueLine, tile\.valueNote\]/);
  });
});

describe('empty states unchanged', () => {
  test('no funnel = no block and no Performance tile; no value = no value line or note', () => {
    expect(offerFunnelView(null, PRICED)).toBeNull();
    expect(perf(null, PRICED)).toBeUndefined();
    const quiet = perf({ opportunities: 0, offers_sent: 0, accepted: 0, redemptions: 0 }, null);
    expect(quiet.line).toBe('This month: 0 sent · 0 accepted · 0 redeemed');
    expect(quiet.valueLine).toBeNull();
    expect(quiet.valueNote).toBeNull();
  });
  test('the per-group list keeps its existing empty copy', () => {
    expect(SCREEN).toMatch(/offerPerformance\.length === 0 \? \(\s*<EmptyCopy id="business_offers_sent" \/>/);
  });
});

describe('responsive layout', () => {
  test('cells wrap: about a quarter wide, never narrower than 120 (2 x 2 on a phone, one row when wide)', () => {
    const style = (name) => SCREEN.match(new RegExp(`\\n  ${name}: \\{([^\\n]*)\\},`))?.[1] ?? '';
    expect(style('funnelGrid')).toMatch(/flexDirection: 'row'/);
    expect(style('funnelGrid')).toMatch(/flexWrap: 'wrap'/);
    expect(style('funnelStage')).toMatch(/flexGrow: 1/);
    expect(style('funnelStage')).toMatch(/flexBasis: '22%'/);
    expect(style('funnelStage')).toMatch(/minWidth: 120/);
  });
});

describe('no view counts (item 77: views are private behaviour signals)', () => {
  test('the dashboard never renders a viewed count', () => {
    expect(SCREEN).not.toMatch(/viewedCount|row\.viewed_count/);
    expect(SCREEN).not.toMatch(/offeredViewedAcceptedRedeemed/);
  });
  test('the per-group line has no viewed figure in any language', () => {
    const src = fs.readFileSync(path.join(__dirname, '../i18n/ui/bizDash1.js'), 'utf8');
    expect(src).not.toMatch(/\{viewedCount\}/);
    expect((src.match(/offeredAcceptedRedeemed: "/g) || []).length).toBe(11);
  });
});
