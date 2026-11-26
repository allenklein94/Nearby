// Admin review on the business website (20270368 + 20270369): the presentation rules, plus guards that the screen stays
// website-only (the native build is unchanged), signs photo links for 15 minutes only through Storage, and never acts on
// an account by itself.
const fs = require('fs');
const path = require('path');
const {
  ADMIN_PHOTO_LINK_SECONDS, caseTitle, caseBadges, caseActions, eventLine, photosByAccount, casePhotoPaths, signedUrlMap,
  linksStale, reopenReasonProblem, linkProblem, canOpenInvestigation, priorSuspensionLines, PRIOR_SUSPENSION_NOTE, sharedDeviceLines, SHARED_DEVICE_NOTE, sharedTextLines, SHARED_TEXT_NOTE, sharedLinkLines, SHARED_LINK_NOTE,
} = require('./adminReviewCase');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

describe('admin review case rules', () => {
  const c = {
    id: 'c1', signal: 'similar_photo', reason: 'many_accounts', status: 'closed', outcome: 'no_action', new_evidence_since_closed: true,
    members: [{ user_id: 'u1', display_name: 'Alex' }, { user_id: 'u2', display_name: null, after_close: true, suspended: true }],
    photos: [{ object_id: 'o1', user_id: 'u1', path: 'u1/a.jpg', in_use: true }, { object_id: 'o2', user_id: 'u2', path: 'u2/b.jpg', in_use: false },
      { object_id: 'o3', user_id: 'u1', path: 'u1/a.jpg', in_use: true }],
  };

  test('titles and badges say what the case is, never that an account is fake', () => {
    expect(caseTitle(c)).toBe('Similar photo · On several accounts');
    expect(caseBadges(c)).toEqual(['New evidence since closed', 'Closed · No action needed']);
    expect(caseBadges({ status: 'open', overdue: true })).toEqual(['Review overdue']);
    const src = read('src/utils/adminReviewCase.js') + read('src/screens/AdminReviewScreen.js');
    expect(src).not.toMatch(/\bfake (account|profile|person)\b/i);
    expect(src).not.toMatch(/\b(confirmed|certain|definite) (match|duplicate)\b/i);
  });

  test('a closed case offers reopen, an open one close; both take notes and outside checks', () => {
    expect(caseActions({ status: 'open' })).toEqual(['note', 'external_check', 'close']);
    expect(caseActions({ status: 'closed' })).toEqual(['note', 'external_check', 'reopen']);
  });

  test('photos are grouped by account, side by side, deleted accounts named neutrally', () => {
    const g = photosByAccount(c);
    expect(g.map((x) => [x.name, x.photos.length, x.afterClose, x.suspended])).toEqual([['Alex', 2, false, false], ['Account u2', 1, true, true]]);
    expect(casePhotoPaths(c)).toEqual(['u1/a.jpg', 'u2/b.jpg']);
    expect(photosByAccount({ members: [], photos: [{ object_id: 'o', user_id: 'gone', path: 'p' }] })[0].name).toBe('Account gone');
  });

  test('history lines name who did what, never a hash', () => {
    expect(eventLine({ kind: 'closed', actor: 'a', actor_name: 'Priya', detail: { outcome: 'no_action', note: 'Family photo' } })).toBe('Closed by Priya: No action needed · Family photo');
    expect(eventLine({ kind: 'reopened', actor: 'a', actor_name: 'Priya', detail: { reason: 'New account appeared' } })).toBe('Reopened by Priya: New account appeared');
    expect(eventLine({ kind: 'new_evidence', subject: 'u9', subject_name: 'Ravi' })).toBe('New evidence since closed: Ravi');
    expect(eventLine({ kind: 'new_evidence', subject: null, detail: {} })).toBe('New evidence since closed: Deleted account');
    expect(eventLine({ kind: 'opened', actor: null })).toBe('Opened by Nearby');
    expect(eventLine({ kind: 'external_check', actor: 'a', actor_name: 'P', detail: { source: 'Reverse search', result: 'no_match' } })).toBe('P checked Reverse search: No match');
  });

  test('signed links: only paths Storage signed; refreshed a minute before 15 minutes', () => {
    expect(ADMIN_PHOTO_LINK_SECONDS).toBe(900);
    expect(signedUrlMap([{ path: 'a', signedUrl: 'https://x' }, { path: 'b', error: 'Object not found', signedUrl: null }])).toEqual({ a: 'https://x' });
    expect(linksStale(0)).toBe(true);
    expect(linksStale(1000, 1000 + 13 * 60 * 1000)).toBe(false);
    expect(linksStale(1000, 1000 + 14 * 60 * 1000 + 1)).toBe(true);
  });

  test('reopen needs a reason (as the server); outside-check links must be https', () => {
    expect(reopenReasonProblem('new')).toMatch(/at least 10/);
    expect(reopenReasonProblem('A new account appeared')).toBeNull();
    expect(linkProblem('http://x.com')).toBe('Use an https link.');
    expect(linkProblem('https://x.com/a')).toBeNull();
    expect(linkProblem('')).toBeNull();
    expect(canOpenInvestigation({ reported_id: 'u' })).toBe(true);
    expect(canOpenInvestigation({ reported_id: null })).toBe(false);
  });
});

describe('prior-suspension cases (20270374)', () => {
  test('titled neutrally: a number match, never "the same person"', () => {
    expect(caseTitle({ signal: 'prior_suspension', reason: 'suspended_number_reused' }))
      .toBe('Phone number of a suspended account · Signed up with a number a suspended account used');
    expect(PRIOR_SUSPENSION_NOTE).toMatch(/not proof/);
    expect(PRIOR_SUSPENSION_NOTE).toMatch(/reassign/);
  });

  test('earlier decisions listed oldest first with who and why; an expired record says so; never a number', () => {
    const lines = priorSuspensionLines([
      { still_kept: true, released: 'account_deleted', released_at: '2026-10-01T12:00:00Z', expires_at: '2027-10-01T12:00:00Z',
        decisions: [{ action: 'suspend', reason: 'Harassment', admin_name: 'Robin', at: '2026-09-20T12:00:00Z' }] },
      { still_kept: false },
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Earlier account deleted /);
    expect(lines[1]).toMatch(/Suspended by Robin: Harassment$/);
    expect(lines[2]).toBe('Earlier record no longer kept (12-month limit)');
    expect(priorSuspensionLines(null)).toEqual([]);
    expect(read('src/utils/adminReviewCase.js') + read('src/screens/AdminReviewScreen.js')).not.toMatch(/phone_key|\.phone\b/);
  });
});

describe('shared-device cases (20270376)', () => {
  test('title + reason say what was seen, never that accounts are the same person', () => {
    expect(caseTitle({ signal: 'shared_device', reason: 'many_accounts' })).toBe('Same phone notification token · On several accounts');
    expect(caseTitle({ signal: 'shared_device', reason: 'suspended_device' })).toBe('Same phone notification token · Also used by a suspended account');
    expect(SHARED_DEVICE_NOTE).toMatch(/not proof/);
    expect(SHARED_DEVICE_NOTE).not.toMatch(/fake|certain|confirmed/i);
  });
  test('evidence lines: counts, suspended accounts, deleted suspended accounts; never a token', () => {
    const lines = sharedDeviceLines({ accounts: 3, window_days: 90, suspended_accounts: ['u1'],
      former_suspended_accounts: [{ former_account_id: 'abcdef12-0000-0000-0000-000000000000', suspended_at: '2026-10-01T00:00:00Z' }] });
    expect(lines[0]).toBe('3 accounts registered this token in the last 90 days');
    expect(lines[1]).toBe('1 of them suspended');
    expect(lines[2]).toMatch(/^Earlier on a suspended account since deleted \(Account abcdef12, suspended /);
    expect(lines.join(' ')).not.toMatch(/ExponentPushToken/);
    expect(sharedDeviceLines(null)).toEqual([]);
  });
  test('a many-accounts case names the other review cases that corroborate it (option 3), by kind only', () => {
    const lines = sharedDeviceLines({ accounts: 4, window_days: 90, suspended_accounts: [],
      corroborating_cases: [{ id: 'c1', signal: 'similar_photo' }, { id: 'c2', signal: 'behavior' }, { id: 'c3', signal: 'behavior' }] });
    expect(lines).toEqual(['4 accounts registered this token in the last 90 days',
      'Opened because these accounts are also in 3 other review cases: Similar photo, Activity pattern']);
    expect(sharedDeviceLines({ accounts: 4, corroborating_cases: [] })).toEqual(['4 accounts registered this token in the last 90 days']);
  });
});

describe('shared-text cases (20270378)', () => {
  test('title + note say what was seen, never that accounts are the same person', () => {
    expect(caseTitle({ signal: 'shared_text', reason: 'many_accounts' })).toBe('Same public text · On several accounts');
    expect(SHARED_TEXT_NOTE).toMatch(/not proof/);
    expect(SHARED_TEXT_NOTE).not.toMatch(/fake|certain|confirmed/i);
  });
  test('evidence lines: counts by source and short gathering ids; never text', () => {
    const lines = sharedTextLines({ accounts: 6, window_days: 30, texts: 2, bio_accounts: 6, gathering_accounts: 5,
      gathering_ids: ['abcdef12-0000-0000-0000-000000000000', '12345678-0000-0000-0000-000000000000'] });
    expect(lines).toEqual(['6 accounts in this case', '2 different texts shared by the same accounts',
      '6 posted the same profile bio in the last 30 days', '5 posted the same public gathering description in the last 30 days',
      'Gatherings: abcdef12, 12345678']);
    expect(sharedTextLines({ accounts: 5, texts: 1, bio_accounts: 5, gathering_accounts: 0, gathering_ids: [] }))
      .toEqual(['5 accounts in this case', '5 posted the same profile bio in the last 30 days']);
    expect(sharedTextLines(null)).toEqual([]);
  });
});

describe('admin review screen boundaries', () => {
  const screen = read('src/screens/AdminReviewScreen.js');

  test('website only: registered on the business website, not in the native app navigator', () => {
    expect(read('src/navigation/BusinessWebNavigator.js')).toMatch(/name="AdminReview" component=\{AdminReviewScreen\}/);
    expect(read('src/navigation/RootNavigator.js')).not.toMatch(/AdminReview\b/);
    expect(read('App.js')).not.toMatch(/AdminReview|BusinessWebNavigator/);
  });

  test('photos only through Storage signed links of 15 minutes; storage stays private (no public URL)', () => {
    expect(screen).toMatch(/createSignedUrls\(paths, ADMIN_PHOTO_LINK_SECONDS\)/);
    expect(screen).not.toMatch(/getPublicUrl/);
  });

  test('every action is an admin-only server function; nothing suspends, bans or restricts from here', () => {
    const rpcs = [...screen.matchAll(/rpc\('(\w+)'/g)].map((m) => m[1]).sort();
    expect([...new Set(rpcs)]).toEqual(['admin_add_account_review_note', 'admin_close_account_review_case', 'admin_get_account_review_case',
      'admin_get_deleted_account_record', 'admin_get_prior_suspension', 'admin_get_shared_review_cases', 'admin_list_account_review_cases', 'admin_open_case_from_report', 'admin_record_case_external_check', 'admin_reopen_account_review_case']);
    expect(screen).not.toMatch(/admin_suspend_user|\.update\(|\.delete\(/);
  });
});

describe('a deleted account (20270406)', () => {
  const { deletedAccountLines, DELETED_ACCOUNT_NOTE, caseTitle: title } = require('./adminReviewCase');

  test('says what was unresolved and when the record goes; never a number, device or id', () => {
    const lines = deletedAccountLines([{ still_kept: true, record_id: 'r1', released_at: '2026-11-01T12:00:00Z', expires_at: '2027-01-30T12:00:00Z', reasons: ['open_report', 'active_pause'], open_reports: 2, open_cases: 0,
      report_ids: ['a', 'b'], number_kept: true, pauses: [{ capability: 'links', reason: 'Repeated unsafe links', expires_at: '2026-11-08T12:00:00Z' }] }]);
    expect(lines[0]).toMatch(/open reports, an active pause/);
    expect(lines[1]).toBe('2 reports open when it was deleted');
    expect(lines[2]).toMatch(/Paused \(links\).*Repeated unsafe links/);
    expect(lines.join(' ')).not.toMatch(/r1|number|device/i);
  });

  test('an expired record says so; a match is never called proof', () => {
    expect(deletedAccountLines([{ still_kept: false }])).toEqual(['The record of the deleted account is no longer kept']);
    expect(deletedAccountLines(null)).toEqual([]);
    expect(DELETED_ACCOUNT_NOTE).toMatch(/not proof/);
    expect(title({ signal: 'prior_unresolved', reason: 'unresolved_account_returned' })).toBe('Earlier account left with something unresolved · Same number or phone as a deleted account');
  });
});

describe('shared-link cases (20270413)', () => {
  test('title + note say what was seen, never that accounts are the same person or a scam', () => {
    expect(caseTitle({ signal: 'shared_link', reason: 'many_accounts' })).toBe('Same website in public gatherings · On several accounts');
    expect(SHARED_LINK_NOTE).toMatch(/not proof/);
    expect(SHARED_LINK_NOTE).not.toMatch(/fake|certain|confirmed|malicious/i);
  });
  test('evidence lines: counts and short gathering ids; never a link or site', () => {
    expect(sharedLinkLines({ accounts: 6, window_days: 30, links: 2,
      gathering_ids: ['abcdef12-0000-0000-0000-000000000000', '12345678-0000-0000-0000-000000000000'] }))
      .toEqual(['6 accounts in this case linked the same website in public gatherings in the last 30 days',
        '2 different websites shared by the same accounts', 'Gatherings: abcdef12, 12345678']);
    expect(sharedLinkLines({ accounts: 5, window_days: 30, links: 1, gathering_ids: [] }))
      .toEqual(['5 accounts in this case linked the same website in public gatherings in the last 30 days']);
    expect(sharedLinkLines(null)).toEqual([]);
  });
});
