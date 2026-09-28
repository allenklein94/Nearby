import { existingCategoryMatches, findExistingTag, emergingResolveCopy } from './emergingCategoryHint';

describe('emerging category: existing or new (item 129)', () => {
  it('proposes the existing category the signup search would find', () => {
    const m = existingCategoryMatches('recovery lounge');
    expect(m[0]).toMatchObject({ category: 'wellness_beauty', subcategory: 'Recovery' });
    expect(m.every((r) => r.subcategory)).toBe(true); // tags only, never a bare group
  });

  it('proposes nothing for wording no category covers', () => {
    expect(existingCategoryMatches('curling rink')).toEqual([]);
  });

  it('finds an existing tag by name in any case', () => {
    expect(findExistingTag('recovery')).toMatchObject({ tag: 'Recovery', group: 'wellness_beauty' });
    expect(findExistingTag('Recovery lounge')).toBeNull();
  });

  it('words filing under an existing category differently from creating one', () => {
    const file = emergingResolveCopy({ name: 'recovery', group: 'wellness_beauty', groupLabel: 'Wellness & Beauty', applicants: 5 });
    expect(file.existing).toBe(true);
    expect(file.tag).toBe('Recovery');
    expect(file.body).toMatch(/No new category is created/);
    expect(file.done(5)).toBe('Filed under Recovery. 5 applications mapped.');

    const add = emergingResolveCopy({ name: 'Curling', group: 'activities_recreation', groupLabel: 'Activities', applicants: 3 });
    expect(add.existing).toBe(false);
    expect(add.body).toMatch(/permanent category/);
  });

  it('stops an existing name under the wrong group before the server refuses it', () => {
    const r = emergingResolveCopy({ name: 'Recovery', group: 'activities_recreation', groupLabel: 'Activities', applicants: 5 });
    expect(r.blocked).toBe(true);
    expect(r.body).toMatch(/Wellness & Beauty/);
  });
});
