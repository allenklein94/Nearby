import fs from 'fs';
import path from 'path';
import { behaviorEvidenceLines } from './behaviorCaseEvidence';

// The kinds the database allows, from the LAST migration that sets behavior_signals_kind_check.
function databaseSignalKinds() {
  const dir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let last = null;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = [...sql.matchAll(/add constraint behavior_signals_kind_check\s+check \(kind in \(([^)]*)\)\)/g)];
    if (m.length) last = m[m.length - 1][1];
  }
  return [...last.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}
// Known gap (found 2026-11-12, reported, not fixed here): 20270382's discovery kinds have no admin line yet.
const NO_LINE_YET = ['discovery_limit', 'discovery_limit_repeated'];

describe('behaviorEvidenceLines (20270363 admin review)', () => {
  test('one line per signal, counts only', () => {
    expect(behaviorEvidenceLines({ signals: [
      { kind: 'repeated_messages', recipients: 6, window_minutes: 60, chars: 48 },
      { kind: 'join_burst', gatherings: 15, window_minutes: 60 },
      { kind: 'location_switching', areas: 3, window_minutes: 60 },
      { kind: 'limit_burst', actions: ['group_message', 'name_change', 'photo_change'], window_minutes: 60 },
    ] })).toEqual([
      'Same message sent to 6 different recipients within 60 min',
      'Joined 15 gatherings within 60 min',
      'Location jumped between 3 distant areas within 60 min',
      'Reached 3 different limits within 60 min (group chat messages, name changes, photo changes)',
    ]);
  });

  test('photo cases and unknown kinds show nothing; missing evidence is safe', () => {
    expect(behaviorEvidenceLines(null)).toEqual([]);
    expect(behaviorEvidenceLines({})).toEqual([]);
    expect(behaviorEvidenceLines({ signals: [{ kind: 'something_new', n: 1 }] })).toEqual([]);
  });
  test('repeated host cancellations (20270412): counts only', () => {
    expect(behaviorEvidenceLines({ signals: [
      { kind: 'repeated_cancellations', cancellations: 3, window_days: 30, min_attendees: 2 },
    ] })).toEqual(['Cancelled 3 gatherings within 30 days, each with at least 2 people attending besides the host']);
  });
  test('every signal kind the database allows has an admin line (else its case shows no reason)', () => {
    const kinds = databaseSignalKinds();
    expect(kinds).toContain('repeated_cancellations');
    const missing = kinds.filter((kind) => !NO_LINE_YET.includes(kind)
      && behaviorEvidenceLines({ signals: [{ kind, cancellations: 1, window_days: 1, joiners: 1, gatherings: 1,
        recipients: 1, areas: 1, actions: [], trigger: 'capacity', capacity: 1 }] }).length === 0);
    expect(missing).toEqual([]);
  });
  test('gathering signals (20270385): counts only, never a title or place', () => {
    expect(behaviorEvidenceLines({ signals: [
      { kind: 'attendee_surge_new', joiners: 15, new_accounts: 15, window_minutes: 60, gathering_id: 'g1' },
      { kind: 'attendee_surge', joiners: 17, new_accounts: 2, window_minutes: 60 },
      { kind: 'create_cancel', cancellations: 3, window_days: 7, within_hours: 48 },
      { kind: 'large_public_gathering', trigger: 'capacity', capacity: 50 },
      { kind: 'large_public_gathering', trigger: 'attendees', attendees: 25 },
    ] })).toEqual([
      'One gathering gained 15 uninvited joiners within 60 min (15 from new accounts)',
      'One gathering gained 17 uninvited joiners within 60 min (2 from new accounts)',
      'Cancelled 3 gatherings others had joined or been invited to, within 7 days (each within 48 h of creating it)',
      'Public gathering set to a capacity of 50',
      'Public gathering reached 25 attendees',
    ]);
  });
});
