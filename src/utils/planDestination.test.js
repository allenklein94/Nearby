import { canonicalPlanDestination, isMultiObjectPlanType, multiObjectParent } from './planDestination';

const ov = (plan_type, extra = {}) => ({ plan: { id: 'p', plan_type }, activity: null, businessRequest: null, match: null, parent: null, ...extra });

describe('canonicalPlanDestination', () => {
  test('a gathering plan opens the gathering', () => {
    for (const type of ['gathering', 'friend_hangout']) {
      expect(canonicalPlanDestination(ov(type, { activity: { kind: 'gathering', id: 'g1' } })))
        .toEqual({ name: 'GatheringDetail', params: { gatheringId: 'g1' } });
    }
  });
  test('a business request plan opens the request', () => {
    expect(canonicalPlanDestination(ov('business_request', { businessRequest: { id: 'r1' } })))
      .toEqual({ name: 'BusinessRequestDetail', params: { requestId: 'r1' } });
  });
  test('a match plan opens the chat; a date plan opens the proposal', () => {
    const match = { id: 'm1', other_display_name: 'Sam' };
    expect(canonicalPlanDestination(ov('dating_match', { match }))).toEqual({ name: 'Chat', params: { matchId: 'm1' } });
    expect(canonicalPlanDestination(ov('friend_match', { match }))).toEqual({ name: 'Chat', params: { matchId: 'm1' } });
    expect(canonicalPlanDestination(ov('dating_date', { match }))).toEqual({ name: 'DateProposal', params: { matchId: 'm1', matchName: 'Sam' } });
  });
  test('multi-object plans stay on PlanDetail, even when one of their parts is a gathering', () => {
    for (const type of ['experience', 'occasion', 'group_occasion', 'birthday', 'anniversary']) {
      expect(isMultiObjectPlanType(type)).toBe(true);
      expect(canonicalPlanDestination(ov(type, { activity: { kind: 'gathering', id: 'g1' }, businessRequest: { id: 'r1' } }))).toBeNull();
    }
  });
  test('a single-object plan whose object is missing stays on PlanDetail (never a broken destination)', () => {
    expect(canonicalPlanDestination(ov('gathering'))).toBeNull();
    expect(canonicalPlanDestination(ov('gathering', { activity: { kind: 'group_option', id: 'x' } }))).toBeNull();
    expect(canonicalPlanDestination(ov('business_request'))).toBeNull();
    expect(canonicalPlanDestination(ov('dating_match'))).toBeNull();
    expect(canonicalPlanDestination(null)).toBeNull();
  });
});

describe('multiObjectParent', () => {
  test('only a night out or an occasion is a parent worth linking up to', () => {
    expect(multiObjectParent(ov('business_request', { parent: { id: 'x', plan_type: 'experience', title: 'Our night' } })))
      .toEqual({ id: 'x', plan_type: 'experience', title: 'Our night' });
    expect(multiObjectParent(ov('gathering', { parent: { id: 'x', plan_type: 'occasion', title: 'Mom\'s birthday' } }))).toBeTruthy();
    expect(multiObjectParent(ov('business_request', { parent: { id: 'x', plan_type: 'dating_match', title: null } }))).toBeNull();
    expect(multiObjectParent(ov('gathering'))).toBeNull();
  });
});
