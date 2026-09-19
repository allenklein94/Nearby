// Behavior events are private: owner-only, no direct client inserts, never surfaced to other users or businesses.
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261215_behavior_events.sql'), 'utf8');

test('RLS is on, only own rows are readable/deletable, and clients get no insert grant', () => {
  expect(sql).toMatch(/enable row level security/);
  expect(sql).toMatch(/for select to authenticated using \(user_id = auth\.uid\(\)\)/);
  expect(sql).toMatch(/for delete to authenticated using \(user_id = auth\.uid\(\)\)/);
  expect(sql).toMatch(/grant select, delete on public\.behavior_events to authenticated/);
  expect(sql).not.toMatch(/grant [^;]*insert[^;]*behavior_events/i);
});

test('the 90-day window, user deletion and account cascade exist', () => {
  expect(sql).toMatch(/interval '90 days'/);
  expect(sql).toMatch(/clear_my_behavior_history/);
  expect(sql).toMatch(/references public\.profiles\(id\) on delete cascade/);
});

test('no client code reads the behavior_events table directly (only the owner-scoped RPCs)', () => {
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p); } return out; };
  const readers = walk(path.join(__dirname, '..')).filter((f) => /from\(['"]behavior_events['"]\)/.test(fs.readFileSync(f, 'utf8')));
  expect(readers).toEqual([]);
});
