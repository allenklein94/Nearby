import { practicalFactsIn } from './gatheringFactsDisplay';
import { practicalFacts } from '../utils/gatheringPractical';

const full = { equipment_provided: false, duration_minutes: 90, genre: 'jazz', format: 'class', skill_level: 'beginner', effort_level: 'light', suited_age_min: 3, suited_age_max: 8, features: ['quiet', 'wheelchair_accessible'] };

test('English is practicalFacts itself', () => {
  for (const g of [full, {}, { equipment_provided: true, duration_minutes: 45 }, { suited_age_min: 0 }]) expect(practicalFactsIn(g, 'en')).toEqual(practicalFacts(g));
});
test('other languages: same facts, same order, same icons, no English left', () => {
  const en = practicalFacts(full);
  const es = practicalFactsIn(full, 'es');
  expect(es).toHaveLength(en.length);
  expect(es.map((x) => [...x][0])).toEqual(en.map((x) => [...x][0]));
  // every line but loanwords (Jazz stays Jazz in Spanish) is reworded
  expect(es.filter((line) => en.includes(line))).toEqual(['🎵 Jazz']);
  expect(practicalFactsIn({}, 'de')).toEqual([]);
});
