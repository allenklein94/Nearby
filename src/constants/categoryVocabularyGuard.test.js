// Preference wiring, Phase 2: there is ONE category universe (gatheringCategories.js). Curated
// shortcut lists elsewhere (quick picks, time-of-day prompts, Create options) may only reference
// its tags -- a typo or an invented tag would silently match nothing.
const fs = require('fs');
const path = require('path');
const { INTEREST_OPTIONS } = require('./gatheringCategories');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(path.join(__dirname, '..'));

test("every `category: 'X'` literal is a canonical tag", () => {
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bcategory:\s*'([^']+)'/g)) {
      if (!INTEREST_OPTIONS.includes(m[1])) bad.push(`${path.relative(path.join(__dirname, '..'), f)}: ${m[1]}`);
    }
  }
  expect(bad).toEqual([]);
});

test('experience-template category arrays only contain canonical tags', () => {
  const src = fs.readFileSync(path.join(__dirname, 'experienceTemplates.js'), 'utf8');
  const bad = [];
  for (const m of src.matchAll(/const [A-Z_]+_CATEGORIES = \[([^\]]*)\]/g)) {
    for (const t of m[1].matchAll(/'([^']+)'/g)) if (!INTEREST_OPTIONS.includes(t[1])) bad.push(t[1]);
  }
  expect(bad).toEqual([]);
});
