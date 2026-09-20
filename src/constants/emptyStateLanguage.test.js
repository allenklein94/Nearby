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
  it('screens use only registered ids and no longer print database-voice empties', () => {
    const screens = ['PlansScreen', 'ActivityScreen', 'PlacesScreen', 'DiscoverHubScreen', 'BusinessDashboardScreen'];
    const used = new Set();
    for (const s of screens) {
      const src = read(`screens/${s}.js`);
      expect(src).toContain('EmptyCopy');
      for (const m of src.matchAll(/EmptyCopy id=\{?['"]([a-z_]+)['"]/g)) used.add(m[1]);
      expect(src).not.toMatch(/No data yet|Nothing found nearby/);
    }
    for (const id of ['plans_hosting', 'plans_past', 'plans_upcoming']) expect(read('screens/PlansScreen.js')).toContain(id);
    for (const id of used) expect(EMPTY_STATES[id]).toBeTruthy();
    for (const id of Object.keys(EMPTY_STATES)) {
      const all = screens.map((s) => read(`screens/${s}.js`)).join('\n');
      expect(all).toContain(id);
    }
  });
});
