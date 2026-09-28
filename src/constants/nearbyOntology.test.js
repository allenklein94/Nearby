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

// Item 131: the locked pipeline and which surfaces use which stage. Naming only; every stage points at a real source.
describe('the locked pipeline (item 131)', () => {
  const { NEARBY_PIPELINE, PIPELINE_KEYS, SURFACE_PIPELINE } = require('./nearbyOntology');

  it('has the owner\'s thirteen stages in order', () => {
    expect(PIPELINE_KEYS).toEqual(['category', 'subcategory', 'activity', 'tags', 'occasion', 'group', 'temporary_intent',
      'persistent_interests', 'hard_constraints', 'soft_preferences', 'eligibility', 'ranking', 'action']);
  });

  it('every stage is an ontology layer or names a real, existing source', () => {
    for (const s of NEARBY_PIPELINE) {
      if (s.layer) expect(ONTOLOGY_KEYS).toContain(s.layer);
      const client = s.client ?? ontologyLayer(s.layer)?.client;
      expect(client).toBeTruthy();
      const text = fs.readFileSync(path.join(SRC, client.file), 'utf8');
      expect([s.key, new RegExp(`export (const|function|async function) ${client.export}\\b`).test(text)]).toEqual([s.key, true]);
    }
  });

  it('covers the ten surfaces, each naming only real stages, never a stage it also uses', () => {
    expect(Object.keys(SURFACE_PIPELINE).sort()).toEqual(['analytics', 'business', 'celebrate', 'create', 'discover', 'gatherings', 'home', 'notifications', 'offers', 'people', 'search']);
    for (const [name, s] of Object.entries(SURFACE_PIPELINE)) expect([name, typeof s.population, typeof s.ordering]).toEqual([name, 'string', 'string']);
    for (const [name, s] of Object.entries(SURFACE_PIPELINE)) {
      for (const k of [...s.uses, ...Object.keys(s.never)]) expect([name, PIPELINE_KEYS.includes(k)]).toEqual([name, true]);
      for (const k of Object.keys(s.never)) expect([name, k, s.uses.includes(k)]).toEqual([name, k, false]);
    }
  });

  it('keeps the locked separations', () => {
    expect(SURFACE_PIPELINE.business.never.persistent_interests).toBeTruthy();
    expect(SURFACE_PIPELINE.home.never.temporary_intent).toBeTruthy();
    expect(SURFACE_PIPELINE.gatherings.never.temporary_intent).toBeTruthy();
    expect(SURFACE_PIPELINE.people.never.temporary_intent).toBeTruthy();
    expect(SURFACE_PIPELINE.notifications.never.ranking).toBeTruthy();
    expect(NEARBY_PIPELINE.find((s) => s.key === 'ranking').db).toMatch(/separate/);
  });
});

describe('item 131 audit guards', () => {
  const { SURFACE_PIPELINE, STAGE_CALLERS } = require('./nearbyOntology');
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__fixtures__') walk(p, out); } else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) && !/\.journey\.js$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const files = walk(SRC).map((f) => [path.relative(SRC, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')]);
  // real calls only (not comments); the stage's own defining files are exempt
  const CALL = /^(?!\s*(\/\/|\*)).*\b(resolveIntent|runIntentSearch|classifyCreateRequest|compareRanked|runAskEligibility)\(/m;
  const OWNERS = new Set(['constants/signalPriority.js', 'utils/askEligibility.js']);

  it('every file calling a stage entry point is registered under a surface', () => {
    for (const [rel, text] of files) {
      if (OWNERS.has(rel) || !CALL.test(text)) continue;
      expect([rel, STAGE_CALLERS[rel] ?? null]).toEqual([rel, expect.any(String)]);
      expect(SURFACE_PIPELINE[STAGE_CALLERS[rel]]).toBeTruthy();
    }
  });

  it('notifications and business-side code never call consumer ranking or ask stages', () => {
    const forbidden = /\b(compareRanked|resolveIntent|runIntentSearch|selectHomeAttention|rankGatheringFeed|compareDiscover|applySessionIntent|blendedCategoryScore)\b/;
    for (const [rel, text] of files) {
      if (/^services\/notifications|^screens\/Business|^services\/business|^utils\/business/.test(rel)) {
        const code = text.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
        expect([rel, forbidden.test(code)]).toEqual([rel, false]);
      }
    }
  });

  it('Create never prefills from profile interests (they only order the category picker)', () => {
    const create = fs.readFileSync(path.join(SRC, 'screens/CreateGatheringScreen.js'), 'utf8');
    const uses = create.split('\n').filter((l) => /\bmyInterests\b/.test(l) && !/useMyInterests\(\)/.test(l));
    expect(uses.length).toBeGreaterThan(0);
    for (const l of uses) expect(l).toMatch(/orderGroupsByInterests\(CATEGORY_GROUPS, myInterests\)/);
    for (const f of ['utils/askResolver.js', 'utils/gatheringInference.js', 'services/createAssistant.js']) {
      expect([f, /useMyInterests|profiles\.interests|from\('profiles'\)/.test(fs.readFileSync(path.join(SRC, f), 'utf8'))]).toEqual([f, false]);
    }
  });

  it('Home candidates are not cut by points before the shared ladder picks', () => {
    const { MAX_HOME_RECOMMENDATIONS } = require('../services/homeRecommendations');
    const { MAX_HOME_ATTENTION } = require('../utils/homeAttention');
    expect(MAX_HOME_RECOMMENDATIONS).toBeGreaterThan(MAX_HOME_ATTENTION * 2);
  });

  it('Browse paging has a stable order', () => {
    const t = fs.readFileSync(path.join(SRC, 'services/proximity.js'), 'utf8');
    expect(t).toMatch(/\.order\('id', \{ ascending: true \}\)\s*\n\s*\.range\(offset/);
  });
});

// Item 132: the entity links. Each names a real code path; the chain is connected end to end.
describe('entity links', () => {
  const { ENTITY_LINKS } = require('./nearbyOntology');
  it.each(ENTITY_LINKS.map((l) => [`${l.from} ${l.verb} ${l.to}`, l]))('%s has a real source', (_, l) => {
    const text = fs.readFileSync(path.join(SRC, l.client.file), 'utf8');
    expect(text).toMatch(new RegExp(`export (?:default )?(?:const|function|async function) ${l.client.export}\\b`));
  });
  it('forms one chain from business to transaction', () => {
    const order = ['business', 'activity', 'gathering', 'person', 'interest', 'recommendation', 'gathering', 'business_request', 'offer', 'transaction'];
    expect(ENTITY_LINKS.map((l) => l.from).concat(ENTITY_LINKS[ENTITY_LINKS.length - 1].to)).toEqual(order);
  });
});

describe('Activity -> Gathering (item 132)', () => {
  const { activitiesForGathering, gatheringActivityFit } = require('./activityLayer');
  it('a gathering fits an activity only through what its host declared', () => {
    expect(activitiesForGathering({ interest_tag: 'Coffee' })).toEqual(expect.arrayContaining(['grab_coffee', 'meet_a_friend']));
    expect(activitiesForGathering({ interest_tag: 'Hiking' })).toEqual([]);
    expect(activitiesForGathering({ interest_tag: 'Hiking', party_type: 'groups' })).toContain('group_hangout');
    expect(activitiesForGathering({})).toEqual([]);
  });
  it('occasion-only activities never fit a gathering (it declares no occasions)', () => {
    expect(activitiesForGathering({ interest_tag: 'Coffee', party_type: 'date', features: ['quiet'] })).not.toContain('first_date');
  });
  it('fit gives the same reason wording as a business', () => {
    expect(gatheringActivityFit({ interest_tag: 'Coffee' }, ['grab_coffee'])).toEqual({ key: 'grab_coffee', reason: 'Good for grabbing a coffee' });
    expect(gatheringActivityFit({ interest_tag: 'Coffee' }, [])).toBeNull();
    expect(gatheringActivityFit({ interest_tag: 'Hiking' }, ['grab_coffee'])).toBeNull();
  });
  it('the resolver ranks gatherings by it', () => {
    const src = fs.readFileSync(path.join(SRC, 'services/intentResolver.js'), 'utf8');
    expect(src).toMatch(/gatheringActivityFit\(gathering, askedActivities\)/);
    expect(src).toMatch(/code: 'base_activity_fit', delta: activityHit \? SCORE_ACTIVITY_FIT : 0/);
  });
});
