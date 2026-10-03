const { needsApproval, joinLabel } = require('./gatheringJoinMode');

describe('gathering join mode', () => {
  test('public gatherings default to Anyone: one tap', () => {
    expect(needsApproval({ is_public: true, requires_approval: false })).toBe(false);
    expect(needsApproval({ is_public: true })).toBe(false);
    expect(joinLabel({ is_public: true })).toBe('Join Gathering');
  });
  test('host-enabled approval requires a request', () => {
    expect(needsApproval({ is_public: true, requires_approval: true })).toBe(true);
    expect(joinLabel({ is_public: true, requires_approval: true })).toBe('Request to Join');
  });
  test('non-public (invite-only) keeps requiring review, as before', () => {
    expect(needsApproval({ is_public: false })).toBe(true);
  });
  test('full gatherings say waitlist regardless of mode', () => {
    expect(joinLabel({ is_public: true }, { isFull: true })).toBe('Join Waitlist');
    expect(joinLabel({ is_public: true, requires_approval: true }, { isFull: true })).toBe('Join Waitlist');
  });
  test('missing gathering never needs approval', () => {
    expect(needsApproval(null)).toBe(false);
  });
});

// Owner item 145: a public gathering never turns the host into a bouncer. Anyone (one tap, auto-accept) is the default
// everywhere a gathering is created; approval happens only when the host explicitly picks Require approval (or invites
// only). Behavior per visibility is proven live by scripts/live-verify/host-review-pending-every-visibility.sql.
describe('item 145: auto-accept is the default, approval is opt-in', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  test('Create starts on Anyone and only sends approval when the host chose it', () => {
    const create = read('screens/CreateGatheringScreen.js');
    expect(create).toMatch(/const \[requiresApproval, setRequiresApproval\] = useState\(false\)/);
    expect(create).toMatch(/requiresApproval: visibility !== 'invite_only' && requiresApproval/);
    // only invite-only is saved non-public, so Friends / Community auto-accept too unless approval is on
    expect(create).toMatch(/const isPublic = visibility !== 'invite_only'/);
  });

  test('the service and the database default to no approval', () => {
    expect(read('services/gatherings.js')).toMatch(/requiresApproval = false/);
    const mig = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase/migrations/20270119_gathering_requires_approval.sql'), 'utf8');
    expect(mig).toMatch(/requires_approval boolean not null default false/);
  });

  test('a public gathering without approval is one tap to join', () => {
    expect(needsApproval({ is_public: true, requires_approval: false })).toBe(false);
    expect(needsApproval({ is_public: true })).toBe(false);
    expect(joinLabel({ is_public: true, requires_approval: false })).toBe('Join Gathering');
    expect(needsApproval({ is_public: true, requires_approval: true })).toBe(true);
  });
});
