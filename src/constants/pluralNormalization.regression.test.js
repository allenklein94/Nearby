// Owner item 182 (2026-10-03, LOCKED): singular and plural of the same phrase must resolve identically through the ONE
// normalization (client `key` in categorySynonyms.js, the web signup copy in docs/business.html, and the server's
// _category_phrase_key / _category_search_key), never by storing both forms as separate wordings. Today the trim turns
// "classes" into "classe", so -es plurals split from their singular. The fix lands with the item-168 migration pass; the
// pairs below turn from `todo` into real tests then.
import { tagsForPhrase } from './categorySynonyms';

describe('singular and plural resolve the same', () => {
  // Already consistent today (plain -s plurals); must stay so after the rule changes.
  it.each([
    ['cafe', 'cafes'],
    ['brewery', 'brewery'],
    ['plumber', 'plumbers'],
  ])('"%s" and "%s" resolve to the same tags', (one, many) => {
    expect(tagsForPhrase(many)).toEqual(tagsForPhrase(one));
  });

  it.todo('"cooking class" and "cooking classes" both resolve to Cooking Class (today "classes" lands on Cooking)');
  it.todo('"art class" and "art classes" both resolve to Art Classes (today "class" lands on Art)');
  it.todo('"dance class" and "dance classes" both resolve to Dance Classes (today "class" finds nothing)');
  it.todo('"tutor" and "tutors" both resolve to Tutoring');
  it.todo('-ch / -sh / -x plurals (beach/beaches, lunch/lunches, box/boxes) resolve like their singular');
  it.todo('"adult classes" resolves to Adult Education and "kids classes" to Kids Education (today both land on Classes)');
});
