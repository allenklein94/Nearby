import fs from 'fs';
import path from 'path';
import generated from './ui/requestDetail';

// Item 63 (2026-10-12): items 32 and 52 once added strings straight to the generated file, so rebuilding it from
// scripts/i18n/strings/requestDetail.json would have deleted them. The JSON source must hold every generated string.
const flat = (o, pre = '', out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const key = pre ? `${pre}.${k}` : k;
    if (typeof v === 'string' || (v && typeof v.other === 'string')) out[key] = v; else flat(v, key, out);
  }
  return out;
};

test('the JSON source and the generated requestDetail strings hold the same keys and words in every language', () => {
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/i18n/strings/requestDetail.json'), 'utf8'));
  for (const lang of Object.keys(generated)) {
    expect(flat(source[lang])).toEqual(flat(generated[lang]));
  }
  ['plan.titleAtBusiness', 'firstVisitNote', 'pickFitsTime', 'pickWithinBudget'].forEach((k) => {
    expect(Object.keys(flat(generated.en)).some((key) => key === k || key.endsWith(`.${k}`))).toBe(true);
  });
});
