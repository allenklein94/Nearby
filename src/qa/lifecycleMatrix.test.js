// Owner idea "391": the generated lifecycle matrix (PRODUCT_AUDIT/LIFECYCLE_MATRIX.md) must equal what the code produces now,
// and its crosswalks must stay complete. Rewrite with `npm run lifecycle-matrix` (LIFECYCLE_MATRIX_WRITE=1).
// What this guards: the file vs the code (every cell), every LIFECYCLE kind/state present, the declared crosswalks covering
// every screen a push opens to / every domain event, and the flag list (a NEW conflict or gap fails until reviewed).
// What it cannot guard: server-side behaviour (which push a state sends, a transition's target state): see the Flags section.
const fs = require('fs');
const path = require('path');
jest.mock('../services/supabase', () => ({ supabase: {} }));
jest.mock('../services/celebrateSomething', () => ({ extractNameFromBirthdayTitle: () => null }));
const { buildMatrix, renderMarkdown, EVENT_STATE, SCREEN_KIND, RETIRED_PUSH } = require('./lifecycleMatrix');
const { LIFECYCLE } = require('../utils/objectLifecycle');
const { DOMAIN_EVENTS } = require('../constants/domainEvents');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'PRODUCT_AUDIT', 'LIFECYCLE_MATRIX.md');

function appSources(dir = path.join(ROOT, 'src'), acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'qa') appSources(p, acc); }
    else if (/\.js$/.test(e.name) && !/\.(test|journey)\.js$/.test(e.name)) acc.push(fs.readFileSync(p, 'utf8'));
  }
  return acc;
}

let m;
let md;
beforeAll(async () => {
  m = await buildMatrix({
    destinationSource: fs.readFileSync(path.join(ROOT, 'src/navigation/notificationDestinations.js'), 'utf8'),
    appSources: appSources(),
  });
  md = renderMarkdown(m);
  if (process.env.LIFECYCLE_MATRIX_WRITE) fs.writeFileSync(OUT, md);
});

test('PRODUCT_AUDIT/LIFECYCLE_MATRIX.md equals what the code produces (run `npm run lifecycle-matrix` after a change)', () => {
  expect(fs.readFileSync(OUT, 'utf8')).toBe(md);
});

test('every LIFECYCLE kind and state appears in the matrix', () => {
  for (const [kind, states] of Object.entries(LIFECYCLE)) {
    for (const s of Object.keys(states)) expect(m.kinds[kind].some((r) => r.state === s)).toBe(true);
  }
});

test('crosswalks are complete: every domain event has a state that exists in LIFECYCLE', () => {
  for (const e of DOMAIN_EVENTS) {
    const [kind, state] = EVENT_STATE[e];
    expect(LIFECYCLE[kind][state]).toBeDefined();
  }
});

test('every push type opens somewhere, and every lifecycle screen in SCREEN_KIND is really a push destination', () => {
  expect(m.push.length).toBeGreaterThan(80);
  for (const p of m.push) expect(p.screens.length).toBeGreaterThan(0);
  const opened = new Set(m.push.flatMap((p) => p.screens));
  for (const s of Object.keys(SCREEN_KIND)) expect(opened.has(s)).toBe(true);
});

test('no CTA or animation conflicts with LIFECYCLE (a new conflict fails until reviewed)', () => {
  expect(m.flags.filter(([k]) => k === 'conflict')).toEqual([]);
});

test('every push marked retired is named by its retirement guard and is still a routed type', () => {
  for (const [type, guard] of Object.entries(RETIRED_PUSH)) {
    expect(fs.readFileSync(path.join(ROOT, 'src', guard), 'utf8')).toContain(type);
    expect(m.push.some((p) => p.type === type)).toBe(true);
  }
});
