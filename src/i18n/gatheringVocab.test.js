// Shared gathering vocabulary (ui.gatheringVocab): visibility labels must cover exactly the stored visibility keys, in every
// language, with English word for word the same as constants/gatheringVisibility.js; the vibe scales cover the three columns.
import v from './ui/gatheringVocab';
import { UI_LANGUAGES } from './ui';
import { VISIBILITY_OPTIONS } from '../constants/gatheringVisibility';

const VIBE_COLUMNS = ['conversation_level', 'energy_level', 'group_size_feel'];

describe('gathering vocabulary', () => {
  for (const lang of UI_LANGUAGES) {
    test(lang, () => {
      expect(Object.keys(v[lang].visibility).sort()).toEqual(VISIBILITY_OPTIONS.map((o) => o.key).sort());
      for (const k of Object.keys(v[lang].visibility)) expect(Object.keys(v[lang].visibility[k]).sort()).toEqual(['hint', 'label']);
      expect(Object.keys(v[lang].vibe).sort()).toEqual(VIBE_COLUMNS);
      for (const k of VIBE_COLUMNS) expect(Object.keys(v[lang].vibe[k]).sort()).toEqual(['high', 'label', 'low']);
    });
  }
  test('English matches the stored option list', () => {
    for (const o of VISIBILITY_OPTIONS) expect(v.en.visibility[o.key]).toEqual({ label: o.label, hint: o.hint });
  });
});
