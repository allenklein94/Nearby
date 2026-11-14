// Guard (owner, 2026-11-14): PostHogProvider wraps the whole app, OUTSIDE the NavigationContainer (RootNavigator /
// BusinessWebNavigator create it further down). Its built-in screen tracker calls useNavigation() there, which can never
// succeed: it logged "Couldn't find a navigation object" on every render of every page and recorded no screen at all.
// Both roots must keep that hook off. The app keeps every event it really sends (posthog.capture, app lifecycle).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const providerTag = (src) => {
  const m = src.match(/<PostHogProvider\b[\s\S]*?>/);
  if (!m) throw new Error('PostHogProvider not found');
  return m[0];
};

describe('PostHog screen autocapture stays off outside the NavigationContainer', () => {
  test('native app: only screen capture is turned off (captures + lifecycle unchanged)', () => {
    const tag = providerTag(read('App.js'));
    expect(tag).toMatch(/autocapture=\{\{\s*captureScreens:\s*false\s*\}\}/);
    expect(tag).not.toMatch(/autocapture=\{false\}/); // would also switch off app lifecycle events
    expect(tag).toMatch(/apiKey="phc_/);
  });

  test('business website: disabled client, autocapture off', () => {
    const tag = providerTag(read('App.web.js'));
    expect(tag).toMatch(/options=\{\{\s*disabled:\s*true\s*\}\}/);
    expect(tag).toMatch(/autocapture=\{false\}/);
  });

  test('the provider is still outside the navigator (so the guard still matters)', () => {
    for (const f of ['App.js', 'App.web.js']) {
      const src = read(f);
      expect(src.indexOf('<PostHogProvider')).toBeLessThan(src.search(/<(RootNavigator|BusinessWebNavigator)\b/));
    }
  });
});
