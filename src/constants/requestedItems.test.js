const fs = require('fs');
const path = require('path');
const { REQUESTED_ITEM_OPTIONS, REQUESTED_ITEM_CATEGORIES } = require('./businessAttributes');
const { buildOpportunityCard } = require('../utils/businessOpportunityCard');

const mig = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270167_request_requested_items.sql'), 'utf8');
const keys = REQUESTED_ITEM_OPTIONS.map((o) => o.key).sort();

describe('requested items (item 69)', () => {
  it('client list equals the DB CHECK and the RPC validation', () => {
    const lists = [...mig.matchAll(/array\[([^\]]*)\]::text\[\]/g)].map((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort());
    const mine = lists.filter((l) => l.includes('pastries'));
    expect(mine.length).toBeGreaterThanOrEqual(2);
    mine.forEach((l) => expect(l).toEqual(keys));
  });
  it('is offered only on food and coffee asks', () => {
    expect(REQUESTED_ITEM_CATEGORIES).toEqual(['Coffee', 'Foodie']);
  });
  it('the card says "Coffee + Pastries" from the picked items, nothing when none', () => {
    expect(buildOpportunityCard({ party_size: 4 }, { itemLabels: ['Coffee', 'Pastries'] }).requestedLine).toBe('Coffee + Pastries');
    expect(buildOpportunityCard({ party_size: 4 }, {}).requestedLine).toBe('');
  });
  it('never reaches a summary, a push body or the requester identity', () => {
    expect(mig).not.toMatch(/function public\.business_safe_request_summary/i);
    expect(mig).not.toMatch(/'requested_items'[^\n]*(display_name|requester_id)/);
    expect(mig).not.toMatch(/http_post[^;]*requested_items/);
  });
});
