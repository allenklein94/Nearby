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
  test('pending join requests always surface (a Review row, item 144); everyone else folds behind Manage attendees', () => {
    const mgr = read('components/HostAttendeeManager.js');
    expect(mgr).toMatch(/if \(!expanded\) \{\s*if \(!review\.show\) return null;/);
    expect(detail).toMatch(/<HostAttendeeManager gatheringId=\{gatheringId\} onChanged=\{load\} expanded=\{attendeesExpanded\}/);
  });
});

// Owner item 144: host approval is visible. "3 requests to join · Review" -> each request "Name / Requested to join"
// with Approve | Decline, in place on GatheringDetail.
describe('item 144: join requests have their own Review row', () => {
  const { hostSummaryStats, pendingReview } = require('./hostCommandCenter');
  const fs = require('fs');
  const path = require('path');
  const manager = fs.readFileSync(path.join(__dirname, '..', 'components/HostAttendeeManager.js'), 'utf8');
  const center = fs.readFileSync(path.join(__dirname, '..', 'components/HostCommandCenter.js'), 'utf8');

  test('the count comes from the very pending rows the Review opens; nothing pending = no row', () => {
    const rows = [
      { id: 1, status: 'pending' }, { id: 2, status: 'approved' }, { id: 3, status: 'pending' },
      { id: 4, status: 'waitlisted' }, { id: 5, status: 'pending' },
    ];
    const r = pendingReview(rows);
    expect(r.count).toBe(3);
    expect(r.show).toBe(true);
    expect(r.rows.map((x) => x.id)).toEqual([1, 3, 5]);
    expect(pendingReview([{ id: 2, status: 'approved' }]).show).toBe(false);
    expect(pendingReview(null)).toEqual({ count: 0, rows: [], show: false });
  });

  test('the stats line no longer repeats the request count (the Review row carries it)', () => {
    expect(hostSummaryStats({ going: 4, requests: 3, waitlisted: 1, interested: 2 }).map((s) => s.key))
      .toEqual(['going', 'waitlisted', 'interested']);
    expect(center).toMatch(/hostSummaryStats\(stats\)/);
    expect(center).not.toMatch(/hostStats\(stats\)/);
  });

  test('collapsed: one Review row that opens the requests in place (no navigation)', () => {
    expect(manager).toMatch(/t\('ui\.hostCenter\.stat\.requests', \{ count: review\.count \}\)/);
    expect(manager).toMatch(/reviewOpen \? t\('ui\.hostCenter\.review\.hide'\) : t\('ui\.hostCenter\.review\.open'\)/);
    expect(manager).toMatch(/\{reviewOpen && review\.rows\.map\(renderRow\)\}/);
    expect(manager).not.toMatch(/navigation\./);
  });

  test('each request reads "Name / Requested to join" with Approve then Decline', () => {
    expect(manager).toMatch(/t\('ui\.hostCenter\.review\.requested'\)/);
    const row = manager.slice(manager.indexOf('const renderRow'));
    expect(row.indexOf('styles.approveText')).toBeGreaterThan(-1);
    expect(row.indexOf('styles.approveText')).toBeLessThan(row.indexOf("<Text style={styles.decline}>{t('ui.gatheringParts.decline2')}"));
    // same server actions as before: approve_gathering_interest, host_remove_gathering_attendee
    expect(manager).toMatch(/approveInterest\(row\.id\)/);
    expect(manager).toMatch(/hostRemoveAttendee\(row\.id\)/);
  });

  test('wording, in all 11 languages', () => {
    expect(translate('en', 'ui.hostCenter.review.open')).toBe('Review');
    expect(translate('en', 'ui.hostCenter.review.requested')).toBe('Requested to join');
    for (const lang of ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko']) {
      for (const k of ['open', 'hide', 'requested', 'a11y']) {
        const v = translate(lang, `ui.hostCenter.review.${k}`);
        expect(v).not.toMatch(/^ui\./);
        expect(v.length).toBeGreaterThan(0);
      }
    }
  });
});

// Item 144 consistency audit (owner, option 1): the Review row is a decision-needed signal for ANY gathering with a
// pending request; it never reads visibility. Server side (each visibility really produces a pending request the host can
// read; public without approval produces none) is proven by scripts/live-verify/host-review-pending-every-visibility.sql.
describe('item 144 audit: one source, every visibility, no stale state', () => {
  const { pendingReview, applyDecision } = require('./hostCommandCenter');
  const fs = require('fs');
  const path = require('path');
  const manager = fs.readFileSync(path.join(__dirname, '..', 'components/HostAttendeeManager.js'), 'utf8');
  const pending = (id) => ({ id, status: 'pending', profiles: { display_name: `P${id}` } });

  test.each(['everyone', 'friends', 'community', 'invite_only'])('a %s gathering with a pending request shows the row', (visibility) => {
    const r = pendingReview([{ ...pending(1), visibility }, { id: 2, status: 'approved', visibility }]);
    expect(r).toMatchObject({ show: true, count: 1 });
  });

  test('zero pending = no row, whatever else is on the list', () => {
    expect(pendingReview([]).show).toBe(false);
    expect(pendingReview([{ id: 1, status: 'approved' }, { id: 2, status: 'waitlisted' }]).show).toBe(false);
  });

  test('the row and list never read the gathering\'s visibility or approval setting', () => {
    const src = fs.readFileSync(path.join(__dirname, 'hostCommandCenter.js'), 'utf8');
    const fn = src.slice(src.indexOf('export function pendingReview'), src.indexOf('}', src.indexOf('export function pendingReview')));
    expect(fn).not.toMatch(/visibility|requires_approval|is_public/);
    expect(manager).not.toMatch(/visibility|requires_approval|is_public/);
  });

  test('deciding the last request empties the pending set at once (approve, waitlisted, decline)', () => {
    const one = [pending(1), { id: 2, status: 'approved' }];
    expect(pendingReview(applyDecision(one, 1, 'approved')).show).toBe(false);
    expect(pendingReview(applyDecision(one, 1, 'waitlisted')).show).toBe(false);
    expect(pendingReview(applyDecision(one, 1, null)).show).toBe(false);
    expect(applyDecision(one, 1, null)).toEqual([{ id: 2, status: 'approved' }]);
    const three = [pending(1), pending(2), pending(3)];
    expect(pendingReview(applyDecision(three, 2, 'approved'))).toMatchObject({ count: 2 });
    expect(applyDecision(null, 1, null)).toBeNull();
  });

  test('both decisions update the list before the reload; only the newest load may write it; the row resets closed', () => {
    expect(manager).toMatch(/setRows\(\(prev\) => applyDecision\(prev, row\.id, result\?\.status === 'waitlisted' \? 'waitlisted' : 'approved'\)\)/);
    expect(manager).toMatch(/setRows\(\(prev\) => applyDecision\(prev, row\.id, null\)\)/);
    expect(manager).toMatch(/if \(seq === loadSeq\.current\) setRows\(next\)/);
    expect(manager).toMatch(/if \(!review\.show && reviewOpen\) setReviewOpen\(false\)/);
    // the count and the list are the same array: no second count source anywhere in the command center
    expect(manager).toMatch(/const review = pendingReview\(rows\)/);
    expect(manager).toMatch(/\{reviewOpen && review\.rows\.map\(renderRow\)\}/);
  });

  test('the request source is one unpaginated query, reloaded on every focus', () => {
    const svc = fs.readFileSync(path.join(__dirname, '..', 'services/gatherings.js'), 'utf8');
    const fn = svc.slice(svc.indexOf('export async function getGatheringRequestsForHost'), svc.indexOf('export async function hostRemoveAttendee'));
    expect(fn).not.toMatch(/\.range\(|\.limit\(/);
    const detail = fs.readFileSync(path.join(__dirname, '..', 'screens/GatheringDetailScreen.js'), 'utf8');
    expect(detail).toMatch(/setHostRefreshKey\(\(k\) => k \+ 1\)/);
    expect(detail).toMatch(/refreshKey=\{hostRefreshKey\}/);
  });
});
