const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/20270149_push_copy_honesty.sql'),
  'utf8'
);

describe('push copy honesty migration', () => {
  it('replaces consumer free text in business-facing pushes with the structured summary', () => {
    for (const fn of ['_match_request_to_availability', '_match_request_to_package', '_match_request_to_policy', '_accept_business_offer_internal']) {
      expect(sql).toContain(`_patch('${fn}'`);
    }
    expect(sql).toContain('business_safe_request_summary');
  });

  it('never reintroduces the generic "matches your interests" wording', () => {
    const replacements = sql.split('$q$,').filter((_, i) => i % 2 === 1).join('\n');
    expect(replacements).not.toMatch(/matches your interests/);
  });

  it('fails loudly on a missing target and requires a single overload', () => {
    expect(sql).toMatch(/select p\.oid into strict/);
    expect(sql).toMatch(/raise exception 'push copy patch/);
  });
});
