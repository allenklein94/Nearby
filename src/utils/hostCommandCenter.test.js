// Host command center (owner item 143): what the host sees about their own gathering, and what they can do from it.
const fs = require('fs');
const path = require('path');
const { hostStats, invitationStatus, invitationRows, hostBusinessLine, hostActions, INVITATION_STATUS_ORDER } = require('./hostCommandCenter');
const { translate } = require('../i18n/translate');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const detail = read('screens/GatheringDetailScreen.js');
const center = read('components/HostCommandCenter.js');
const model = read('utils/hostCommandCenter.js');

describe('stats: real figures only', () => {
  test('the owner example: 4 attending, 2 interested', () => {
    expect(hostStats({ going: 4, requests: 0, waitlisted: 0, interested: 2 })).toEqual([
      { key: 'going', value: 4 }, { key: 'interested', value: 2 },
    ]);
  });
  test('going shows even at 0; the rest only when there is something', () => {
    expect(hostStats({ going: 0, requests: 0, waitlisted: 0, interested: 0 })).toEqual([{ key: 'going', value: 0 }]);
    expect(hostStats({ going: 3, requests: 2, waitlisted: 1, interested: 5 }).map((s) => s.key)).toEqual(['going', 'requests', 'waitlisted', 'interested']);
  });
  test('an unknown figure (failed lookup) is left out, never shown as 0', () => {
    expect(hostStats({ going: null, requests: null, interested: undefined })).toEqual([]);
  });
  test('English wording', () => {
    expect(translate('en', 'ui.hostCenter.stat.going', { count: 4 })).toBe('4 attending');
    expect(translate('en', 'ui.hostCenter.stat.interested', { count: 2 })).toBe('2 interested');
    expect(translate('en', 'ui.hostCenter.stat.requests', { count: 1 })).toBe('1 request to join');
    expect(translate('en', 'ui.hostCenter.stat.requests', { count: 3 })).toBe('3 requests to join');
  });
  test('fixed: the old "Interested" stat counted pending JOIN REQUESTS; requests and Interested are now separate figures', () => {
    expect(detail).toMatch(/requests,\s*\n\s*waitlisted: g\.waitlistCount/);
    expect(detail).toMatch(/interested: g\.interestedCount \?\? null/);
    expect(detail).not.toMatch(/statInterested/);
  });
});

describe('invitations: the ones the host sent, each with one real status', () => {
  test('what they did with the gathering beats what they did with the invitation', () => {
    expect(invitationStatus({ status: 'pending' }, 'approved')).toBe('going');
    expect(invitationStatus({ status: 'declined' }, 'approved')).toBe('going');
    expect(invitationStatus({ status: 'accepted' }, 'pending')).toBe('requested');
    expect(invitationStatus({ status: 'accepted' }, 'waitlisted')).toBe('waitlisted');
  });
  test('accepting an invitation does not join: "said yes, not joined yet"', () => {
    expect(invitationStatus({ status: 'accepted' }, undefined)).toBe('accepted');
    expect(translate('en', 'ui.hostCenter.invite.accepted')).toBe('Said yes, not joined yet');
  });
  test('an unanswered invitation to a finished gathering is expired; declined stays declined', () => {
    expect(invitationStatus({ status: 'pending' }, undefined)).toBe('invited');
    expect(invitationStatus({ status: 'pending' }, undefined, { past: true })).toBe('expired');
    expect(invitationStatus({ status: 'declined' }, undefined)).toBe('declined');
    expect(invitationStatus({ status: 'something_new' }, undefined)).toBeNull();
  });
  test('owner example: Claude accepted and joined -> Going; Sam invited -> Invited (never "Interested": that is private)', () => {
    const rows = invitationRows(
      [
        { invitee_id: 's', status: 'pending', created_at: '2026-10-01T10:00:00Z', name: 'Sam' },
        { invitee_id: 'c', status: 'accepted', created_at: '2026-10-01T09:00:00Z', name: 'Claude' },
      ],
      new Map([['c', 'approved']]),
    );
    expect(rows).toEqual([
      { userId: 'c', name: 'Claude', status: 'going' },
      { userId: 's', name: 'Sam', status: 'invited' },
    ]);
  });
  test('one row per person, from their newest invitation', () => {
    const rows = invitationRows([
      { invitee_id: 'a', status: 'declined', created_at: '2026-09-01T00:00:00Z', name: 'Al' },
      { invitee_id: 'a', status: 'pending', created_at: '2026-09-05T00:00:00Z', name: 'Al' },
    ], new Map());
    expect(rows).toEqual([{ userId: 'a', name: 'Al', status: 'invited' }]);
  });
  test('ordered by status, then name; a name the host cannot read stays null (the screen says "A friend")', () => {
    const rows = invitationRows([
      { invitee_id: '1', status: 'declined', created_at: 'x', name: 'Zed' },
      { invitee_id: '2', status: 'pending', created_at: 'x', name: 'Bo' },
      { invitee_id: '3', status: 'pending', created_at: 'x', name: 'Ann' },
      { invitee_id: '4', status: 'accepted', created_at: 'x', name: null },
    ], new Map());
    expect(rows.map((r) => r.status)).toEqual(['accepted', 'invited', 'invited', 'declined']);
    expect(rows.map((r) => r.name)).toEqual([null, 'Ann', 'Bo', 'Zed']);
    expect(translate('en', 'ui.hostCenter.aFriend')).toBe('A friend');
  });
  test('every status has wording in all 11 languages', () => {
    for (const l of ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko']) {
      for (const st of INVITATION_STATUS_ORDER) expect(translate(l, `ui.hostCenter.invite.${st}`)).not.toMatch(/^ui\./);
    }
  });
  test('only the host\'s own invitations are read (attendees\' invitations are theirs)', () => {
    const svc = read('services/gatherings.js');
    const fn = svc.slice(svc.indexOf('export async function getHostSentInvitations'), svc.indexOf('export async function getHostSentInvitations') + 1200);
    expect(fn).toMatch(/\.eq\('inviter_id', myId\)/);
    expect(fn).toMatch(/\.eq\('target_id', gatheringId\)/);
  });
});

describe('Interested stays private: a count, never a person', () => {
  test('no invitation status says Interested, and the model never reads gathering_interested', () => {
    expect(INVITATION_STATUS_ORDER).not.toContain('interested');
    expect(model).not.toMatch(/gathering_interested/);
    expect(center).not.toMatch(/gathering_interested/);
  });
  test('the count carries a one-line note so the host knows why there are no names', () => {
    expect(translate('en', 'ui.hostCenter.interestedNote')).toBe('Interested is private: you see how many, never who.');
    expect(center).toMatch(/interestedNote/);
  });
});

describe('business line', () => {
  test('owner example: one offer -> "Coastal Coffee · Offer received"', () => {
    const line = hostBusinessLine({ request: { id: 'r' }, offers: { pendingCount: 2, offeredCount: 1, offeredNames: ['Coastal Coffee'] } });
    expect(line).toEqual({ state: 'offer_received', name: 'Coastal Coffee' });
    expect(translate('en', 'ui.hostCenter.biz.offerReceived', { name: line.name })).toBe('Coastal Coffee · Offer received');
  });
  test('several offers, waiting, asked; nothing asked = no line (the existing ask flows show instead)', () => {
    expect(hostBusinessLine({ request: { id: 'r' }, offers: { pendingCount: 0, offeredCount: 3 } })).toEqual({ state: 'offers_received', count: 3 });
    expect(hostBusinessLine({ request: { id: 'r' }, offers: { pendingCount: 4, offeredCount: 0 } })).toEqual({ state: 'waiting', count: 4 });
    expect(hostBusinessLine({ request: { id: 'r' }, offers: { pendingCount: 0, offeredCount: 0 } })).toEqual({ state: 'asked' });
    expect(hostBusinessLine({ request: null })).toBeNull();
    expect(translate('en', 'ui.hostCenter.biz.waiting', { count: 1 })).toBe('Waiting for 1 business to reply');
  });
  test('a business that has not replied is never named', () => {
    const svc = read('services/businessFulfillment.js');
    expect(svc).toMatch(/if \(row\.status === 'offered'\) \{\s*offeredCount \+= 1;\s*if \(row\.brand_partners\?\.name\) offeredNames\.push/);
  });
});

describe('actions', () => {
  test('owner list on an upcoming gathering: Invite, Edit, Message, Manage attendees, Cancel', () => {
    expect(hostActions({ canEdit: true, canInvite: true })).toEqual(['invite', 'edit', 'message', 'manage', 'cancel']);
  });
  test('a finished gathering keeps Message and the attendee list only', () => {
    expect(hostActions({ canEdit: false, canInvite: false })).toEqual(['message', 'manage']);
  });
  test('each action calls the handler the screen already had (no second edit/cancel/invite path)', () => {
    expect(detail).toMatch(/onInvite=\{\(\) => setInviteModalVisible\(true\)\}/);
    expect(detail).toMatch(/onEdit=\{\(\) => navigation\.navigate\('EditGathering', \{ gathering \}\)\}/);
    expect(detail).toMatch(/onMessage=\{\(\) => navigation\.navigate\('GatheringChat'/);
    expect(detail).toMatch(/onCancel=\{confirmCancelGatheringInDetail\}/);
    expect(detail).toMatch(/canEdit=\{can\('edit'\)\}/);
    expect(detail).toMatch(/canInvite=\{canInvite && viewer\.time !== 'past'\}/);
  });
  test('pending join requests always show (they need a decision); everyone else folds behind Manage attendees', () => {
    const mgr = read('components/HostAttendeeManager.js');
    expect(mgr).toMatch(/expanded \? rows : \(rows \?\? \[\]\)\.filter\(\(r\) => r\.status === 'pending'\)/);
    expect(detail).toMatch(/<HostAttendeeManager gatheringId=\{gatheringId\} onChanged=\{load\} expanded=\{attendeesExpanded\}/);
  });
});
