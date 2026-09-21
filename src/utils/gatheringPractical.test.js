import { practicalFacts, durationLabel, DURATION_OPTIONS, GENRE_OPTIONS, isMusicTag } from './gatheringPractical';

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
    expect(r('src/services/gatherings.js')).toMatch(/equipment_provided, duration_minutes, genre, features'/);
    for (const f of ['CreateGatheringScreen', 'EditGatheringScreen']) expect(r(`src/screens/${f}.js`)).toMatch(/setDurationMinutes/);
    for (const f of ['GatheringsScreen', 'GatheringDetailScreen']) expect(r(`src/screens/${f}.js`)).toMatch(/practicalFacts/);
  });
});

describe('genre (music gatherings only)', () => {
  it('shows only a declared genre, and is asked only for music tags', () => {
    expect(practicalFacts({ genre: 'jazz' })).toEqual(['🎵 Jazz']);
    expect(practicalFacts({ genre: 'nonsense' })).toEqual([]);
    expect(isMusicTag('Live Music')).toBe(true);
    expect(isMusicTag('Coffee')).toBe(false);
  });
  it('the client list equals the database CHECK, and music tags are real taxonomy', () => {
    const fs = require('fs'), path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270195_gathering_genre.sql'), 'utf8');
    const db = [...sql.match(/genre in \(([^)]*)\)/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(GENRE_OPTIONS.map((o) => o.key).filter(Boolean).sort()).toEqual(db);
    const { CATEGORY_GROUPS } = require('../constants/gatheringCategories');
    const tags = new Set(CATEGORY_GROUPS.flatMap((g) => g.tags));
    for (const t of require('./gatheringPractical').MUSIC_TAGS) expect(tags.has(t)).toBe(true);
  });
});
