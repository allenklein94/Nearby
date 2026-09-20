const fs = require('fs');
const path = require('path');
const { notificationTier, RECOMMENDATION_TYPES_FOR_TEST } = require('./notificationTier');

// Reads notifications.js's own real routeNotificationTap() switch cases
// directly from source, rather than hand-maintaining a second copy of the
// vocabulary in this test -- so this test actually catches drift (a new
// push type added to that switch with no matching tier classification, or
// a stale classified type no switch case still handles) instead of just
// re-asserting whatever the classifier itself already claims.
function realNotificationTypes() {
  const source = fs.readFileSync(
    path.join(__dirname, '../services/notifications.js'),
    'utf8'
  );
  const matches = [...source.matchAll(/case '([a-z_]+)':/g)];
  return matches.map((m) => m[1]);
}

describe('notificationTier', () => {
  it('classifies every real push type notifications.js actually routes', () => {
    const types = realNotificationTypes();
    expect(types.length).toBeGreaterThan(30);
    for (const type of types) {
      expect(['important', 'recommendation']).toContain(notificationTier(type));
    }
  });

  it('classifies relationship/contextual examples as important', () => {
    expect(notificationTier('birthday_upcoming')).toBe('important');
    expect(notificationTier('occasion_upcoming')).toBe('important');
    expect(notificationTier('message')).toBe('important');
    expect(notificationTier('plan_confirmed')).toBe('important');
    expect(notificationTier('occasion_group_plan_invite')).toBe('important');
  });

  it('classifies discovery examples as recommendation', () => {
    expect(notificationTier('recommended_gathering')).toBe('recommendation');
    expect(notificationTier('recommended_business_availability')).toBe('recommendation');
    expect(notificationTier('aggregated_demand_growing')).toBe('recommendation');
  });

  it('defaults an unrecognized/future type to important, never silently muted', () => {
    expect(notificationTier('some_brand_new_push_type')).toBe('important');
  });

  it('has no stale recommendation-tier entry for a type notifications.js no longer routes', () => {
    const realTypes = new Set(realNotificationTypes());
    for (const type of RECOMMENDATION_TYPES_FOR_TEST) {
      expect(realTypes.has(type)).toBe(true);
    }
  });
});

describe('a business response completes the loop the person started (item 68)', () => {
  it('business_offer_received is an important (loud) push and taps route to the request', () => {
    const { notificationTier } = require('./notificationTier');
    expect(notificationTier('business_offer_received')).toBe('important');
    expect(require('fs').readFileSync('src/services/notifications.js', 'utf8')).toMatch(/case 'business_offer_received':/);
  });
});
