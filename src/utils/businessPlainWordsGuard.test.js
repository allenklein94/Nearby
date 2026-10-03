// Item 148 (owner, LOCKED): the request stages are a CRM internally, never to the business.
// Business-facing copy says "Opportunities" (customers looking for what you sell), never
// CRM / pipeline / leads / funnel. Internal code keys (e.g. `pipeline.new`) are fine.
const fs = require('fs');
const path = require('path');

const STRINGS_DIR = path.join(__dirname, '../../scripts/i18n/strings');
const BUSINESS_FILES = fs.readdirSync(STRINGS_DIR).filter((f) => /^biz.*\.json$/.test(f));
const JARGON = /\b(crm|pipelines?|leads?|funnels?|prospects?)\b/i;

function values(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => values(v, out));
  return out;
}

describe('business copy uses plain words, not CRM jargon', () => {
  test('there are business string files to check', () => {
    expect(BUSINESS_FILES.length).toBeGreaterThan(0);
  });

  test.each(BUSINESS_FILES)('%s has no CRM / pipeline / leads / funnel wording', (file) => {
    const json = JSON.parse(fs.readFileSync(path.join(STRINGS_DIR, file), 'utf8'));
    const offenders = values(json).filter((s) => JARGON.test(s));
    expect(offenders).toEqual([]);
  });

  test('the Opportunities tab keeps its name', () => {
    const json = JSON.parse(fs.readFileSync(path.join(STRINGS_DIR, 'bizDash2.json'), 'utf8'));
    expect(JSON.stringify(json)).toContain('"opportunities":"Opportunities"');
  });
});
