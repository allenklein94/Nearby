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
  it('every listed setting is backed by a real column', () => {
    const svc = fs.readFileSync(path.join(__dirname, '../services/gatherings.js'), 'utf8');
    const m2 = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270170_host_gathering_settings.sql'), 'utf8');
    expect(edit).toMatch(/Allow guests to invite/);
    expect(edit).toMatch(/Notify me about joins and requests/);
    expect(m2).toMatch(/add column if not exists host_notifications/);
    expect(m2).toMatch(/add column if not exists allow_attendee_invites/);
    expect(svc).toMatch(/host_notifications, allow_attendee_invites/);
    // enforced server-side on BOTH invite paths, not just hidden in the UI
    expect(m2.match(/turned off invitations/g).length).toBeGreaterThanOrEqual(2);
  });
});

describe('the Create wizard centralizes the same settings (item 73)', () => {
  const create = fs.readFileSync(path.join(__dirname, '../screens/CreateGatheringScreen.js'), 'utf8');
  const settings = create.slice(create.indexOf("stepKey === 'settings' && ("), create.indexOf("stepKey === 'publish' && ("));
  const details = create.slice(create.indexOf("stepKey === 'details' && ("), create.indexOf("stepKey === 'settings' && ("));
  it('has one Settings step after Details and no separate Who step', () => {
    expect(create).toMatch(/key: 'settings', label: 'Settings'/);
    expect(create).not.toMatch(/key: 'who'/);
    expect(create.indexOf("key: 'details'")).toBeLessThan(create.indexOf("key: 'settings'"));
  });
  it.each(['Visibility', 'How can people find it?', 'Who can join it?', 'Capacity', 'Business requests', 'Women-Only', 'Allow guests to invite', 'Notify me about joins and requests'])('Settings holds %s', (t) => {
    expect(settings).toContain(t);
  });
  it('More options no longer scatters those controls', () => {
    ['How many people?', 'Ask Local Businesses', 'Women-Only', 'Map Visibility'].forEach((t) => expect(details).not.toContain(t));
  });
  it('the new settings reach the insert', () => {
    expect(create).toMatch(/allowAttendeeInvites,\s*hostNotifications,/);
    expect(fs.readFileSync(path.join(__dirname, '../services/gatherings.js'), 'utf8')).toMatch(/allow_attendee_invites: allowAttendeeInvites/);
  });
});
