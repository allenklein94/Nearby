const fs = require('fs');
const path = require('path');

// A `const` read before its declaration during render is invisible on native (Babel lowers it to var) but
// throws a TDZ ReferenceError in a real browser, blanking the whole web business dashboard. These two were
// read by the opportunity-scoring useMemo above their declarations; keep them declared first.
const src = fs.readFileSync(path.join(__dirname, 'BusinessDashboardScreen.js'), 'utf8').split('\n');
const declLine = (name) => src.findIndex((l) => new RegExp(`^  const \\[${name},`).test(l));
const firstUseLine = (name) => src.findIndex((l, i) => i > 300 && new RegExp(`\\b${name}\\b`).test(l) && !l.trim().startsWith('//'));

describe('BusinessDashboardScreen render-time declaration order', () => {
  for (const name of ['fulfillmentPolicy', 'businessWeather']) {
    it(`${name} is declared before its first use`, () => {
      expect(declLine(name)).toBeGreaterThan(-1);
      expect(declLine(name)).toBeLessThanOrEqual(firstUseLine(name));
    });
  }
});
