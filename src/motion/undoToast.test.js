// Owner item 124: Undo on the confirmation toast, for low-risk reversible actions only.
const fs = require('fs');
const path = require('path');


const { toastHoldMs, UNDO_HOLD_MS } = require('./toastTiming');

const SRC = path.join(__dirname, '..');
function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js') && !p.endsWith('.test.js')) out.push(p);
  }
  return out;
}
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// Every place allowed to offer Undo, and why it is low-risk: private to the person, notifies nobody, loses nothing.
const UNDO_ALLOWED = {
  'screens/HomeScreen.js': 'Interested toggle (private)',
  'screens/GatheringDetailScreen.js': 'Interested toggle (private)',
  'screens/SettingsScreen.js': 'Add a noticed activity to my own interests',
};

describe('Undo toast', () => {
  test('a toast carrying Undo stays up long enough to reach the button', () => {
    expect(toastHoldMs('Saved to Interested', null, true)).toBeGreaterThanOrEqual(UNDO_HOLD_MS);
    expect(toastHoldMs('Saved to Interested', null, false)).toBeLessThan(UNDO_HOLD_MS);
  });

  test('the toast renders an Undo button, runs it at most once, and only when given one', () => {
    const src = read('motion/SuccessToast.js');
    expect(src).toMatch(/export function showSuccessToast\(title, message, options\)/);
    expect(src).toMatch(/\{ \.\.\.t, undo: null \}/); // at most once
    expect(src).toMatch(/pointerEvents=\{toast\.undo \? 'box-none' : 'none'\}/); // plain toasts never catch taps
    expect(src).toMatch(/>Undo</);
  });

  test('only the reviewed low-risk actions offer Undo', () => {
    const offenders = walk(SRC)
      .filter((f) => /showSuccessToast\([^;]*\{\s*undo\s*:/s.test(fs.readFileSync(f, 'utf8')) || /showSuccessToast\([^;]*\?\s*\{\s*\n?\s*undo\s*:/s.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f))
      .filter((rel) => !UNDO_ALLOWED[rel]);
    expect(offenders).toEqual([]);
  });

  test('Interested offers Undo on Home and the gathering page', () => {
    expect(read('screens/HomeScreen.js')).toMatch(/showSuccessToast\(\.\.\.interestedConfirmation\(!on\), \{ undo: \(\) => undoCardInterested\(g, on\) \}\)/);
    expect(read('screens/GatheringDetailScreen.js')).toMatch(/showSuccessToast\(\.\.\.interestedConfirmation\(next\), \{ undo: \(\) => undoInterested\(!next\) \}\)/);
  });

  test('actions that reach someone else never offer Undo (a push or a business already has it)', () => {
    for (const rel of ['screens/GatheringConfirmationScreen.js', 'components/InviteFriendsModal.js', 'screens/ViewProfileScreen.js', 'screens/BusinessDashboardScreen.js']) {
      expect(read(rel)).not.toMatch(/undo\s*:/);
    }
  });
});
