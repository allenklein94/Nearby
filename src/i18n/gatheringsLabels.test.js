// The Gatherings feed shows its When / People filter options through ui.gatherings.dateFilter / partyType. Those keys must be
// exactly the option lists the feed filters by, in every language, so no option ever shows a raw key.
import g from './ui/gatherings';
import { UI_LANGUAGES } from './ui';
import { DATE_OPTIONS } from '../utils/gatheringDateFilter';
import { EXPERIENCE_PARTY_TYPE_OPTIONS } from '../constants/businessAttributes';

const dateKeys = DATE_OPTIONS.map((o) => o.key).sort();
const partyKeys = EXPERIENCE_PARTY_TYPE_OPTIONS.filter((o) => o.key).map((o) => o.key).sort();

describe('Gatherings filter option labels', () => {
  for (const lang of UI_LANGUAGES) {
    test(lang, () => {
      expect(Object.keys(g[lang].dateFilter).sort()).toEqual(dateKeys);
      expect(Object.keys(g[lang].partyType).sort()).toEqual(partyKeys);
    });
  }
  test('English matches the source lists word for word', () => {
    for (const o of DATE_OPTIONS) expect(g.en.dateFilter[o.key]).toBe(o.label);
    for (const o of EXPERIENCE_PARTY_TYPE_OPTIONS.filter((x) => x.key)) expect(g.en.partyType[o.key]).toBe(o.label);
  });
});
