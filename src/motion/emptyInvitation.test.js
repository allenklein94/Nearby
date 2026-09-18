const fs = require('fs'); const path = require('path');
const { SEQUENCES, settleMs, isWithinBudget } = require('./motionBudget');

test('empty-state invitation sequence settles inside the medium tier', () => {
  expect(isWithinBudget(settleMs('emptyInvitation'), SEQUENCES.emptyInvitation.tier)).toBe(true);
});

// Every empty state that opts into the animated invitation must carry a real action (Item 56
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
