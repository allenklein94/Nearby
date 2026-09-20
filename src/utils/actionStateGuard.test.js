import fs from 'fs';
import path from 'path';

// Rule 7 (an action is offered only in a state that allows it): the offer
// Accept / Confirm-with-group buttons need an OPEN request, and a pending
// opportunity card on a request that is no longer open makes no "new
// opportunity" claim.
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'screens', f), 'utf8');

test('consumer offer actions require an open request', () => {
  const src = read('BusinessRequestDetailScreen.js');
  expect(src).toMatch(/request\.status === 'open' && !hasWinner && isGroupPlanRequest/);
  expect(src).toMatch(/canDo\('request', request\.status, 'accept_offer'\) && canDo\('offer', offerLifecycleState\(o\), 'accept'\)/);
});

test('a closed pending opportunity is labelled, not called new', () => {
  const src = read('BusinessDashboardScreen.js');
  expect(src).toMatch(/No longer open/);
  expect(src).toMatch(/canRespondToOpportunity\(o\) \? \(\s*<Text[^>]*>\s*\{matchReasons\.length > 0/);
});

test('surprise reveal is not offered on a cancelled plan', () => {
  expect(read('GroupOccasionPlanScreen.js')).toMatch(/detail\.isHost && detail\.status !== 'cancelled' &&\s*\(\s*<View style=\{styles\.surpriseRevealRow\}/);
});
