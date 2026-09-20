// 10: polling lives in a module-level loader, never in a component/hook, so a
// rerender cannot restart it. Guard the seams.
const fs = require('fs');
test('10 weather polling is module-level, and Home only calls it from its load task', () => {
  const dash = fs.readFileSync(require.resolve('./homeDashboard.js'), 'utf8');
  expect(dash).toMatch(/const weatherLoader = createWeatherLoader\(/); // module scope, once
  expect(dash).not.toMatch(/setTimeout\(resolve, 2000\)/); // fixed wait is gone
  const home = fs.readFileSync(require.resolve('../screens/HomeScreen.js'), 'utf8');
  const calls = home.match(/getSocialForecast\(/g) || [];
  expect(calls).toHaveLength(1);
  const idx = home.indexOf('getSocialForecast(');
  expect(home.slice(home.lastIndexOf('const weatherTask', idx), idx)).toContain('weatherTask');
});
