import fs from 'fs';
import path from 'path';
import { RECOMMENDATION_SURFACES } from './recommendationSurfaces';
import { becauseYouLikeReason } from './recommendationReasonVocabulary';
import { communityReason } from '../utils/recommendationFacts';

const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

describe('"Why am I seeing this?" standard', () => {
  test.each(RECOMMENDATION_SURFACES.filter((s) => s.status === 'reasoned'))('$surface still shows its reason', (s) => {
    expect(src(s.file)).toContain(s.marker);
  });
  test('every gap is disclosed with a note', () => {
    RECOMMENDATION_SURFACES.filter((s) => s.status === 'gap').forEach((s) => expect(s.note).toBeTruthy());
  });
  test('the generic "Matches your interests" string is only the empty-tag fallback, never a reason a surface writes', () => {
    const offenders = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      if (!/\.js$/.test(e.name) || /test\.js$/.test(e.name) || e.name === 'recommendationReasonVocabulary.js' || e.name === 'translations.js') return; // translations: the documented no-tag fallback badge
      const code = fs.readFileSync(p, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      if (/Matches your interests|MATCHES_INTERESTS/.test(code)) offenders.push(p);
    });
    walk(path.join(__dirname, '..'));
    expect(offenders).toEqual([]);
    expect(becauseYouLikeReason('Coffee')).toBe('Because you like Coffee');
  });
  test('a community is explained only by a real declared interest', () => {
    expect(communityReason({ interest_tag: 'Coffee' }, ['Coffee'])).toBe('Because you like Coffee');
    expect(communityReason({ interest_tag: 'Coffee' }, ['Yoga'])).toBeNull();
    expect(communityReason({ interest_tag: null }, ['Coffee'])).toBeNull();
    expect(communityReason({ interest_tag: 'Coffee' }, [])).toBeNull();
  });
});
