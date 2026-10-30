import { behaviorEvidenceLines } from './behaviorCaseEvidence';

describe('behaviorEvidenceLines (20270363 admin review)', () => {
  test('one line per signal, counts only', () => {
    expect(behaviorEvidenceLines({ signals: [
      { kind: 'repeated_messages', conversations: 6, window_minutes: 60, chars: 48 },
      { kind: 'join_burst', gatherings: 15, window_minutes: 60 },
      { kind: 'location_switching', areas: 3, window_minutes: 60 },
      { kind: 'limit_burst', actions: ['group_message', 'name_change', 'photo_change'], window_minutes: 60 },
    ] })).toEqual([
      'Same message sent into 6 conversations within 60 min',
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
});
