const fs = require('fs'); const path = require('path');
const { SEQUENCES } = require('./motionBudget');

// Owner item 58 (2026-10-12): the empty-state invitation's entrance animation is retired (it explained no change). The
// mark, invitation and action render settled at once; the plain empty-state fade is unchanged.
test('the invitation sequence is retired and the opportunity branch does not animate', () => {
  expect(SEQUENCES.emptyInvitation).toBeUndefined();
  const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'FadeInState.js'), 'utf8');
  const branch = src.slice(src.lastIndexOf('return ('));
  expect(branch).toMatch(/<NearbyMark size=\{36\} \/>/);
  expect(branch).not.toMatch(/Animated/);
  expect(src).not.toMatch(/markOpacity|markScale|emptyInvitation/);
});

// Every empty state that opts into the invitation must carry a real action (Item 56
// "no dead ends" + Item 134): the N is an invitation, so there has to be something to accept.
test('every `opportunity` empty state has a tappable action', () => {
  const dir = path.join(__dirname, '..', 'screens');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (!l.includes('<FadeInState opportunity')) return;
      let j = i;
      while (j < lines.length && !lines[j].includes('</FadeInState>')) j++;
      if (!lines.slice(i, j).join('\n').includes('onPress')) offenders.push(`${f}:${i + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});
