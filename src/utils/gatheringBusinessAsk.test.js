const fs = require('fs');
const path = require('path');
import { gatheringRequestText, gatheringAskFacts, gatheringAskInputs } from './gatheringBusinessAsk';

// Item 111: Create "Coffee gathering" -> Find a business carries Coffee, date, time, group size and location, and asks only
// "Anything specific you'd like the business to provide?".

const now = new Date('2026-10-01T10:00:00');
const coffee = { interest_tag: 'Coffee', scheduled_at: new Date('2026-10-02T19:00:00').toISOString(), capacity: 4, approvedCount: 1 };

describe('gatheringAskFacts', () => {
  it('carries category, when, group size and location in that order', () => {
    const facts = gatheringAskFacts(coffee, now);
    expect(facts.map((f) => f.key)).toEqual(['category', 'when', 'party', 'where']);
    expect(facts[0].label).toBe('Coffee');
    expect(facts[1].label).toMatch(/Tomorrow/);
    expect(facts[1].label).toMatch(/7 PM/);
    expect(facts[2].label).toBe('4 people'); // capacity is total people incl. the host
    expect(facts[3].label).toBe('Near your gathering');
  });

  it('group size follows real attendance when there is no capacity', () => {
    const facts = gatheringAskFacts({ ...coffee, capacity: null, approvedCount: 2 }, now);
    expect(facts.find((f) => f.key === 'party').label).toBe('3 people'); // 2 guests + the host
  });

  it('leaves out what the gathering does not have, never guesses', () => {
    const facts = gatheringAskFacts({ interest_tag: null, scheduled_at: null, capacity: null, approvedCount: 0 }, now);
    expect(facts.map((f) => f.key)).toEqual(['party', 'where']);
    expect(gatheringAskFacts(null)).toEqual([]);
  });
});

describe('gatheringAskInputs (the one question)', () => {
  it('coffee asks for items; food adds dietary; a targeted ask adds the note', () => {
    expect(gatheringAskInputs('Coffee')).toEqual(['items']);
    expect(gatheringAskInputs('Foodie')).toEqual(['items', 'dietary']);
    expect(gatheringAskInputs('Coffee', { targeted: true })).toEqual(['items', 'note']);
  });
  it('a broadcast has no free-text note (minimum-payload rule)', () => {
    expect(gatheringAskInputs('Pickleball')).toEqual([]);
    expect(gatheringAskInputs('Foodie')).not.toContain('note');
  });
});

describe('request text', () => {
  it('never uses the host title', () => {
    expect(gatheringRequestText('Coffee')).toBe('A Coffee gathering looking for a place to go');
    expect(gatheringRequestText(null)).toBe('A gathering looking for a place to go');
  });
});

describe('wiring guards', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const screen = read('screens/AskBusinessScreen.js');
  it('gathering mode asks the one question and hides the retyped fields', () => {
    // wording lives in the askBusiness ui namespace (localization pass 5); the screen reads it by key
    expect(require('../i18n/ui/askBusiness').default.en.anythingSpecificYoudLikeThe).toBe("Anything specific you'd like the business to provide?");
    expect(screen).toContain("t('ui.askBusiness.anythingSpecificYoudLikeThe')");
    expect(screen).toContain("{!gatheringId && (<>\n          <Text style={styles.label}>{t('ui.askBusiness.whatDoYouWant')}</Text>");
    expect(screen).toContain('(!gatheringId || showMoreOptions)');
    expect(screen).toMatch(/submitBusinessRequestForGathering\(\{[\s\S]*?items: showItems/);
  });
  it('the service sends items to the gathering RPC', () => {
    expect(read('services/businessFulfillment.js')).toMatch(/create_business_request_for_gathering[\s\S]*?items_param/);
  });
  it('one request-text helper for both gathering entry points', () => {
    expect(read('screens/GatheringDetailScreen.js')).toContain('gatheringRequestText(gathering.interest_tag)');
    expect(read('screens/GatheringDetailScreen.js')).not.toContain('gathering looking for a place to go`');
  });
});
