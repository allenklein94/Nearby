import { homeLoadNotice } from './homeLoadNotice';

test('null when nothing failed', () => {
  expect(homeLoadNotice([])).toBeNull();
  expect(homeLoadNotice(undefined)).toBeNull();
});
test('names what failed, once each', () => {
  expect(homeLoadNotice(['gatherings'])).toMatch(/nearby gatherings/);
  expect(homeLoadNotice(['gatherings', 'people', 'gatherings'])).toBe("Part of Home didn't load (people nearby and nearby gatherings), so what's shown may be incomplete.".replace('people nearby and nearby gatherings', 'nearby gatherings and people nearby'));
});
test('home dashboard never swallows a failed load as an empty list', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../services/homeDashboard.js'), 'utf8');
  expect(src).not.toMatch(/\.catch\(\(\) => \[\]\)/);
  expect(src).toContain('loadFailures');
});
