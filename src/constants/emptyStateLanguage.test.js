import fs from 'fs';
import path from 'path';
import { EMPTY_STATES, emptyCopy } from './emptyStates';

const SRC = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const BANNED = /\bno data\b|\bno results\b|\bno items\b|nothing found|\bnull\b|\bundefined\b/i;

describe('empty-state language (item 80)', () => {
  it('every state has a specific title and a body, in plain words', () => {
    for (const [id, e] of Object.entries(EMPTY_STATES)) {
      expect(e.title.length).toBeGreaterThan(5);
      expect(e.body.length).toBeGreaterThan(15);
      expect(`${e.title} ${e.body}`).not.toMatch(BANNED);
      expect(e.title).not.toBe(e.body);
      expect(id).toMatch(/^[a-z_]+$/);
    }
  });
  it('fills variables and returns null for an unknown id', () => {
    expect(emptyCopy('places_search', { query: 'tacos' }).title).toBe('No places match "tacos"');
    expect(emptyCopy('nope')).toBeNull();
  });
  it('the owner-specified wording is intact', () => {
    expect(emptyCopy('plans_upcoming')).toEqual({ title: 'No upcoming plans', body: 'Find something nearby or start something new.' });
    expect(emptyCopy('business_opportunities')).toEqual({ title: 'No new opportunities', body: "We'll show requests from nearby customers here." });
  });
  it('every use names a registered id, and every registered id is used', () => {
    const files = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) files.push(full);
    });
    walk(SRC);
    const used = new Set();
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/EmptyCopy id=\{?['"]([a-z_]+)['"]/g)) used.add(m[1]);
      if (src.includes('EmptyCopy')) {
        // ids chosen by a ternary or a lookup table still name registry entries as quoted strings
        for (const id of Object.keys(EMPTY_STATES)) if (src.includes(`'${id}'`) || src.includes(`"${id}"`)) used.add(id);
      }
    }
    for (const id of used) expect(EMPTY_STATES[id]).toBeTruthy();
    for (const id of Object.keys(EMPTY_STATES)) expect(used.has(id)).toBe(true);
  });
  it('the converted screens no longer print database-voice empties', () => {
    for (const [f, re] of [['screens/BusinessDashboardScreen.js', /No data yet|No packages yet\.|No offers sent yet\./], ['screens/PlacesScreen.js', /Nothing found nearby/]]) {
      expect(read(f)).not.toMatch(re);
    }
  });
});
