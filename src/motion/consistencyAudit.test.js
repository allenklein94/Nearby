// Item 137: animation-consistency guard. Everything that moves goes through the shared motion
// system, so a screen can't quietly reintroduce an off-system pattern.
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(path.join(__dirname, '..'));
const outsideMotion = files.filter((f) => !f.includes(`${path.sep}motion${path.sep}`));

test('no raw LayoutAnimation outside the motion system (it ignores Reduce Motion)', () => {
  const bad = outsideMotion.filter((f) => /LayoutAnimation\.(configureNext|create|Presets)/.test(fs.readFileSync(f, 'utf8')));
  expect(bad).toEqual([]);
});

test('no raw RefreshControl outside PullToRefresh', () => {
  const bad = outsideMotion.filter((f) => /<RefreshControl/.test(fs.readFileSync(f, 'utf8')));
  expect(bad).toEqual([]);
});

test('no FlatList/ScrollView uses the bare refreshing/onRefresh props', () => {
  const bad = outsideMotion.filter((f) => /^\s*onRefresh=\{/m.test(fs.readFileSync(f, 'utf8')) && !/<PullToRefresh/.test(fs.readFileSync(f, 'utf8')));
  expect(bad).toEqual([]);
});

test('no hardcoded animation durations outside the motion budget tokens', () => {
  const bad = outsideMotion.filter((f) => /duration:\s*\d+/.test(fs.readFileSync(f, 'utf8')));
  expect(bad).toEqual([]);
});
