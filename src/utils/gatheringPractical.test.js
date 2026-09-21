import { practicalFacts, durationLabel, DURATION_OPTIONS } from './gatheringPractical';

describe('host-declared practical facts (item 39)', () => {
  it('shows only what the host said', () => {
    expect(practicalFacts({})).toEqual([]);
    expect(practicalFacts({ equipment_provided: null, duration_minutes: null })).toEqual([]);
    expect(practicalFacts({ equipment_provided: true, duration_minutes: 90 })).toEqual(['🎾 Equipment provided', '⏱️ About 1.5 hr']);
    expect(practicalFacts({ equipment_provided: false })).toEqual(['🎒 Bring your own equipment']);
  });
  it('bad durations are never rendered', () => {
    for (const v of [null, undefined, 0, -5, 'x', NaN]) expect(durationLabel(v)).toBeNull();
    expect(durationLabel(45)).toBe('45 min');
  });
  it('every chip fits the database range and the wiring exists end to end', () => {
    for (const o of DURATION_OPTIONS.filter((x) => x.key)) expect(o.key).toBeGreaterThanOrEqual(15);
    const fs = require('fs'), path = require('path');
    const r = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
    expect(r('supabase/migrations/20270194_gathering_equipment_duration.sql')).toMatch(/between 15 and 720/);
    expect(r('src/services/gatherings.js')).toMatch(/equipment_provided, duration_minutes'/);
    for (const f of ['CreateGatheringScreen', 'EditGatheringScreen']) expect(r(`src/screens/${f}.js`)).toMatch(/setDurationMinutes/);
    for (const f of ['GatheringsScreen', 'GatheringDetailScreen']) expect(r(`src/screens/${f}.js`)).toMatch(/practicalFacts/);
  });
});
