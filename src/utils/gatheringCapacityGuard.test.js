const fs = require('fs');
const path = require('path');
const mig = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270169_host_set_gathering_capacity.sql'), 'utf8');
const edit = fs.readFileSync(path.join(__dirname, '../screens/EditGatheringScreen.js'), 'utf8');
const { joinLabel } = require('./gatheringJoinMode');

describe('capacity rules (item 71)', () => {
  it('a full gathering offers the waitlist, never a plain join', () => {
    expect(joinLabel({ is_public: true }, { isFull: true })).toBe('Join Waitlist');
    expect(joinLabel({ is_public: false }, { isFull: true })).toBe('Join Waitlist');
  });
  it('only the host changes capacity, only before the event, never below current attendance', () => {
    expect(mig).toMatch(/Only the host can do this/);
    expect(mig).toMatch(/already happened/);
    expect(mig).toMatch(/already attending/);
  });
  it('freed room goes through the one waitlist-promotion helper', () => {
    expect(mig).toMatch(/_promote_from_waitlist/);
  });
  it('the edit screen exposes the limit', () => {
    expect(edit).toMatch(/setGatheringCapacity/);
    expect(edit).toMatch(/Limit attendees/);
  });
});

describe('host controls are centralized (item 73)', () => {
  it('the edit screen has one "Gathering settings" section holding the controls in order', () => {
    const i = edit.indexOf('Gathering settings');
    expect(i).toBeGreaterThan(-1);
    const after = edit.slice(i);
    const order = ['Visibility:', 'Require approval to join', 'Limit attendees', 'Allow business requests'].map((t) => after.indexOf(t));
    order.forEach((n) => expect(n).toBeGreaterThan(-1));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('does not invent settings that have no data behind them', () => {
    expect(edit).not.toMatch(/Allow guests to invite/);
  });
});
