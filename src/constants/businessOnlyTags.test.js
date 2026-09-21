// Item (owner sign-off, 2026-09-21): business-only category tags. A business may describe itself with a clinical tag; no
// consumer surface, ranking helper or AI vocabulary may ever carry one.
const fs = require('fs');
const path = require('path');
import { CATEGORY_GROUPS, INTEREST_OPTIONS, PERSONAL_INTEREST_OPTIONS, subcategoryOptionsFor, businessTagOptions, isBusinessOnlyTag, groupForTag } from './gatheringCategories';
import { applyRemoteCategoryTags } from './categoryRegistry';

const root = path.join(__dirname, '../..');
const businessOnly = CATEGORY_GROUPS.flatMap((g) => g.businessOnlyTags ?? []);

describe('business-only category tags', () => {
  test('the clinical tags exist and are business-only', () => {
    expect(businessOnly).toEqual(expect.arrayContaining(['Dental', 'Vision', 'Physical Therapy', 'Chiropractic', 'Medical Services', 'Pharmacies']));
    for (const t of businessOnly) expect(isBusinessOnlyTag(t)).toBe(true);
  });
  test('none reaches a consumer vocabulary', () => {
    for (const t of businessOnly) {
      expect(INTEREST_OPTIONS).not.toContain(t);
      expect(PERSONAL_INTEREST_OPTIONS).not.toContain(t);
      expect(groupForTag(t)).toBeNull();
      expect(CATEGORY_GROUPS.some((g) => g.tags.includes(t))).toBe(false);
    }
  });
  test('a business can pick them; a consumer list cannot', () => {
    expect(subcategoryOptionsFor('health_personal_care')).toEqual(expect.arrayContaining(['Dental', 'General Wellness']));
    expect(businessTagOptions()).toEqual(expect.arrayContaining(['Dental', 'Coffee']));
    expect(subcategoryOptionsFor('food_drink')).not.toContain('Dental');
  });
  test('a business-only tag arriving from the server stays out of consumer lists', () => {
    const before = INTEREST_OPTIONS.length;
    expect(applyRemoteCategoryTags([{ tag: 'Orthodontics', group_key: 'health_personal_care', business_only: true }])).toBe(1);
    expect(INTEREST_OPTIONS.length).toBe(before);
    expect(INTEREST_OPTIONS).not.toContain('Orthodontics');
    expect(isBusinessOnlyTag('Orthodontics')).toBe(true);
  });
  test('server: the consumer tag columns are guarded by a trigger and the AI vocabulary excludes them', () => {
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20270180_business_only_category_tags.sql'), 'utf8');
    for (const table of ['business_requests', 'gatherings', 'communities', 'profiles']) expect(sql).toMatch(new RegExp(`reject_business_only_tag on public\\.${table}`));
    const shared = fs.readFileSync(path.join(root, 'supabase/functions/_shared/categoryTags.ts'), 'utf8');
    expect(shared).toMatch(/includeBusinessOnly\?: boolean/);
    expect(shared).toMatch(/opts\.includeBusinessOnly \? c\.all : c\.consumer/);
    // the consumer intent extractor must NOT opt in; the two business functions do
    expect(fs.readFileSync(path.join(root, 'supabase/functions/create-assistant/index.ts'), 'utf8')).not.toMatch(/includeBusinessOnly/);
    for (const f of ['screen-business-content', 'business-onboarding-assistant']) {
      expect(fs.readFileSync(path.join(root, `supabase/functions/${f}/index.ts`), 'utf8')).toMatch(/includeBusinessOnly: true/);
    }
  });
});
