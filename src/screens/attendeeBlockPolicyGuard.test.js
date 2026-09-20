const fs = require('fs');
const path = require('path');

// Attendee reads must respect blocks in BOTH directions server-side (the blocks table's own RLS hides
// blocks made AGAINST the caller, so a client filter alone can never cover that direction).
describe('attendee read respects blocks (migration 20270138)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270138_attendee_read_respects_blocks.sql'), 'utf8');
  test('helper checks both directions as SECURITY DEFINER and is single-arg', () => {
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/b\.blocker_id = auth\.uid\(\) and b\.blocked_id = other_user/);
    expect(sql).toMatch(/b\.blocker_id = other_user and b\.blocked_id = auth\.uid\(\)/);
    expect(sql).toMatch(/revoke all on function public\.viewer_blocked_either_way\(uuid\) from public/);
  });
  test('the approved-attendee read policy uses it; the host policy is untouched', () => {
    expect(sql).toMatch(/using \(status = 'approved' and not public\.viewer_blocked_either_way\(user_id\)\)/);
    expect(sql).not.toMatch(/(create|drop) policy[^;]*Users see own interest or gatherings they host/i);
  });
});

describe('gathering_interest anon lockdown (migration 20270139)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270139_gathering_interest_anon_lockdown.sql'), 'utf8');
  test('all three policies are authenticated-only', () => {
    for (const name of ['Anyone can see approved attendees', 'Users see own interest or gatherings they host', 'Users can express interest, respecting women-only gatherings']) {
      expect(sql).toContain(`alter policy "${name}" on public.gathering_interest to authenticated`);
    }
  });
  test('anon loses every non-read privilege but keeps SELECT (other policies subquery this table)', () => {
    expect(sql).toMatch(/revoke insert, update, delete, truncate, references, trigger on public\.gathering_interest from anon/);
    expect(sql).not.toMatch(/revoke[^;]*\bselect\b[^;]*from anon/i);
  });
});
