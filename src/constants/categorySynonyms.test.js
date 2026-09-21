import { SYNONYM_GROUPS, tagsForPhrase, expandSearchTerms, seedRows } from './categorySynonyms';
import { CATEGORY_GROUPS } from './gatheringCategories';

const ALL_TAGS = new Set(CATEGORY_GROUPS.flatMap((g) => [...g.tags, ...(g.businessOnlyTags ?? [])]));

describe('search synonyms', () => {
  it('every synonym maps to a real canonical tag', () => {
    for (const g of SYNONYM_GROUPS) for (const t of g.tags) expect(ALL_TAGS.has(t)).toBe(true);
  });
  it('the owner examples', () => {
    expect(tagsForPhrase('cafe')).toContain('Coffee');
    expect(tagsForPhrase('Café')).toContain('Coffee');
    expect(tagsForPhrase('coffee shop')).toContain('Coffee');
    expect(tagsForPhrase('Coffeehouse')).toContain('Coffee');
    expect(tagsForPhrase('coffee place')).toContain('Coffee');
    expect(tagsForPhrase('specialty coffee')).toContain('Coffee');
    expect(tagsForPhrase('gym')).toEqual(expect.arrayContaining(['Gyms', 'Fitness']));
    expect(tagsForPhrase('fitness center')).toContain('Gyms');
    expect(tagsForPhrase('happy hour')).toEqual(expect.arrayContaining(['Happy Hour', 'Bars & Lounges']));
  });
  it('a canonical tag finds itself, including future ones like Padel', () => {
    expect(tagsForPhrase('yoga')).toEqual(['Yoga']);
    expect(tagsForPhrase('wine')).toContain('Wine');
  });
  it('plural and a phrase inside a longer query match; a partial word does not', () => {
    expect(tagsForPhrase('cafes')).toContain('Coffee');
    expect(tagsForPhrase('best cafe near me')).toContain('Coffee');
    expect(tagsForPhrase('barcelona')).toEqual([]);
    expect(tagsForPhrase('xyz unknown thing')).toEqual([]);
  });
  it('expandSearchTerms keeps the person\'s words first and adds canonical tags once', () => {
    expect(expandSearchTerms('cafe')).toEqual(['cafe', 'Coffee']);
    expect(expandSearchTerms('coffee')).toEqual(['coffee']);
    expect(expandSearchTerms('')).toEqual([]);
  });
  it('seed rows are unique (phrase, tag) pairs', () => {
    const rows = seedRows().map((r) => `${r.phrase}|${r.tag}`);
    expect(new Set(rows).size).toBe(rows.length);
  });
});

describe('database seed', () => {
  const fs = require('fs');
  const path = require('path');
  it('migration 20270190 seeds exactly the client synonym rows', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270190_category_synonyms.sql'), 'utf8');
    const rows = [...sql.matchAll(/^\s+\('((?:[^']|'')+)', '((?:[^']|'')+)'\),?$/gm)].map((m) => `${m[1].replace(/''/g, "'")}|${m[2].replace(/''/g, "'")}`);
    const expected = seedRows().map((r) => `${r.phrase}|${r.tag}`);
    expect(rows.sort()).toEqual(expected.sort());
  });
  it('search services expand through the one synonym table', () => {
    const rd = (f) => fs.readFileSync(path.join(__dirname, '../services', f), 'utf8');
    expect(rd('gatherings.js')).toMatch(/tagsForPhrase\(term\)/);
    expect(rd('communities.js')).toMatch(/tagsForPhrase\(term\)/);
    expect(rd('brandOffers.js')).toMatch(/expandSearchTerms\(term\)/);
  });
});
