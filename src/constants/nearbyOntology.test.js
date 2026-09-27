const fs = require('fs');
const path = require('path');
const { NEARBY_ONTOLOGY, ONTOLOGY_KEYS, ontologyLayer } = require('./nearbyOntology');

const SRC = path.join(__dirname, '..');

describe('Nearby ontology (item 60)', () => {
  it('has the fifteen layers in the owner\'s order', () => {
    expect(ONTOLOGY_KEYS).toEqual([
      'entity', 'category', 'subcategory', 'activity', 'tags', 'occasion', 'group', 'time',
      'location', 'budget', 'availability', 'social_signal', 'business_signal', 'state', 'action',
    ]);
  });

  it('every layer asks one question and names a real, existing client source', () => {
    for (const layer of NEARBY_ONTOLOGY) {
      expect(layer.question).toMatch(/\?$/);
      const file = path.join(SRC, layer.client.file);
      expect(fs.existsSync(file)).toBe(true);
      const text = fs.readFileSync(file, 'utf8');
      expect(text).toMatch(new RegExp(`export (const|function|async function) ${layer.client.export}\\b`));
    }
  });

  it('owns no data of its own (every layer points somewhere else)', () => {
    const text = fs.readFileSync(path.join(__dirname, 'nearbyOntology.js'), 'utf8');
    expect(text).not.toMatch(/^import /m);
  });

  it('keeps the locked privacy notes on the social layer', () => {
    expect(ontologyLayer('social_signal').note).toMatch(/friends only/);
    expect(ontologyLayer('social_signal').note).toMatch(/Interested is private/);
    expect(ontologyLayer('business_signal').db).toMatch(/floor 5/);
    expect(ontologyLayer('nope')).toBeNull();
  });
});

// ENTITY -> STATE -> ACTION (owner item 100): naming only. These guards keep the existing lifecycle table and
// objectState.js the ONE source, so the named layers cannot drift into a second definition.
describe('ENTITY and STATE layers (item 100)', () => {
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
  function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out); else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
    }
    return out;
  }
  const exportsOf = (rel) => [...read(rel).matchAll(/export (?:const|function|async function) (\w+)/g)].map((m) => m[1]);

  it('names ENTITY from the lifecycle table and STATE from objectState.js', () => {
    expect(ontologyLayer('entity').client).toEqual({ file: 'utils/objectLifecycle.js', export: 'LIFECYCLE' });
    expect(ontologyLayer('state').client.file).toBe('utils/objectState.js');
    expect(ontologyLayer('action').client).toEqual({ file: 'utils/objectLifecycle.js', export: 'canDo' });
    // state sits right before action: the action comes from the state
    expect(ONTOLOGY_KEYS.indexOf('state')).toBe(ONTOLOGY_KEYS.indexOf('action') - 1);
  });

  it('the entity kinds are the lifecycle table\'s keys, and every kind lists its states', () => {
    const { LIFECYCLE, canDo } = require('../utils/objectLifecycle');
    const kinds = Object.keys(LIFECYCLE);
    expect(kinds).toEqual(expect.arrayContaining(['gathering', 'request', 'offer', 'invite']));
    for (const kind of kinds) {
      const states = Object.keys(LIFECYCLE[kind]);
      expect(states.length).toBeGreaterThan(0);
      for (const state of states) for (const action of LIFECYCLE[kind][state]) expect(canDo(kind, state, action)).toBe(true);
    }
    expect(canDo('nope', 'x', 'view')).toBe(false);
  });

  it('the lifecycle table derives time states from objectState.js, and the CTA table reads both (not bypassed)', () => {
    expect(read('utils/objectLifecycle.js')).toMatch(/from '\.\/objectState'/);
    const primary = read('utils/primaryAction.js');
    expect(primary).toMatch(/from '\.\/objectLifecycle'/);
    expect(primary).toMatch(/from '\.\/objectState'/);
  });

  // Pre-existing, reviewed 2026-09-27 and NOT changed (freeze): a plan-status DISPLAY label ('Planning' ... 'Cancelled')
  // for a business request read as a plan. It permits no action; it is recorded here so no further table joins it.
  const KNOWN_DISPLAY_STATUS_TABLES = ['utils/planAddonReadiness.js'];

  it('no second definition of any lifecycle or state function, and no second lifecycle table', () => {
    const owners = { 'utils/objectState.js': exportsOf('utils/objectState.js'), 'utils/objectLifecycle.js': exportsOf('utils/objectLifecycle.js') };
    const names = [...owners['utils/objectState.js'], ...owners['utils/objectLifecycle.js']];
    expect(names).toEqual(expect.arrayContaining(['LIFECYCLE', 'canDo', 'gatheringViewerState', 'isGatheringPast', 'isOfferExpired']));
    const offenders = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file);
      if (owners[rel]) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const n of names) {
        if (new RegExp(`(function\\s+${n}\\s*\\(|(const|let|var)\\s+${n}\\s*=)`).test(text)) offenders.push(`${rel}: ${n}`);
      }
      if (!KNOWN_DISPLAY_STATUS_TABLES.includes(rel)
          && /\b(const|let|var)\s+\w*(LIFECYCLE|STATE_MACHINE|OBJECT_STATES)\w*\s*=/.test(text)) offenders.push(`${rel}: lifecycle-like table`);
    }
    expect(offenders).toEqual([]);
  });
});
