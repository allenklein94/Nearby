import { RELATED_ACTIVITY_GROUPS, canonicalActivity, relatedActivities, isSameActivity, areRelatedActivities } from './activityDictionary';
import { SYNONYM_GROUPS, tagsForPhrase, expandSearchTerms, registerSynonyms } from './categorySynonyms';
import { CATEGORY_GROUPS } from './gatheringCategories';
import { relatedHobbyFor } from './hobbyRelations';
import { interestMatch } from '../utils/interestMatch';
import { describeTag } from './nearbyTaxonomy';

const ALL_TAGS = new Set(CATEGORY_GROUPS.flatMap((g) => [...g.tags, ...(g.businessOnlyTags ?? [])]));

describe('canonical activity dictionary (item 75)', () => {
  it('the coffee words all mean Coffee', () => {
    for (const w of ['coffee', 'cafe', 'café', 'coffee shop', 'coffeehouse']) expect(canonicalActivity(w)).toBe('Coffee');
  });
  it('pickleball words mean Pickleball; padel stays Padel', () => {
    for (const w of ['pickleball', 'pickle ball', 'paddle', 'pickleball courts']) expect(canonicalActivity(w)).toBe('Pickleball');
    for (const w of ['padel', 'Padel tennis', 'padel court']) expect(canonicalActivity(w)).toBe('Padel');
    expect(tagsForPhrase('padel')).not.toContain('Pickleball');
    expect(tagsForPhrase('pickleball')).not.toContain('Padel');
    expect(expandSearchTerms('padel')).toEqual(['padel']);
  });
  it('paddle boarding is not pickleball', () => {
    for (const w of ['paddle board', 'paddle boarding', 'paddleboard', 'stand up paddle']) expect(canonicalActivity(w)).toBe('Paddleboarding');
  });
  it('related but distinct', () => {
    expect(areRelatedActivities('Pickleball', 'Padel')).toBe(true);
    expect(areRelatedActivities('Padel', 'Tennis')).toBe(true);
    expect(isSameActivity('Pickleball', 'Padel')).toBe(false);
    expect(areRelatedActivities('Pickleball', 'Pickleball')).toBe(false);
    expect(relatedActivities('Padel')).toEqual(expect.arrayContaining(['Pickleball', 'Tennis']));
    expect(relatedActivities('Coffee')).toEqual([]);
    expect(describeTag('Padel').relatedActivities).toContain('Pickleball');
  });
  it('a related activity is a weak, labeled lift, never "you like"', () => {
    expect(relatedHobbyFor('Padel', ['Pickleball'])).toBe('Pickleball');
    expect(relatedHobbyFor('Pickleball', ['Pickleball'])).toBeNull();
    const m = interestMatch('Padel', { declared: ['Pickleball'] });
    expect(m.match_reason).toBe('Related to your interest in Pickleball');
    expect(m.match_reason).not.toMatch(/you like/i);
  });
  it('every tag in a related group is canonical, and groups do not repeat a tag', () => {
    const seen = new Set();
    for (const g of RELATED_ACTIVITY_GROUPS) for (const t of g) {
      expect(ALL_TAGS.has(t)).toBe(true);
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });
  it('no synonym phrase maps to two related activities (related is never the same)', () => {
    for (const { tags } of SYNONYM_GROUPS) for (const a of tags) for (const b of tags) expect(areRelatedActivities(a, b)).toBe(false);
  });
  it('a canonical tag name used as a synonym always keeps its own tag', () => {
    const lower = new Map([...ALL_TAGS].map((t) => [t.toLowerCase(), t]));
    for (const { tags, phrases } of SYNONYM_GROUPS) for (const p of phrases) {
      const own = lower.get(p.toLowerCase());
      if (own) expect(tags).toContain(own);
    }
  });
  it('a taught synonym can never redirect a canonical name to another tag', () => {
    expect(registerSynonyms([{ phrase: 'padel', tag: 'Pickleball' }])).toBe(0);
    expect(tagsForPhrase('padel')).toEqual(['Padel']);
  });
  it('the server refuses the same', () => {
    const sql = require('fs').readFileSync(require('path').join(__dirname, '../../supabase/migrations/20270213_activity_dictionary_padel.sql'), 'utf8');
    expect(sql).toMatch(/That phrase is already its own category/);
  });
});
