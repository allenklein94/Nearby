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

describe('legacy entries view is read-only (migration 20270140)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270140_legacy_entries_view_read_only.sql'), 'utf8').replace(/--.*$/gm, '');
  test('all privileges revoked, then SELECT to authenticated only', () => {
    expect(sql).toMatch(/revoke all on public\.relationship_legacy_entries_public from anon, authenticated/);
    expect(sql).toMatch(/grant select on public\.relationship_legacy_entries_public to authenticated;/);
    expect(sql).not.toMatch(/grant[^;]*\b(insert|update|delete)\b/i);
    expect(sql).not.toMatch(/to anon/);
  });
  test('the view stays owner-rights (the base table SELECT is intentionally closed)', () => {
    expect(sql).not.toMatch(/security_invoker/i);
  });
});

describe('anon write privileges revoked (migrations 20270141 / 20270142)', () => {
  const strip = (f) => fs.readFileSync(path.join(__dirname, '../../supabase/migrations', f), 'utf8').replace(/--.*$/gm, '');
  const writes = strip('20270141_anon_write_privileges_revoked.sql');
  const maintain = strip('20270142_anon_maintain_privilege_revoked.sql');
  test('every write-class privilege is revoked from anon on all public tables, and defaults are closed', () => {
    expect(writes).toMatch(/revoke insert, update, delete, truncate, references, trigger on public\.%I from anon/);
    expect(writes).toMatch(/alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon/);
  });
  test('the ONLY anon write grant is INSERT on business_acquisition_events (public landing page)', () => {
    const grants = writes.match(/grant [^;]*;/gi) ?? [];
    expect(grants).toEqual(['grant insert on public.business_acquisition_events to anon;']);
  });
  test('anon SELECT is never revoked (cross-table policies subquery these tables)', () => {
    expect(writes).not.toMatch(/revoke[^;]*\bselect\b/i);
    expect(maintain).not.toMatch(/revoke[^;]*\bselect\b/i);
  });
  test('MAINTAIN revoke is guarded by server version (replay image is PG15)', () => {
    expect(maintain).toMatch(/server_version_num'\)::int >= 170000/);
  });
});
