const fs = require('fs');
const path = require('path');
const { OCCASION_OPTIONS, occasionLabel, occasionIcon } = require('./businessAttributes');
const { EXPERIENCE_TEMPLATES } = require('./experienceTemplates');
const { CATEGORY_GROUPS } = require('./gatheringCategories');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const NEW = ['self_care', 'networking', 'vacation'];

describe('occasion as a first-class dimension (owner item 42)', () => {
  it('the three new occasions are real everywhere the vocabulary lives', () => {
    for (const k of NEW) {
      expect(OCCASION_OPTIONS.map((o) => o.key)).toContain(k);
      expect(occasionIcon(k)).toBeTruthy();
      expect(occasionLabel(k)).not.toBe(k);
      expect(read('supabase/migrations/20270196_occasions_self_care_networking_vacation.sql')).toContain(`'${k}'`);
      expect(read('supabase/functions/create-assistant/index.ts')).toMatch(new RegExp(`VALID_OCCASIONS = \\[[^\\]]*'${k}'`));
    }
  });
  it('each occasion has a cross-category recipe, and every component uses real leaf tags only', () => {
    const tags = new Set(CATEGORY_GROUPS.flatMap((g) => [...g.tags, ...(g.businessOnlyTags ?? [])]));
    for (const k of [...NEW, 'first_date', 'engagement', 'graduation', 'promotion', 'new_job', 'achievement', 'bachelor_bachelorette', 'anniversary']) {
      const t = EXPERIENCE_TEMPLATES[k];
      expect(t).toBeTruthy();
      expect(t.components.length).toBeGreaterThanOrEqual(2);
      for (const c of t.components) for (const cat of c.categories) expect(tags.has(cat)).toBe(true);
    }
  });
  it('an anniversary is not one category: it spans dining, activities and dessert', () => {
    const groups = EXPERIENCE_TEMPLATES.anniversary.components.map((c) => c.key);
    expect(groups).toEqual(expect.arrayContaining(['dinner', 'something_to_do', 'finish_the_night']));
  });
  it('a vacation recipe reaches stays, sights and food (three different groups)', () => {
    const { groupForTag } = require('./gatheringCategories');
    const groupsOf = (key) => new Set(EXPERIENCE_TEMPLATES.vacation.components.find((c) => c.key === key).categories.map((t) => groupForTag(t)?.key));
    expect(groupsOf('stay').has('stay_getaway')).toBe(true);
    expect(groupsOf('dinner').has('food_drink')).toBe(true);
    expect(groupsOf('explore').size).toBeGreaterThan(0);
  });
  it('"With Dog" stays an attribute (dog_friendly), not an occasion', () => {
    expect(OCCASION_OPTIONS.some((o) => /dog/i.test(o.key))).toBe(false);
  });
});
