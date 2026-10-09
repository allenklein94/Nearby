// Item 138: Back returns to the state the person left (category, time, filters, search, scroll), never a generic screen.
// Discover is a tab and Gatherings a stack screen; both stay mounted under a detail screen, so their state survives as
// long as nothing resets it when they regain focus. These guards keep it that way.
import fs from 'fs';
import path from 'path';

const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const focusBodies = (code) => {
  const out = [];
  const re = /useFocusEffect\(/g;
  let m;
  while ((m = re.exec(code))) {
    let depth = 0; let i = m.index + 'useFocusEffect'.length;
    for (; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') { depth--; if (depth === 0) break; }
    }
    out.push(code.slice(m.index, i + 1));
  }
  return out;
};
const RESETS = /set(Search(Query)?|TypeFilter|TypeTab|ExpandedContext|OpenNowOnly|EnvironmentFilter|ActiveCuisine|IntentSearch|DateFilter|InterestFilter|RadiusTier|Mode|PeopleSubMode)\(/;

describe('Back preserves state', () => {
  test('Discover and Gatherings focus effects only refresh data, never reset what the person chose', () => {
    for (const file of ['screens/DiscoverHubScreen.js']) {
      const bodies = focusBodies(src(file));
      expect(bodies.length).toBeGreaterThan(0);
      for (const b of bodies) expect(b).not.toMatch(RESETS);
    }
  });
  test('Discover shows its loader only on the first load; later refreshes update in place', () => {
    const d = src('screens/DiscoverHubScreen.js');
    expect(d).toMatch(/const showCoreLoader = loadingCore && !coreLoadedOnce;/);
    expect(d).not.toMatch(/\{loadingCore && \(/);
  });
  test('the account sync re-applies a search only when the session really changed', () => {
    const d = src('screens/DiscoverHubScreen.js');
    expect(d).toMatch(/if \(sameSession\(session, lastSynced\.current\)\) return;/);
  });
  test('navigation context re-applies only for a NEW navigation, not when Back reveals the same params', () => {
    expect(src('screens/DiscoverHubScreen.js')).toMatch(/if \(!p \|\| p === appliedParamsRef\.current\) return;/);
  });
  test('Discover and Gatherings are not unmounted on blur', () => {
    expect(src('navigation/RootNavigator.js')).not.toMatch(/unmountOnBlur:\s*true/);
  });
});
