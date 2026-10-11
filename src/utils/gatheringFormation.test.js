// Owner item 43 (2026-10-11): the formation shown when a gathering is published -- which pieces exist (only real ones, from
// the stored gathering and the real publish result), their order, the motion's budget and rules, and the hand-over from Create.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const fs = require('fs');
const path = require('path');
import { formationPieces, FORMATION_ORDER } from './gatheringFormation';
import { tr } from '../i18n/translate';
import { SEQUENCES, settleMs, tierOf } from '../motion/motionBudget';

const read = (r) => fs.readFileSync(path.join(__dirname, '..', r), 'utf8');
const t = (k, p) => tr(k, p);
const g = (over = {}) => ({ id: 'g1', title: 'Sunday pickleball', interest_tag: 'Pickleball', visibility: 'friends', ...over });

describe('the pieces', () => {
  test('all four, in order: what, when, who, where', () => {
    const p = formationPieces({ gathering: g(), whenLabel: 'Sun 10:00 AM', placeName: 'Lakeside Courts', t });
    expect(p.map((x) => x.key)).toEqual(FORMATION_ORDER);
    expect(p[0]).toMatchObject({ key: 'what', text: 'Sunday pickleball' });
    expect(p[1]).toMatchObject({ key: 'when', icon: '🕐', text: 'Sun 10:00 AM' });
    expect(p[2]).toMatchObject({ key: 'who', icon: '👥', text: tr('ui.gatheringVocab.visibility.friends.label'), note: null });
    expect(p[3]).toMatchObject({ key: 'where', icon: '📍', text: 'Lakeside Courts' });
  });
  test('who carries the real invite result only when invites were sent; a community names the one picked', () => {
    const invited = formationPieces({ gathering: g(), whenLabel: 'x', preInviteResult: { sent: 2, total: 3 }, t });
    expect(invited.find((x) => x.key === 'who').note).toBe(tr('ui.gatheringConfirmation.weInvited', { sent: 2, count: 3 }));
    const none = formationPieces({ gathering: g(), whenLabel: 'x', preInviteResult: { sent: 0, total: 0 }, t });
    expect(none.find((x) => x.key === 'who').note).toBeNull();
    const club = formationPieces({ gathering: g({ visibility: 'community' }), whenLabel: 'x', communityName: 'Run Club', t });
    expect(club.find((x) => x.key === 'who').text).toBe(`${tr('ui.gatheringVocab.visibility.community.label')} — Run Club`);
  });
  test('where follows the Create review step: a picked name, else "Custom location set" for a pin, else your current location', () => {
    const where = (o) => formationPieces({ gathering: g(), whenLabel: 'x', t, ...o }).find((x) => x.key === 'where').text;
    expect(where({ placeName: 'Lakeside Courts' })).toBe('Lakeside Courts');
    expect(where({ customLocation: true })).toBe(tr('ui.gatheringForm.preview.customLocation'));
    expect(where({})).toBe(tr('ui.gatheringForm.currentLocation'));
    const review = read('screens/CreateGatheringScreen.js');
    expect(review).toMatch(/placeName \? placeName : customLocation \? t\('ui\.gatheringForm\.preview\.customLocation'\) : t\('ui\.gatheringForm\.currentLocation'\)/);
  });
  test('only real pieces: no when label, an unknown visibility, a blank title -> those pieces are left out; no gathering -> nothing', () => {
    expect(formationPieces({ gathering: g({ title: '  ', visibility: 'nope' }), whenLabel: null, t }).map((x) => x.key)).toEqual(['where']);
    expect(formationPieces({ gathering: null, t })).toEqual([]);
  });
  test('never "Your plan is ready": the headline keeps "Your gathering is live!" (nobody has accepted yet)', () => {
    const panel = read('components/GatheringPublishedPanel.js');
    expect(panel).toMatch(/ui\.gatheringConfirmation\.yourGatheringIsLive/);
    expect(panel).not.toMatch(/planIsReady|plan is ready/i);
  });
});

describe('the moment', () => {
  test('the shared plan-comes-together motion: special tier, at most 4 pieces, under 0.9 s, a 4 px rise (subtle)', () => {
    const s = SEQUENCES.planTogether;
    expect(s.maxPieces).toBeGreaterThanOrEqual(FORMATION_ORDER.length);
    expect(s.risePx).toBeLessThanOrEqual(4);
    expect(tierOf(settleMs('planTogether'))).toBe('special');
    expect(settleMs('planTogether')).toBeLessThanOrEqual(900);
  });
  test('one piece per real piece, in the panel, after the stored gathering loaded; readable from frame one; Reduce Motion settles', () => {
    const panel = read('components/GatheringPublishedPanel.js');
    expect(panel).toMatch(/<PlanComesTogether playKey=\{1\} pieces=\{pieces\.length\}/);
    expect(panel).toMatch(/pieces\.map\(\(p, i\) => \(\s*<PlanPiece key=\{p\.key\} index=\{i\}>/);
    const motion = read('motion/PlanComesTogether.js');
    expect(motion).toMatch(/const animate = playKey > 0 && !reduceMotion;/);
    expect(motion).toMatch(/opacity: infoOpacity\(v\)/);
    const detail = read('screens/GatheringDetailScreen.js');
    expect(detail).toMatch(/\{justPublished && gathering\.isHost && \(\s*<GatheringPublishedPanel/); // only once the stored row is in
  });
  test('the headline is final before the formation plays: "first gathering" is decided by Create after the publish returned', () => {
    const create = read('screens/CreateGatheringScreen.js');
    const submit = create.slice(create.indexOf('async function submit()'));
    expect(submit.indexOf('await createGathering(')).toBeLessThan(submit.indexOf('const firstHosted = await isFirstGatheringHosted()'));
    expect(submit.indexOf('const firstHosted = await isFirstGatheringHosted()')).toBeLessThan(submit.indexOf("navigation.replace('GatheringDetail'"));
    const panel = read('components/GatheringPublishedPanel.js');
    expect(panel).not.toMatch(/isFirstGatheringHosted|setIsFirstHosted/);
    expect(panel).toMatch(/const isFirstHosted = !!firstHosted;/);
  });
});
