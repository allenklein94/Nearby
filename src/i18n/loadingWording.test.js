// Device test 2026-11-27 (item 35): one loading language. Every loading caption names what is loading (never a bare
// "Loading" where a specific one exists) and ends with the one ellipsis character, in every language.
const fs = require('fs');
const path = require('path');

test('loading captions end with "…", never "..."', () => {
  const dir = path.join(__dirname, 'ui');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f)).concat(path.join(__dirname, 'translations.js'));
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/["']?loading[A-Za-z]*["']?\s*:\s*(["'])((?:(?!\1).)*)\1/g)) if (m[2].endsWith('...')) bad.push(`${path.basename(f)}: ${m[2]}`);
  }
  expect(bad).toEqual([]);
});
