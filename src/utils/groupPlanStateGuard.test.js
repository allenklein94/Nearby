// Item 87: GroupPlanScreen decides what a person can DO through the lifecycle table, not raw status comparisons.
const fs = require('fs');
const path = require('path');
const { canDo } = require('./objectLifecycle');

const src = fs.readFileSync(path.join(__dirname, '../screens/GroupPlanScreen.js'), 'utf8');
// the screen's wording lives in the groupPlan ui namespace (localization pass 5)
const wording = JSON.stringify(require('../i18n/ui/groupPlan').default.en);

describe('GroupPlanScreen reads state through canDo', () => {
  test('no action gate compares proposal.status or the caller participant status directly', () => {
    // display-only labels (statusLine copy) are the state's name, not a decision, so they are allowed.
    const gates = src.split('\n').filter((l) => /(\{|&&|\|\|)\s*!?\(?\s*(proposal\.status|myParticipant\??\.status)\s*(===|!==)/.test(l) && !/^\s*\{proposal\.status === '(pending|confirmed|cancelled|expired)' && (t\('ui\.groupPlan\.|')/.test(l));
    expect(gates).toEqual([]);
  });
  test('the confirmed offers block, confirm-offer, social offer and Leave are lifecycle capabilities', () => {
    for (const cap of ["'offers'", "'confirm_offer'", "'social_offer'", "'leave'"]) expect(src).toContain(cap);
  });
  test('leaving a confirmed plan warns that only the leaver\'s confirmations are removed', () => {
    expect(wording).toMatch(/offers you've confirmed will be removed/);
    expect(wording).toMatch(/Everyone else's confirmations stay/);
    expect(src).toMatch(/ui\.groupPlan\.leaveThisPlanTheOffers/);
  });
  test('a confirmed plan still lets an accepted participant leave; a left/declined one cannot', () => {
    expect(canDo('group_plan', 'confirmed', 'leave')).toBe(true);
    expect(canDo('group_participant', 'accepted', 'leave')).toBe(true);
    expect(canDo('group_participant', 'left', 'leave')).toBe(false);
    expect(canDo('group_plan', 'cancelled', 'leave')).toBe(false);
  });
});
