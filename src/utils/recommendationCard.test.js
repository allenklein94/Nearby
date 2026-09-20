const fs = require('fs');
const path = require('path');
const { gatheringCardModel, CARD_FIELD_ORDER } = require('./recommendationCard');

const g = { id: 'g1', title: 'Coffee gathering', interest_tag: 'Coffee', matchesYourInterests: true, distanceMiles: 1.2, scheduled_at: new Date(Date.now() + 3600e3).toISOString(), host_id: 'h', attendees: [] };

describe('gatheringCardModel', () => {
  it('answers what / why / meta / action in the fixed order', () => {
    const m = gatheringCardModel(g, { myUserId: 'me' });
    expect(m.what).toBe('Coffee gathering');
    expect(m.why).toBe('Because you like Coffee');
    expect(m.meta).toMatch(/^1\.2 mi · /);
    expect(m.social).toBeNull();
    expect(m.action.kind).toBeDefined();
    expect(m.fields).toEqual(CARD_FIELD_ORDER.filter((f) => f !== 'social'));
  });
  it('splits social proof (friend going/hosting) from the WHY reasons', () => {
    const m = gatheringCardModel(g, { signals: [
      { kind: 'interest', text: 'Because you like Coffee' },
      { kind: 'trending', text: 'Trending nearby' },
      { kind: 'going', text: 'Sam is going' },
    ] });
    expect(m.why).toBe('Because you like Coffee · Trending nearby');
    expect(m.social).toBe('Sam is going');
    expect(m.fields).toContain('social');
  });
  it('omits fields with no real data (no distance, no reason)', () => {
    const m = gatheringCardModel({ id: 'g2', title: 'Walk' }, {});
    expect(m.why).toBeNull();
    expect(m.meta).toBeNull();
    expect(m.fields).toEqual(['what', 'action']);
  });
  it('a null gathering has no fields', () => {
    expect(gatheringCardModel(null).fields).toEqual([]);
  });
  it('never uses private Interested state as social proof', () => {
    const src = fs.readFileSync(path.join(__dirname, 'recommendationCard.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(src).not.toMatch(/gathering_interested|interestedIds|is interested/);
  });
  it('Home merged cards render from the model', () => {
    const home = fs.readFileSync(path.join(__dirname, '..', 'screens', 'HomeScreen.js'), 'utf8');
    expect(home).toMatch(/gatheringCardModel\(g, \{ signals \}\)/);
    expect(home).toMatch(/card\.social/);
  });
});
