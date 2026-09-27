// Typed-ask audit (owner item 105): pure-module and source guards. The resolver-driven checks are in
// services/typedAskAudit.resolver.test.js.
import fs from 'fs';
import path from 'path';
import {
  createScoreTrace, SIGNAL_CODES, UNRECORDED_PASSES, INTERPRETATION_FIELDS, sanitizeInterpretation, displayedIntentResults,
  buildTypedAskSnapshot, displayedPosition, TYPED_ASK_AUDIT_VERSION, remainingIntentItems, groupIntentResultsByType,
} from './typedAskAudit';

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const MIGRATION = read('../../supabase/migrations/20270238_typed_ask_audit.sql');

describe('score trace', () => {
  it('records the delta each named pass made, per result', () => {
    const start = [{ type: 'gathering', id: 'a', score: 3, baseSignals: [{ code: 'base_interest_match', delta: 2 }] }, { type: 'perk', id: 'b', score: 1 }];
    const t = createScoreTrace(start);
    const afterWeather = [{ ...start[0], score: 5 }, start[1]];
    t.step('weather', afterWeather);
    t.step('vibe', [{ ...afterWeather[0], score: 4 }, { ...start[1], score: 1 }]);
    expect(t.signalsFor(start[0])).toEqual([
      { code: 'base_interest_match', delta: 2 }, { code: 'base', delta: 1 }, { code: 'weather', delta: 2 }, { code: 'vibe', delta: -1 },
    ]);
    expect(t.signalsFor(start[1])).toEqual([{ code: 'base', delta: 1 }]);
  });

  it('counts removals per pass, never who or which business', () => {
    const a = { type: 'gathering', id: 'a', score: 1 };
    const b = { type: 'business_availability', id: 'b', score: 1 };
    const t = createScoreTrace([a, b], { removedBeforeStart: 2 });
    t.step('compatibility', [a]);
    expect(t.exclusions()).toEqual({ dedupe: 2, compatibility: 1 });
  });

  it('rebase records nothing (dietary / child age passes stay unrecorded)', () => {
    const a = { type: 'gathering', id: 'a', score: 1 };
    const t = createScoreTrace([a]);
    t.rebase([{ ...a, score: 3 }]);
    t.step('vibe', [{ ...a, score: 3 }]);
    expect(t.signalsFor(a)).toEqual([{ code: 'base', delta: 1 }]);
    expect(UNRECORDED_PASSES).toEqual(['dietary', 'suited_ages']);
  });

  it('never writes to a candidate or the list, and swallows its own errors', () => {
    const a = Object.freeze({ type: 'gathering', id: 'a', score: 1 });
    const list = Object.freeze([a]);
    const t = createScoreTrace(list);
    expect(() => t.step('weather', list)).not.toThrow();
    const hostile = [{ type: 'gathering', id: 'x', get score() { throw new Error('boom'); } }];
    expect(() => createScoreTrace(hostile)).not.toThrow();
    expect(() => createScoreTrace(null).step('weather', hostile)).not.toThrow();
    expect(() => t.step('not_a_code', list)).not.toThrow();
  });

  it('every trace call in resolveIntent uses a registered code, and the dietary/age passes are rebased, not stepped', () => {
    const src = read('../services/intentResolver.js');
    const codes = [...src.matchAll(/trace\.step\('([a-z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(25);
    for (const c of codes) expect(SIGNAL_CODES[c]).toBeDefined();
    expect(src).toMatch(/applyDietaryToCandidates\(deduped, dietaryFromAsk\(rawText\)\);\n\s*trace\.rebase\(deduped\)/);
    expect(codes).not.toContain('dietary');
  });
});

describe('interpretation', () => {
  it('keeps only known fields with vocabulary values; words never survive', () => {
    const out = sanitizeInterpretation({
      category: 'Coffee', party_size: 4, open_now: true, attributes: ['quiet', 'wheelchair_accessible'],
      raw_text: 'coffee with my dog', typed_text: 'x', title: 'Coffee with some friends near the old mill by the river please',
      exclude: ['alcohol'], clock_window: { after: 900, before: 1500 }, date_window: 'tonight', dietary: ['vegan'], child_ages: [5],
    });
    expect(out).toEqual({ category: 'Coffee', party_size: 4, open_now: true, attributes: ['quiet'], exclude: ['alcohol'],
      clock_window: { after: 900, before: 1500 }, date_window: 'tonight' });
  });

  it('a long sentence is refused even in a known field', () => {
    expect(sanitizeInterpretation({ category: 'I want somewhere quiet to take my mother for her birthday tomorrow' })).toEqual({});
  });

  it('the recordable field list is identical in the client and the server', () => {
    const sql = MIGRATION.match(/_typed_ask_interpretation_fields\(\)[\s\S]*?select array\[([\s\S]*?)\]::text\[\]/)[1];
    const server = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(server).toEqual(INTERPRETATION_FIELDS);
  });

  it('dietary needs, access needs and child ages are not recordable fields', () => {
    for (const f of ['dietary', 'dietary_needs', 'child_ages', 'suited_ages', 'accessibility', 'raw_text', 'text', 'title']) {
      expect(INTERPRETATION_FIELDS).not.toContain(f);
    }
    expect(MIGRATION).toMatch(/'wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly'/);
  });
});

describe('what was shown', () => {
  const g = (id, score = 1) => ({ type: 'gathering', id, score, title: `T ${id}` });
  const p = (id) => ({ type: 'perk', id, score: 1, partnerId: '11111111-1111-1111-1111-111111111111' });

  it('Home: experience rows first, then the remaining items grouped by type in first-seen order', () => {
    const result = {
      items: [g('a'), p('b'), g('c'), g('d')],
      experience: { bundles: [], components: [{ key: 'dinner', items: [g('d')] }], claimedIds: ['d'] },
    };
    const rows = displayedIntentResults('home', result);
    expect(rows.map((r) => [r.position, r.item.id, r.section])).toEqual([
      [1, 'd', 'component:dinner'], [2, 'a', 'type:gathering'], [3, 'c', 'type:gathering'], [4, 'b', 'type:perk'],
    ]);
    // the screen renders from these same two functions
    expect(groupIntentResultsByType(remainingIntentItems(result)).flatMap((x) => x.items).map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });

  it('Discover: the experience replaces the flat list; otherwise the list in order', () => {
    expect(displayedIntentResults('discover', { outcome: 'results', items: [g('a'), g('b')] }).map((r) => r.item.id)).toEqual(['a', 'b']);
    expect(displayedIntentResults('discover', {
      outcome: 'results', items: [g('a'), g('b')], experience: { bundles: [g('z')], components: [{ key: 'dinner', items: [g('b')] }] },
    }).map((r) => r.item.id)).toEqual(['z', 'b']);
    expect(displayedIntentResults('discover', { outcome: 'empty', items: [] })).toEqual([]);
  });

  it('snapshot: every shown result has type, id, position, business id and its signal codes', () => {
    const items = [g('a', 5), p('b')];
    const trace = createScoreTrace(items);
    const displayed = displayedIntentResults('discover', { outcome: 'results', items });
    const snap = buildTypedAskSnapshot({
      id: 'abc', surface: 'discover', submissionId: 's1', outcome: 'results', displayed,
      audit: { trace, candidateCount: 2, interpretation: { category: 'Coffee', raw_text: 'nope' } },
    });
    expect(snap).toMatchObject({ id: 'abc', surface: 'discover', rules_version: TYPED_ASK_AUDIT_VERSION, submission_id: 's1',
      outcome: 'results', interpretation: { category: 'Coffee' }, candidate_count: 2 });
    expect(snap.results).toEqual([
      { position: 1, section: 'list', result_type: 'gathering', result_id: 'a', partner_id: null, score: 5, signals: [{ code: 'base', delta: 5 }] },
      { position: 2, section: 'list', result_type: 'perk', result_id: 'b', partner_id: '11111111-1111-1111-1111-111111111111', score: 1, signals: [{ code: 'base', delta: 1 }] },
    ]);
    // no title, subtitle or any text of the result or the ask anywhere in the payload
    expect(JSON.stringify(snap)).not.toMatch(/T a|nope|title|subtitle|raw_text/);
    expect(displayedPosition(displayed, p('b'))).toBe(2);
    expect(displayedPosition(displayed, g('zz'))).toBeNull();
  });
});

describe('wiring and boundaries', () => {
  const home = read('../screens/HomeScreen.js');
  const discover = read('../screens/DiscoverHubScreen.js');

  it('Home and Discover record through the one writer, and link taps to the snapshot row', () => {
    expect(home.match(/recordTypedAsk\('home'/g).length).toBe(3); // community + resolver paths + refinement chips (item 107)
    expect(discover).toMatch(/recordTypedAsk\('discover', result\)/);
    for (const screen of [home, discover]) {
      expect(screen).toMatch(/snapshotId: shown\?\.snapshotId \?\? null/);
      expect(screen).toMatch(/resultPosition: displayedPosition\(shown\?\.displayed, item\)/);
      expect(screen).not.toMatch(/record_typed_ask_snapshot/);
      expect(screen).not.toMatch(/function groupIntentResultsByType/);
    }
    expect(home).toMatch(/remainingIntentItems\(intentResults\)/);
    expect(read('../services/intentResolver.js')).toMatch(/openNowOnly: openNowOnly === true, audit,/);
  });

  it('a request made from a result links back to the typed ask (existing submission id)', () => {
    expect(read('./businessAction.js')).toMatch(/prefillSubmissionId: submissionId/);
    expect(read('../services/intentOutcomes.js')).toMatch(/snapshot_id: snapshotId \?\? null/);
    expect(MIGRATION).toMatch(/br\.submission_id = s\.submission_id and br\.requester_id = s\.user_id/);
    expect(MIGRATION).toMatch(/gathering_interest g/);
  });

  it('no client can read the audit and no business-facing function references it', () => {
    expect(MIGRATION).toMatch(/revoke all on public\.typed_ask_snapshots, public\.typed_ask_results, public\.typed_ask_audit_failures from public, anon, authenticated/);
    expect(MIGRATION).toMatch(/revoke all on public\.typed_ask_result_outcomes from public, anon, authenticated/);
    expect(MIGRATION).not.toMatch(/grant select/i);
    expect(MIGRATION).toMatch(/grant execute on function public\.record_typed_ask_snapshot\(jsonb\) to authenticated/);
    const dir = path.join(__dirname, '../../supabase/migrations');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql') && x !== '20270238_typed_ask_audit.sql')) {
      expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/typed_ask_/);
    }
    const fnDir = path.join(__dirname, '../../supabase/functions');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(fnDir)) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/typed_ask_/);
  });

  it('no raw-text column in the audit tables', () => {
    const tables = MIGRATION.match(/create table if not exists public\.typed_ask_[\s\S]*?\);/g).join('\n');
    expect(tables).not.toMatch(/raw_text|typed_text|\btitle\b|\bquery\b|\bwords\b/);
  });
});
