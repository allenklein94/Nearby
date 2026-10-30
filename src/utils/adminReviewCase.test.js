// Admin review on the business website (20270368 + 20270369): the presentation rules, plus guards that the screen stays
// website-only (the native build is unchanged), signs photo links for 15 minutes only through Storage, and never acts on
// an account by itself.
const fs = require('fs');
const path = require('path');
const {
  ADMIN_PHOTO_LINK_SECONDS, caseTitle, caseBadges, caseActions, eventLine, photosByAccount, casePhotoPaths, signedUrlMap,
  linksStale, reopenReasonProblem, linkProblem, canOpenInvestigation,
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
      'admin_list_account_review_cases', 'admin_open_case_from_report', 'admin_record_case_external_check', 'admin_reopen_account_review_case']);
    expect(screen).not.toMatch(/admin_suspend_user|\.update\(|\.delete\(/);
  });
});
