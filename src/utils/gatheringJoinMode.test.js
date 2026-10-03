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

// Migration 20270266: the one legacy "visible to everyone but not public" row was fixed by id, and a CHECK keeps the
// state from returning; live proof in scripts/live-verify/everyone-is-public.sql.
describe('item 145 follow-up: everyone is always public', () => {
  const fs = require('fs');
  const path = require('path');
  const mig = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase/migrations/20270266_legacy_everyone_not_public_row.sql'), 'utf8');

  test('the data fix touches exactly the one known row, only while it is still in the old state', () => {
    expect(mig.match(/update public\.gatherings/g)).toHaveLength(1);
    expect(mig).toMatch(/where id = '7b152168-d981-4b9a-a947-d168ec9b05c1'\s+and visibility = 'everyone'\s+and is_public is not true/);
  });

  test('a CHECK refuses everyone + not public; the app never writes it', () => {
    expect(mig).toMatch(/check \(visibility <> 'everyone' or is_public is true\)/);
    expect(fs.readFileSync(path.join(__dirname, '..', 'screens/CreateGatheringScreen.js'), 'utf8'))
      .toMatch(/const isPublic = visibility !== 'invite_only'/);
  });

  test('the legacy row now joins like any public gathering without approval', () => {
    expect(needsApproval({ visibility: 'everyone', is_public: true, requires_approval: false })).toBe(false);
  });
});
