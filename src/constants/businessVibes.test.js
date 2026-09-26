import { VIBES, VIBE_KEYS, vibesFromAsk, vibesToSink, applyVibeSinks, matchedVibeLabels } from './businessVibes';
import { BUSINESS_ATTRIBUTE_OPTIONS, VENUE_PREFERENCE_OPTIONS } from './businessAttributes';
import { attributesFromAsk } from './askFacets';
import { extractAttributesFromText } from './businessAttributeExtraction';
import { attributeAndCuisineBonus, getBusinessAvailabilityReasons } from '../services/intentResolverScoring';

describe('vibe (item 83): a named view over the one attribute vocabulary', () => {
  it('every vibe is a real attribute key; no second store', () => {
    const keys = BUSINESS_ATTRIBUTE_OPTIONS.map((o) => o.key);
    for (const k of VIBE_KEYS) expect(keys).toContain(k);
    expect(VIBES.map((v) => v.label)).toEqual(['Casual', 'Upscale', 'Romantic', 'Lively', 'Quiet', 'Trendy', 'Family-friendly', 'Relaxed', 'Social', 'Cozy', 'Professional']);
    expect(VIBES.find((v) => v.key === 'lively').alsoCalled).toEqual(['Energetic']);
    // vibes are ordinary preferences, not business-only
    for (const k of ['lively', 'trendy', 'cozy', 'relaxed', 'social', 'professional']) expect(VENUE_PREFERENCE_OPTIONS.map((o) => o.key)).toContain(k);
  });

  it('"I want somewhere relaxed and quiet" asks for both', () => {
    expect(vibesFromAsk('I want somewhere relaxed and quiet')).toEqual({ want: expect.arrayContaining(['relaxed', 'quiet']), avoid: [] });
    expect(attributesFromAsk('I want somewhere relaxed and quiet')).toEqual(expect.arrayContaining(['relaxed', 'quiet']));
  });

  it('each word maps to its vibe; energetic is lively; family-friendly is kid_friendly', () => {
    const one = (t) => vibesFromAsk(t).want;
    expect(one('a casual lunch spot')).toEqual(['casual']);
    expect(one('somewhere upscale for dinner')).toEqual(['upscale']);
    expect(one('a romantic dinner')).toEqual(['romantic']);
    expect(one('an energetic bar')).toEqual(['lively']);
    expect(one('a trendy cafe')).toEqual(['trendy']);
    expect(one('family-friendly brunch')).toEqual(['kid_friendly']);
    expect(one('a cozy coffee shop')).toEqual(['cozy']);
    expect(one('a social spot to meet up')).toEqual(['social']);
    expect(one('coffee for a client meeting')).toEqual(['professional']);
  });

  it('negations become avoids, never asks', () => {
    expect(vibesFromAsk('nothing too lively')).toEqual({ want: [], avoid: ['lively'] });
    expect(vibesFromAsk('not too quiet please')).toEqual({ want: [], avoid: ['quiet'] });
    expect(vibesFromAsk('dinner, nothing fancy')).toEqual({ want: ['casual'], avoid: ['upscale'] });
    expect(attributesFromAsk('nothing too lively')).not.toContain('lively');
  });

  it('look-alikes are not vibes', () => {
    for (const t of ['a casual game of pickleball', 'professional development class', 'social media workshop', 'casual dating', 'a professional photographer']) {
      expect(vibesFromAsk(t).want).toEqual([]);
    }
  });

  it('opposites sink a little; a declared match lifts through the existing overlap; undeclared untouched; nothing removed', () => {
    expect(vibesToSink({ want: ['quiet'] })).toEqual(['lively']);
    expect(vibesToSink({ want: ['casual'] })).toEqual(['upscale']);
    expect(vibesToSink({ want: ['quiet', 'lively'] })).toEqual(['relaxed']); // both asked: neither sinks the other
    const cands = [{ id: 'calm', score: 5, attributes: ['quiet', 'relaxed'] }, { id: 'loud', score: 5, attributes: ['lively'] }, { id: 'unknown', score: 5 }];
    const out = applyVibeSinks(cands, vibesFromAsk('somewhere relaxed and quiet'));
    expect(out.map((c) => c.score)).toEqual([5, 4, 5]);
    expect(out).toHaveLength(3);
    const asked = attributesFromAsk('somewhere relaxed and quiet');
    expect(attributeAndCuisineBonus({ attributes: ['quiet', 'relaxed'] }, asked, null)).toBeGreaterThan(0);
    expect(getBusinessAvailabilityReasons({ attributes: ['quiet', 'relaxed'] }, { attributes: asked })).toContain('Quiet · Relaxed');
    expect(matchedVibeLabels(['relaxed', 'quiet', 'wifi'], ['quiet', 'relaxed'])).toEqual(['Quiet', 'Relaxed']);
  });

  it('"Teach Nearby" finds the new vibes from plain text; relaxed is no longer read as casual', () => {
    expect(extractAttributesFromText('A cozy, laid-back neighborhood bar')).toEqual(expect.arrayContaining(['cozy', 'relaxed']));
    expect(extractAttributesFromText('A cozy, laid-back neighborhood bar')).not.toContain('casual');
    expect(extractAttributesFromText('Lively and energetic with communal tables')).toEqual(expect.arrayContaining(['lively', 'social']));
    expect(extractAttributesFromText('Great for client meetings')).toContain('professional');
    expect(extractAttributesFromText('A relationship coach')).not.toContain('trendy');
  });

  it('wiring: the resolver sinks declared opposites', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../services/intentResolver.js'), 'utf8');
    expect(src).toMatch(/applyVibeSinks\(deduped, vibesFromAsk\(rawText\)\)/);
  });
});

describe('vibes are normalized to canonical tags (item 84)', () => {
  const { VIBE_SYNONYMS } = require('./businessVibes');
  it('chill, chilled, laid back, relaxed, low-key and calm are ONE vibe, for a person asking and an owner describing', () => {
    for (const w of ['chill', 'chilled', 'laid back', 'laid-back', 'relaxed', 'low-key', 'low key', 'lowkey', 'calm', 'mellow', 'easygoing']) {
      expect(vibesFromAsk(`somewhere ${w} tonight`).want).toEqual(['relaxed']);
      expect(extractAttributesFromText(`A ${w} neighborhood spot`).filter((k) => VIBE_KEYS.includes(k))).toEqual(['relaxed']);
    }
  });
  it('every phrase belongs to exactly one vibe, and every vibe key is canonical', () => {
    const seen = new Map();
    for (const [key, { phrases }] of Object.entries(VIBE_SYNONYMS)) {
      expect(VIBE_KEYS).toContain(key);
      for (const p of phrases) {
        const n = p.toLowerCase().replace(/-/g, ' ');
        expect(seen.get(n) ?? key).toBe(key);
        seen.set(n, key);
      }
    }
    expect(Object.keys(VIBE_SYNONYMS).sort()).toEqual([...VIBE_KEYS].sort());
  });
  it('drinks and food are not vibes', () => {
    expect(vibesFromAsk('chilled wine and a chill out playlist').want).toEqual(['relaxed']);
    expect(vibesFromAsk('a glass of chilled wine').want).toEqual([]);
    expect(extractAttributesFromText('We serve chilled beers and a chili of the day')).not.toContain('relaxed');
  });
  it('no second vibe word list exists: extraction and ask rules defer to the table', () => {
    const fs = require('fs'), path = require('path');
    const ext = fs.readFileSync(path.join(__dirname, 'businessAttributeExtraction.js'), 'utf8');
    const block = ext.slice(ext.indexOf('const KEYWORDS_BY_ATTRIBUTE'), ext.indexOf('};', ext.indexOf('const KEYWORDS_BY_ATTRIBUTE')));
    for (const k of VIBE_KEYS) expect(block).not.toMatch(new RegExp(`\\n\\s+${k}:`));
    const ask = fs.readFileSync(path.join(__dirname, 'askFacets.js'), 'utf8');
    for (const k of VIBE_KEYS) expect(ask).not.toMatch(new RegExp(`\\['${k}',`));
  });
  it('a business cannot invent a vibe: every attribute writer is a closed list enforced by the database', () => {
    const fs = require('fs'), path = require('path');
    const mig = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270219_business_vibes.sql'), 'utf8');
    expect((mig.match(/<@ array\[' \|\| new_list/g) ?? []).length).toBe(6);
  });
});
