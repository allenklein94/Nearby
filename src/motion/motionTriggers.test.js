// Owner item 162 (2026-10-18): every registered animation sequence names its truthful trigger (MOTION_TRIGGERS in
// constants/motionLanguage.js). Server-backed ones name the stored state and the server function that changes or reads it;
// client ones name their real source (clock, weather, a tap, the typed words, a rule over real data) without inventing a
// server event. Documentation only: it authorizes no motion and no event (item 125), and no trigger may claim delivery.
const fs = require('fs');
const path = require('path');
const { MOTION_TRIGGERS, MOTION_TRIGGER_KINDS, MOTION_PRIMITIVES, MARKETPLACE_MOMENTS } = require('../constants/motionLanguage');
const { SEQUENCES, MOTION_BUDGET } = require('./motionBudget');

const SRC = path.join(__dirname, '..');
const MIGRATIONS = path.join(SRC, '..', 'supabase', 'migrations');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const TIERS = new Set(Object.keys(MOTION_BUDGET));
const sequenceKeys = Object.keys(SEQUENCES).filter((k) => SEQUENCES[k] && TIERS.has(SEQUENCES[k].tier));
const SERVER_KINDS = new Set(['server_change', 'server_read']);
const migrationSql = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')).join('\n');

test('every registered sequence has a documented trigger; no stale entry', () => {
  expect(Object.keys(MOTION_TRIGGERS).sort()).toEqual([...sequenceKeys].sort());
  expect(Object.keys(MOTION_TRIGGERS).sort()).toEqual(Object.keys(MOTION_PRIMITIVES).sort());
});

test('each trigger has a known kind, a plain description and only the documented fields', () => {
  for (const [key, t] of Object.entries(MOTION_TRIGGERS)) {
    expect([key, MOTION_TRIGGER_KINDS.includes(t.kind)]).toEqual([key, true]);
    expect([key, typeof t.state === 'string' && t.state.length > 20]).toEqual([key, true]);
    expect([key, Object.keys(t).every((f) => ['kind', 'actions', 'plays', 'state'].includes(f))]).toEqual([key, true]);
  }
});

test('server-backed triggers name stored state and only server functions that really exist', () => {
  for (const [key, t] of Object.entries(MOTION_TRIGGERS)) {
    if (!SERVER_KINDS.has(t.kind)) continue;
    expect([key, Array.isArray(t.actions)]).toEqual([key, true]);
    // a stored row or column (snake_case table / column name) or the function that returns it
    expect([key, /\b[a-z]+_[a-z_]+\b/.test(t.state) || t.actions.length > 0]).toEqual([key, true]);
    for (const fn of t.actions) {
      expect([key, fn, new RegExp(`function\\s+(public\\.)?${fn}\\s*\\(`, 'i').test(migrationSql)]).toEqual([key, fn, true]);
    }
  }
  // the example the owner gave
  expect(MOTION_TRIGGERS.offerAccepted).toMatchObject({ kind: 'server_change', actions: ['accept_business_offer'] });
  expect(MOTION_TRIGGERS.offerAccepted.state).toMatch(/business_request_offers\.status = 'accepted'/);
});

test('client-side triggers name their real source and invent no server action', () => {
  for (const [key, t] of Object.entries(MOTION_TRIGGERS)) {
    if (SERVER_KINDS.has(t.kind)) continue;
    expect([key, t.actions === undefined]).toEqual([key, true]);
  }
  expect(MOTION_TRIGGERS.offerCountdown.kind).toBe('clock');
  expect(MOTION_TRIGGERS.weatherShift.kind).toBe('weather');
  expect(MOTION_TRIGGERS.refineNextStep.kind).toBe('tap');
  expect(MOTION_TRIGGERS.pinToSheet.kind).toBe('tap');
  expect(MOTION_TRIGGERS.askUnderstood.kind).toBe('words');
});

test('the files that play each sequence exist and really use it', () => {
  for (const [key, t] of Object.entries(MOTION_TRIGGERS)) {
    expect([key, Array.isArray(t.plays) && t.plays.length > 0]).toEqual([key, true]);
    for (const rel of t.plays) {
      expect([key, rel, fs.existsSync(path.join(SRC, rel))]).toEqual([key, rel, true]);
    }
    // a file reads the sequence, or the marketplace registry names that file as the moment playing it (the signature:
    // OfferTravelOverlay runs businessResponds on offerTravel's own tokens)
    const registered = MARKETPLACE_MOMENTS.some((m) => m.sequence === key && t.plays.includes(m.component));
    const uses = registered || t.plays.some((rel) => new RegExp(`SEQUENCES\\.${key}\\b|['"]${key}['"]`).test(read(rel)));
    expect([key, uses]).toEqual([key, true]);
  }
});

test('no trigger claims delivery or that someone saw a notification (item 159)', () => {
  for (const [key, t] of Object.entries(MOTION_TRIGGERS)) {
    expect([key, /deliver|\bseen\b|\bopened\b|read receipt/i.test(t.state)]).toEqual([key, false]);
  }
  expect(Object.keys(MOTION_TRIGGERS).some((k) => /deliver/i.test(k))).toBe(false);
});

test('documentation only: no component reads the table, and it names no domain event (item 125)', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'qa' ? [] : walk(p); // src/qa = idea 391's generated reference, never app code
    return /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : [];
  });
  const readers = walk(SRC).filter((f) => !f.endsWith(path.join('constants', 'motionLanguage.js')) && /MOTION_TRIGGERS/.test(fs.readFileSync(f, 'utf8')));
  expect(readers).toEqual([]);
  const { DOMAIN_EVENTS } = require('../constants/domainEvents');
  for (const [key, t] of Object.entries(MOTION_TRIGGERS)) {
    for (const ev of DOMAIN_EVENTS) expect([key, t.state.includes(ev)]).toEqual([key, false]);
  }
});
