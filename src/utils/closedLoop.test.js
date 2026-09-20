import fs from 'fs';
import path from 'path';
import { capacityForPartySize } from './gatheringStructure';
import { offerValueLines } from './offerValue';

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

describe('the closed loop, end to end (item 85)', () => {
  test('"Planning for 4?" suggests a capacity chip from a real headcount only', () => {
    expect(capacityForPartySize(4)).toMatchObject({ option: '2-4', size: 4 });
    expect(capacityForPartySize(7)).toMatchObject({ option: '5-10' });
    expect(capacityForPartySize(24)).toMatchObject({ option: '10+', custom: 24 });
    for (const bad of [1, 0, null, undefined, 'x', 2.5, 500]) expect(capacityForPartySize(bad)).toBeNull();
  });
  test('the intent hand-off carries the headcount and the screen tells the person it is a suggestion', () => {
    expect(read('../services/createAssistant.js')).toContain('quickStartPartySize: result.partySize');
    const screen = read('../screens/CreateGatheringScreen.js');
    expect(screen).toContain('Planning for {suggestedPartySize}?');
    expect(screen).toContain('Change it any time');
  });
  test('redemptions and dollars come only from real rows, and unpriced ones are said so', () => {
    expect(offerValueLines(null)).toBeNull();
    expect(offerValueLines({ month_redemptions: 0, month_value: 0, month_unpriced: 0 })).toBeNull(); // no invented "$0 generated"
    expect(offerValueLines({ month_redemptions: 1, month_value: 12, month_unpriced: 0 }).headline).toBe('1 redemption · $12 in offers redeemed');
    const mixed = offerValueLines({ month_redemptions: 3, month_value: 24, month_unpriced: 1 });
    expect(mixed.headline).toBe('3 redemptions · $24 in offers redeemed');
    expect(mixed.note).toMatch(/1 redemption had no price/);
    expect(mixed.note).toMatch(/Not a measure of what customers spent/);
    const none = offerValueLines({ month_redemptions: 2, month_value: 0, month_unpriced: 2 });
    expect(none.headline).toBe('2 redemptions');
  });
  test('the gathering tells the group who is taking care of them, and the dashboard shows the value', () => {
    expect(read('../components/AcceptedBusinessOfferCard.js')).toContain('is taking care of your group');
    expect((read('../screens/GatheringDetailScreen.js').match(/groupCare/g) || []).length).toBe(2);
    expect(read('../screens/BusinessDashboardScreen.js')).toContain("offerValueLines(offerValue, 'month')");
  });
});
