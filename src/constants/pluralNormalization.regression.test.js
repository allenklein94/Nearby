// Owner item 182 (2026-10-03, LOCKED): a singular and its plural resolve identically through ONE plural rule, never by
// storing both forms as separate wordings. The rule has four copies that must stay identical: the app's singular()
// (categorySynonyms.js), the web signup page's applySingular() (docs/business.html), and the server's
// _category_singular() used by _category_phrase_key and _category_search_key (migration 20270279).
import fs from 'fs';
import path from 'path';
import { tagsForPhrase, singular, seedRows } from './categorySynonyms';
import { resolveAsk, toClassification } from '../utils/askResolver';

const classify = (text) => toClassification(resolveAsk(text, null)).category;
const root = path.join(__dirname, '../..');

describe('singular and plural resolve the same', () => {
  it.each([
    ['cafe', 'cafes', ['Coffee']],
    ['plumber', 'plumbers', ['Plumbing']],
    ['cooking class', 'cooking classes', ['Cooking Class']],
    ['art class', 'art classes', ['Art Classes']],
    ['dance class', 'dance classes', ['Dance Classes']],
    ['language class', 'language classes', ['Language Classes']],
    ['beach', 'beaches', ['Beaches']],
  ])('"%s" and "%s" both resolve to %j', (one, many, tags) => {
    expect(tagsForPhrase(one)).toEqual(tags);
    expect(tagsForPhrase(many)).toEqual(tags);
  });

  it('the typed-ask resolver agrees: Cooking Class stays the exact canonical category (never the Cooking hobby)', () => {
    expect(classify('cooking class')).toBe('Cooking Class');
    expect(classify('cooking classes')).toBe('Cooking Class');
  });

  it('"tutor" and "tutors" resolve the same (nothing today; Tutoring once its wording lands)', () => {
    expect(tagsForPhrase('tutors')).toEqual(tagsForPhrase('tutor'));
  });

  it('word pairs share one key', () => {
    for (const [a, b] of [['class', 'classes'], ['beach', 'beaches'], ['box', 'boxes'], ['dish', 'dishes'],
      ['lunch', 'lunches'], ['glass', 'glasses'], ['headache', 'headaches'], ['cafe', 'cafes'], ['tutor', 'tutors']]) {
      expect(singular(b)).toBe(singular(a));
    }
  });

  it('"certified" and "certification" both reach Certifications', () => {
    expect(tagsForPhrase('certified')).toEqual(['Certifications']);
    expect(tagsForPhrase('certification')).toEqual(['Certifications']);
  });

  it('no seeded synonym phrase repeats the plural of another (one row per wording)', () => {
    const phrases = new Set(seedRows().map((r) => r.phrase));
    for (const p of phrases) expect(p.split(' ').map(singular).join(' ')).toBe(p);
  });
});

describe('the four copies stay identical', () => {
  const WORDS = ['cafes', 'classes', 'class', 'beaches', 'boxes', 'dishes', 'glasses', 'headache', 'headaches', 'bus',
    'axes', 'business', 'businesses', 'gas', 'tennis', 'yes', 'ache', 'aches', 'niche', 'tutors', 'matches', 'posse',
    'charities', 'charity', 'movies', 'movie', 'patisserie', 'patisseries', 'galleries', 'pies', 'series', 'cookies'];

  it('the web signup page uses the same rule', () => {
    const html = fs.readFileSync(path.join(root, 'docs/business.html'), 'utf8');
    const m = html.match(/var APPLY_IE_NOUNS = [^\n]*\n  function applySingular\(w\) \{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    const web = new Function(`${m[0]}; return applySingular;`)();
    for (const w of WORDS) expect(web(w)).toBe(singular(w));
  });

  it('the server helper encodes the same three branches and both key functions call it', () => {
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20270279_plural_rule_and_certified.sql'), 'utf8');
    expect(sql).toMatch(/char_length\(w\) > 4 and w ~ '\(ss\|ch\|sh\|x\)es\$' then left\(w, -2\)/);
    expect(sql).toMatch(/char_length\(w\) > 3 and w ~ '\(ss\|ch\|sh\)e\$' then left\(w, -1\)/);
    expect(sql).toMatch(/char_length\(w\) > 4 and w !~ 'ss\$' then regexp_replace\(w, 's\$', ''\)/);
    expect(sql.match(/public\._category_singular\(w\)/g)).toHaveLength(2);
    const src = fs.readFileSync(path.join(root, 'src/constants/categorySynonyms.js'), 'utf8');
    expect(src).toMatch(/w\.length > 4 && \/\(ss\|ch\|sh\|x\)es\$\/\.test\(w\)\) return w\.slice\(0, -2\)/);
    expect(src).toMatch(/w\.length > 3 && \/\(ss\|ch\|sh\)e\$\/\.test\(w\)\) return w\.slice\(0, -1\)/);
  });
});

describe('-ies plurals follow ordinary English (item 183)', () => {
  it.each([
    ['charity', 'charities'], ['gallery', 'galleries'], ['library', 'libraries'], ['bakery', 'bakeries'],
    ['movie', 'movies'], ['patisserie', 'patisseries'], ['cookie', 'cookies'], ['brewery', 'breweries'],
    ['activity', 'activities'], ['party', 'parties'],
  ])('"%s" and "%s" share one key', (one, many) => {
    expect(singular(many)).toBe(singular(one));
  });

  it('singular words are never rewritten', () => {
    for (const w of ['patisserie', 'movie', 'cookie', 'charity', 'foodie', 'brasserie']) expect(singular(w)).toBe(w);
  });

  it('category search agrees', () => {
    expect(tagsForPhrase('charities')).toEqual(['Charity']);
    expect(tagsForPhrase('art galleries')).toEqual(tagsForPhrase('art gallery'));
    expect(tagsForPhrase('movies')).toEqual(['Movies']);
    expect(tagsForPhrase('movie')).toEqual(['Movies']);
    expect(tagsForPhrase('bakeries')).toEqual(['Bakeries']);
    expect(tagsForPhrase('patisseries')).toEqual(tagsForPhrase('patisserie'));
    expect(tagsForPhrase('kids activities')).toEqual(['Kids Activity']);
  });

  it('the web page and the server carry the same -ie exception list', () => {
    const { IE_SINGULAR_NOUNS } = require('./categorySynonyms');
    const html = fs.readFileSync(path.join(root, 'docs/business.html'), 'utf8');
    expect(JSON.parse(html.match(/var APPLY_IE_NOUNS = (\[.*\]);/)[1])).toEqual([...IE_SINGULAR_NOUNS]);
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20270280_ies_plurals_never_learn_faith.sql'), 'utf8');
    const arr = sql.match(/left\(w, -1\) = any \(array\[([^\]]*)\]\)/)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(arr).toEqual([...IE_SINGULAR_NOUNS]);
    expect(sql.match(/public\._category_singular\(w\)/g)).toBeNull(); // only redefines the helper; the key functions call it
  });
});
