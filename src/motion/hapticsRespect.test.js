const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// Item 130: haptics only for user-initiated moments. Background/arrival paths get normal
// notification behavior (sound/banner per the OS + notification handler), never a haptic.
test('push notification handling never calls expo-haptics', () => {
  const src = read('services/notifications.js');
  expect(src).not.toMatch(/expo-haptics/);
  expect(src).not.toMatch(/Haptics\./);
});

test('motion components only play a haptic when the caller opts in', () => {
  for (const f of ['MatchAnimation', 'SuccessAnimation', 'SurpriseRevealAnimation', 'ConnectionGlyphSwap']) {
    const src = read(`motion/${f}.js`);
    expect(src).toMatch(/haptic\s*=\s*false/);
    expect(src).not.toMatch(/expo-haptics/);
  }
});

test('arrival-driven celebration call sites do not opt in', () => {
  const matches = read('screens/MatchesScreen.js');
  const dating = matches.slice(matches.indexOf('<MatchAnimation'), matches.indexOf('<MatchAnimation') + 60);
  expect(dating).not.toMatch(/haptic/);
  const vp = read('screens/ViewProfileScreen.js');
  const swap = vp.slice(vp.indexOf('<ConnectionGlyphSwap'), vp.indexOf('<ConnectionGlyphSwap') + 120);
  expect(swap).not.toMatch(/haptic/);
});
