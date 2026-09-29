// Gathering option labels (ui.gatheringOptions): every language covers exactly the stored keys of the source lists, and English
// is word for word the source list's own label (icons stay in the source list, never in a translation).
import o from './ui/gatheringOptions';
import { UI_LANGUAGES } from './ui';
import { WHEN_PRESETS } from '../utils/whenPresets';
import { DURATION_OPTIONS, EQUIPMENT_OPTIONS, GENRE_OPTIONS, GATHERING_FEATURE_OPTIONS } from '../utils/gatheringPractical';
import { ACTIVITY_FORMATS } from '../constants/activityFormat';
import { SKILL_LEVELS } from '../constants/skillLevel';
import { EFFORT_LEVELS } from '../constants/intensityEffort';

const keysOf = (list) => list.filter((x) => x.key !== null).map((x) => String(x.key)).sort();
const SOURCES = {
  when: keysOf(WHEN_PRESETS),
  duration: keysOf(DURATION_OPTIONS),
  genre: keysOf(GENRE_OPTIONS),
  feature: keysOf(GATHERING_FEATURE_OPTIONS),
  format: keysOf(ACTIVITY_FORMATS),
  skill: keysOf(SKILL_LEVELS),
  effort: keysOf(EFFORT_LEVELS),
  equipment: ['byo', 'provided'],
  repeat: ['biweekly', 'monthly', 'none', 'weekly'],
  kind: ['coworkers', 'date', 'family', 'friends', 'groups', 'new_people', 'solo'],
  capacity: ['10+', '2-4', '5-10', 'no_limit'],
};

describe('gathering option labels', () => {
  for (const lang of UI_LANGUAGES) {
    test(lang, () => {
      for (const [ns, keys] of Object.entries(SOURCES)) expect([ns, Object.keys(o[lang][ns]).sort()]).toEqual([ns, keys]);
      expect(typeof o[lang].notSpecified).toBe('string');
      expect(typeof o[lang].free).toBe('string');
    });
  }
  test('English matches the source lists', () => {
    for (const p of WHEN_PRESETS) expect(o.en.when[p.key]).toBe(p.label);
    for (const d of DURATION_OPTIONS.filter((x) => x.key)) expect(o.en.duration[d.key]).toBe(d.label);
    for (const g of GENRE_OPTIONS.filter((x) => x.key)) expect(o.en.genre[g.key]).toBe(g.label);
    for (const f of GATHERING_FEATURE_OPTIONS) expect(o.en.feature[f.key]).toBe(f.label);
    for (const f of ACTIVITY_FORMATS) expect(o.en.format[f.key]).toBe(f.label);
    for (const s of SKILL_LEVELS) expect(o.en.skill[s.key]).toBe(s.label);
    for (const e of EFFORT_LEVELS) expect(o.en.effort[e.key]).toBe(e.label);
    expect(o.en.equipment.provided).toBe(EQUIPMENT_OPTIONS.find((x) => x.key === true).label);
    expect(o.en.equipment.byo).toBe(EQUIPMENT_OPTIONS.find((x) => x.key === false).label);
    expect(o.en.notSpecified).toBe(DURATION_OPTIONS[0].label);
  });
});
