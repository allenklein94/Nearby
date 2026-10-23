// Idea "360" narrow fix: the gathering Invite sheet shows each friend's real state and never a false success.
import fs from 'fs';
import path from 'path';
import { inviteSheetRows, inviteStateMap, inviteRefusalState, inviteRowCanInvite, INVITE_ROW_LABEL_KEYS } from './inviteSheetRows';
import { translate } from '../i18n/translate';

const friends = [
  { id: 'a', display_name: 'Ana' },
  { id: 'b', display_name: 'Ben' },
  { id: 'c', display_name: 'Cy' },
  { id: 'd', display_name: 'Dee' },
];

describe('inviteSheetRows', () => {
  const states = inviteStateMap([
    { friend_id: 'a', state: 'going' },
    { friend_id: 'b', state: 'invited' },
    { friend_id: 'c', state: 'ineligible' },
    { friend_id: 'd', state: 'invite' },
  ]);
  const rows = inviteSheetRows(friends, states);
  const byId = Object.fromEntries(rows.map((r) => [r.friend.id, r.state]));

  test('already attending = Going, no Invite action', () => {
    expect(byId.a).toBe('going');
    expect(inviteRowCanInvite('going')).toBe(false);
  });

  test('already invited = Invited, no Invite action', () => {
    expect(byId.b).toBe('invited');
    expect(inviteRowCanInvite('invited')).toBe(false);
  });

  test('ineligible friends are left out of the list', () => {
    expect(byId.c).toBeUndefined();
    expect(rows).toHaveLength(3);
  });

  test('only an eligible, not-yet-invited friend has an active Invite', () => {
    expect(byId.d).toBe('invite');
    expect(rows.filter((r) => inviteRowCanInvite(r.state)).map((r) => r.friend.id)).toEqual(['d']);
    expect(inviteRowCanInvite('sent')).toBe(false);
  });

  test('order is unchanged (no ranking)', () => {
    expect(rows.map((r) => r.friend.id)).toEqual(['a', 'b', 'd']);
  });

  test('unknown state (read failed, community invite, friend newer than the read) = Invite; the server re-checks', () => {
    expect(inviteSheetRows(friends, null).every((r) => r.state === 'invite')).toBe(true);
    expect(inviteSheetRows(friends, { a: 'weird' })[0].state).toBe('invite');
  });
});

describe('inviteRefusalState (stale rows)', () => {
  test('a server refusal names the real state', () => {
    expect(inviteRefusalState({ message: 'Already going', hint: 'invite_state:going' })).toBe('going');
    expect(inviteRefusalState({ message: 'Already invited', hint: 'invite_state:invited' })).toBe('invited');
    expect(inviteRefusalState({ message: 'This gathering is women-only', hint: 'invite_state:ineligible' })).toBe('ineligible');
  });

  test('a stale Invite row that the server refuses becomes its real state, never "sent"', () => {
    const rows = inviteSheetRows(friends, { a: inviteRefusalState({ hint: 'invite_state:going' }), b: inviteRefusalState({ hint: 'invite_state:ineligible' }) });
    expect(rows.find((r) => r.friend.id === 'a').state).toBe('going');
    expect(rows.find((r) => r.friend.id === 'b')).toBeUndefined();
  });

  test('an ordinary failure is not a state (keeps the retry dialog)', () => {
    expect(inviteRefusalState({ message: 'Network request failed' })).toBeNull();
    expect(inviteRefusalState(null)).toBeNull();
    expect(inviteRefusalState({ hint: 'invite_state:invite' })).toBeNull();
  });
});

describe('labels reuse existing translated strings (no new keys)', () => {
  const langs = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];
  test.each(Object.entries(INVITE_ROW_LABEL_KEYS))('%s', (_state, key) => {
    for (const l of langs) expect(translate(l, key)).not.toMatch(/^ui\./);
    for (const l of langs.slice(1)) expect(translate(l, key)).not.toBe(translate('en', key));
  });
  test('English wording', () => {
    expect(translate('en', INVITE_ROW_LABEL_KEYS.going)).toBe('Going');
    expect(translate('en', INVITE_ROW_LABEL_KEYS.invited)).toBe('Invited');
  });
});

describe('InviteFriendsModal wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../components/InviteFriendsModal.js'), 'utf8');

  test('reads the server rule and renders rows through inviteSheetRows', () => {
    expect(src).toMatch(/rpc\('get_gathering_invite_states'/);
    expect(src).toMatch(/data=\{inviteSheetRows\(friends, rowStates\)\}/);
  });

  test('a refusal updates the row with no toast or haptic; success alone shows "Sent"', () => {
    const catchBlock = src.slice(src.indexOf('} catch (e) {'), src.indexOf('setInvitingId(null);'));
    expect(catchBlock).toMatch(/inviteRefusalState\(e\)/);
    expect(catchBlock).not.toMatch(/showSuccessToast|Haptics/);
  });

  test('no avatar travel or added motion on invite (idea "360": a face enters Who\'s going only on a real join)', () => {
    expect(src).not.toMatch(/Animated\.|useSharedValue|LayoutAnimation|JoinArrival/);
  });
});
