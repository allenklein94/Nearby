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
    expect(edit).toMatch(/ui\.gatheringForm\.edit\.limit'/);
  });
});

describe('host controls are centralized (item 73)', () => {
  it('the edit screen has one "Gathering settings" section holding the controls in order', () => {
    // Localization pass 5: the screen reads keys from ui.gatheringForm (English wording pinned in gatheringOptions/form tests).
    const i = edit.indexOf("ui.gatheringForm.edit.settings'");
    expect(i).toBeGreaterThan(-1);
    const after = edit.slice(i);
    const order = ['edit.visibilityLine', 'edit.approval', 'edit.limit', 'edit.allowBiz'].map((t) => after.indexOf(`ui.gatheringForm.${t}'`));
    order.forEach((n) => expect(n).toBeGreaterThan(-1));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('every listed setting is backed by a real column', () => {
    const svc = fs.readFileSync(path.join(__dirname, '../services/gatherings.js'), 'utf8');
    const m2 = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270170_host_gathering_settings.sql'), 'utf8');
    expect(edit).toMatch(/ui\.gatheringForm\.guestsInvite'/);
    expect(edit).toMatch(/ui\.gatheringForm\.notify'/);
    expect(m2).toMatch(/add column if not exists host_notifications/);
    expect(m2).toMatch(/add column if not exists allow_attendee_invites/);
    expect(svc).toMatch(/host_notifications, allow_attendee_invites/);
    // enforced server-side on BOTH invite paths, not just hidden in the UI
    expect(m2.match(/turned off invitations/g).length).toBeGreaterThanOrEqual(2);
  });
});

describe('the Create wizard centralizes the same settings (item 73, regrouped into five steps 2026-10-04)', () => {
  const create = fs.readFileSync(path.join(__dirname, '../screens/CreateGatheringScreen.js'), 'utf8');
  const who = create.slice(create.lastIndexOf("stepKey === 'who' && ("), create.indexOf("stepKey === 'publish' && finalProblems"));
  const details = create.slice(create.indexOf("stepKey === 'details' && ("), create.lastIndexOf("stepKey === 'who' && ("));
  it("Who's invited holds who can find/join it, capacity, women-only, guest invites and notifications", () => {
    ['visibility', 'findQ', 'joinQ', 'capacity', 'womenOnly', 'guestsInvite', 'notify'].forEach((k) => expect(who).toContain(`ui.gatheringForm.${k}'`));
    expect(who).not.toContain("ui.gatheringForm.businessRequests'");
  });
  it('the business-request consent is an optional extra in Details, not its own step', () => {
    expect(details).toContain("ui.gatheringForm.businessRequests'");
    expect(create).not.toMatch(/stepKey === 'business'/);
  });
  it('the new settings reach the insert', () => {
    expect(create).toMatch(/allowAttendeeInvites,\s*hostNotifications,/);
    expect(fs.readFileSync(path.join(__dirname, '../services/gatherings.js'), 'utf8')).toMatch(/allow_attendee_invites: allowAttendeeInvites/);
  });
});
