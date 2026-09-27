// Item 109 (owner's option 1): Create is What -> When -> Who do you want to invite? -> Where -> Details -> Settings -> Publish,
// with the invite step only when the ask said who it is with. Friends are picked during Create (the one shared picker) and
// invited through the one send path only after a successful publish. The screen has never been rendered (no device): the
// flow is covered by the pure rules and source guards below; the send path by a mocked RPC; eligibility by the server
// function send_social_invite (accepted friends only, never across a block), unchanged.
import fs from 'fs';
import path from 'path';

jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));

import { supabase } from './supabase';
import { sendGatheringInvites } from './invites';
import { resolveAsk, toClassification, createParamsFromAsk } from '../utils/askResolver';
import { applyRefinement } from '../utils/askRefinements';
import { inviteStepApplies, namesPeopleFromText } from '../utils/gatheringInference';

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const CREATE = read('../screens/CreateGatheringScreen.js');
const params = (t, current) => createParamsFromAsk(resolveAsk(t, null), t, current);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const SRC = walk(path.join(__dirname, '..')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

describe('1-2. prefill, then the invite step only with invite context', () => {
  it('"Pickleball tonight" prefills Pickleball + Tonight and asks nothing about who', () => {
    const p = params('Pickleball tonight');
    expect(p).toMatchObject({ quickStartCategory: 'Pickleball', quickStartWhenPreset: 'tonight' });
    expect(p).not.toHaveProperty('quickStartInvite');
  });
  it.each([
    'Pickleball tonight with Sam and Alex',
    'pickleball tonight with friends',
    'dinner tonight with my wife',
    'bowling with the family on Saturday',
  ])('%s -> the invite step', (t) => {
    const p = params(t);
    expect(p.quickStartInvite).toBe(true);
    expect(Object.keys(p).filter((k) => /invitee|friend/i.test(k))).toEqual([]); // nobody is picked for them
  });
  it.each(['solo yoga tonight', 'meet new people tonight', 'coffee tonight', 'Pickleball tonight'])('%s -> no invite step', (t) => {
    expect(params(t)).not.toHaveProperty('quickStartInvite');
  });
  it('a Who chip decides too: With Friends adds the step, Solo removes it', () => {
    const base = toClassification(resolveAsk('pickleball tonight', null));
    expect(params('pickleball tonight', applyRefinement(base, 'friends')).quickStartInvite).toBe(true);
    const withFriends = toClassification(resolveAsk('pickleball tonight with friends', null));
    expect(params('pickleball tonight with friends', applyRefinement(withFriends, 'solo'))).not.toHaveProperty('quickStartInvite');
  });
  it('names are a signal only, never a match to anyone', () => {
    expect(namesPeopleFromText('tennis with Sam')).toBe(true);
    expect(namesPeopleFromText('tennis with some people')).toBe(false);
    expect(namesPeopleFromText('Tennis with The crew')).toBe(false);
    expect(inviteStepApplies('solo', 'tennis')).toBe(false);
    expect(inviteStepApplies('new_people', 'tennis')).toBe(false);
  });
  it('the step order is What, When, Invite, Where, Details, Settings, Publish, and Invite exists only with the flag', () => {
    const defs = CREATE.slice(CREATE.indexOf('const STEP_DEFS = ['), CREATE.indexOf('].filter('));
    expect(defs.replace(/\s+/g, ' ')).toMatch(/'what'.*'when'.*\.\.\.\(askInvite \? \[\{ key: 'invite', label: 'Invite' \}\] : \[\]\).*'where'.*'details'.*'settings'.*'publish'/);
    expect(CREATE).toMatch(/const askInvite = route\.params\?\.quickStartInvite === true;/);
    expect(CREATE).toMatch(/Who do you want to invite\?/);
  });
});

describe('3. picks stay with the draft', () => {
  it('inviteIds is part of the saved draft and restored with it', () => {
    const snap = CREATE.slice(CREATE.indexOf('const gatheringSnapshot = {'), CREATE.indexOf('const gatheringDraft'));
    expect(snap).toMatch(/inviteIds/);
    expect(CREATE).toMatch(/setInviteIds\(d\.inviteIds && typeof d\.inviteIds === 'object' \? d\.inviteIds : \{\}\)/);
  });
});

describe('4-5, 10. invitations only after a successful publish; the gathering itself is unchanged', () => {
  const submit = CREATE.slice(CREATE.indexOf('async function submit()'), CREATE.indexOf('const selectedStyle'));
  it('sent after createGathering succeeds, before the confirmation, inside the same try (a failed publish never reaches it)', () => {
    const created = submit.indexOf('await createGathering(');
    const send = submit.indexOf('await sendGatheringInvites(created.id, selectedFriendIdList(inviteIds))');
    const catchAt = submit.indexOf('} catch (e) {');
    expect(created).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(created);
    expect(send).toBeLessThan(submit.indexOf("navigation.replace('GatheringConfirmation'"));
    expect(send).toBeLessThan(catchAt);
    expect(submit).toMatch(/preInviteResult,/); // the existing "We invited N of M" line on the confirmation screen
  });
  it('the gathering payload does not change: no invites, no party type or friend data added for it', () => {
    const payload = submit.slice(submit.indexOf('await createGathering({'), submit.indexOf('});', submit.indexOf('await createGathering({')));
    expect(payload).not.toMatch(/inviteIds|selectedFriend|preInvite/);
  });
  it('send path: one send_social_invite per friend, deduped; a failed one is counted, never thrown or rolled back', async () => {
    supabase.rpc.mockReset();
    supabase.rpc
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'You can only invite friends' } });
    const res = await sendGatheringInvites('g1', ['a', 'b', 'a']);
    expect(res).toEqual({ sent: 1, total: 2 });
    expect(supabase.rpc.mock.calls.map((c) => c[0])).toEqual(['send_social_invite', 'send_social_invite']);
    expect(supabase.rpc.mock.calls[0][1]).toEqual({ invite_type_param: 'gathering', target_id_param: 'g1', invitee_id_param: 'a' });
    supabase.rpc.mockClear();
    expect(await sendGatheringInvites('g1', [])).toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe('6-8. eligibility, no strangers, no second system', () => {
  it('the picker lists only accepted friends and the send goes through the server friend check', () => {
    const picker = read('../components/FriendInviteSelector.js');
    expect(picker).toMatch(/getFriendsWithSharedContext\(myId\)/);
    const imports = picker.split('\n').filter((l) => l.startsWith('import ')).join('\n');
    expect(imports).not.toMatch(/getNearby|friendDiscovery|getFriendDiscoveryCandidates|matches/i);
    expect(read('./invites.js')).toMatch(/sendGatheringInvites[\s\S]*sendInvite\('gathering', gatheringId, id\)/);
  });
  it('one picker and one pre-publish send path, shared by MakeAPlan and Create', () => {
    for (const f of ['../screens/MakeAPlanScreen.js', '../screens/CreateGatheringScreen.js']) {
      const src = read(f);
      expect(src).toMatch(/<FriendInviteSelector /);
      expect(src).toMatch(/sendGatheringInvites\(created\.id,/);
    }
    const bulk = SRC.filter((f) => /Promise\.allSettled\( ?\w+\.map\(\(\w+\) => sendInvite\('gathering'/.test(fs.readFileSync(f, 'utf8').replace(/\s+/g, ' ')));
    // the post-publish panel's "Invite a Circle" (one tap, gathering already exists) is the only other bulk send, unchanged
    expect(bulk.map((f) => path.basename(f)).sort()).toEqual(['GatheringConfirmationScreen.js', 'invites.js']);
    // no new RPC, table or screen for invitations
    expect(SRC.filter((f) => /navigate\('(?:InviteStep|CreateInvite|PickInvitees)'/.test(fs.readFileSync(f, 'utf8')))).toEqual([]);
  });
  it('9. without invite context Create keeps its old steps', () => {
    expect(params('Pickleball tonight')).not.toHaveProperty('quickStartInvite');
    expect(CREATE).not.toMatch(/quickStartInvite\s*\?\?|quickStartInvite\s*\|\|/); // no default that turns it on
  });
});
