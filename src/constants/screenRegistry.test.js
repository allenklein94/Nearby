import fs from 'fs';
import path from 'path';
import {
  SCREEN_REGISTRY, INFRASTRUCTURE_ROUTES, EMBEDDED_SCREENS, RULE14_DECISIONS, RULE14_JOBS, PRESENTATION_ROUTES, PRESENTATION_REASONS,
} from './screenRegistry';

// Rule 14 guard: the navigators are the canonical list of screens; every route they register must say why it exists.
const SRC = path.join(__dirname, '..');
const NAVIGATORS = ['navigation/RootNavigator.js', 'navigation/BusinessWebNavigator.js'];
const navSource = NAVIGATORS.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
// <Stack.Screen name="X" component={Y}> (also across line breaks).
const registered = new Map(
  [...navSource.matchAll(/<(\w+)\.Screen\s+name="([^"]+)"\s+component=\{(\w+)\}/g)].map((m) => [m[2], m[3]]),
);

describe('rule 14: every navigable screen has a reason to exist', () => {
  it('reads the navigators (sanity: the parser finds every <X.Screen> element)', () => {
    const elements = (navSource.match(/<\w+\.Screen\b/g) ?? []).length;
    const parsed = [...navSource.matchAll(/<(\w+)\.Screen\s+name="([^"]+)"\s+component=\{(\w+)\}/g)].length;
    expect(parsed).toBe(elements); // a screen written another way would silently escape the guard
    expect(registered.size).toBeGreaterThan(50);
  });

  it('every registered route has a registry entry (add one before shipping a new screen)', () => {
    const missing = [...registered.keys()].filter((r) => !SCREEN_REGISTRY[r] && !INFRASTRUCTURE_ROUTES[r] && !PRESENTATION_ROUTES[r]);
    expect(missing).toEqual([]);
  });

  it('every registry entry names a route the navigators really register (no stale entries)', () => {
    const stale = [...Object.keys(SCREEN_REGISTRY), ...Object.keys(INFRASTRUCTURE_ROUTES), ...Object.keys(PRESENTATION_ROUTES)]
      .filter((r) => !registered.has(r));
    expect(stale).toEqual([]);
  });

  it('each entry gives a reason and at least one real job letter (surfaces may give none)', () => {
    for (const [route, e] of Object.entries(SCREEN_REGISTRY)) {
      expect({ route, reason: typeof e.reason === 'string' && e.reason.trim().length >= 10 }).toEqual({ route, reason: true });
      const jobs = e.jobs ?? [];
      for (const j of jobs) expect({ route, job: j, known: !!RULE14_JOBS[j] }).toEqual({ route, job: j, known: true });
      expect(new Set(jobs).size).toBe(jobs.length);
      if (!e.surface) expect({ route, hasJob: jobs.length > 0 }).toEqual({ route, hasJob: true });
    }
  });

  it('every screen file is either navigable (registered) or explicitly embedded in another screen', () => {
    const components = new Set(registered.values());
    const files = fs.readdirSync(path.join(SRC, 'screens')).filter((f) => /Screen(\.web)?\.js$/.test(f));
    const orphans = files.map((f) => f.replace(/(\.web)?\.js$/, '')).filter((c) => !components.has(c) && !EMBEDDED_SCREENS[c]);
    expect(orphans).toEqual([]);
    for (const c of Object.keys(EMBEDDED_SCREENS)) {
      expect(fs.existsSync(path.join(SRC, 'screens', `${c}.js`))).toBe(true);
      expect(components.has(c)).toBe(false);
    }
  });

  it('reflects the 2026-10-04 audit: removed and folded screens stay gone; trimmed and borderline ones stay', () => {
    for (const r of [...RULE14_DECISIONS.removed, ...Object.keys(RULE14_DECISIONS.folded)]) {
      expect({ r, registered: registered.has(r) }).toEqual({ r, registered: false });
      expect({ r, file: fs.existsSync(path.join(SRC, 'screens', `${r}Screen.js`)) }).toEqual({ r, file: false });
    }
    for (const r of [...Object.keys(RULE14_DECISIONS.trimmed), ...RULE14_DECISIONS.borderlineKeep]) {
      expect(registered.has(r)).toBe(true);
    }
    expect(SCREEN_REGISTRY.Momentum.borderline).toBe(true);
    expect(SCREEN_REGISTRY.MarketValidation).toBeTruthy(); // admin screens are covered too
  });

  it('an outside-entry presentation is not a screen of its own: it renders exactly its surface\'s component', () => {
    for (const [route, surface] of Object.entries(PRESENTATION_ROUTES)) {
      expect({ route, inRegistry: !!SCREEN_REGISTRY[route] }).toEqual({ route, inRegistry: false });
      expect(SCREEN_REGISTRY[surface]?.surface).toBe(true);
      expect({ route, component: registered.get(route) }).toEqual({ route, component: registered.get(surface) });
      expect(typeof PRESENTATION_REASONS[route] === 'string' && PRESENTATION_REASONS[route].length >= 10).toBe(true);
    }
    expect(Object.keys(PRESENTATION_REASONS).sort()).toEqual(Object.keys(PRESENTATION_ROUTES).sort());
  });

  it('Activity is the one canonical Activity surface; Notices is only its push-entry presentation', () => {
    expect(registered.get('Activity')).toBe('ActivityScreen');
    expect(registered.get('Notices')).toBe('ActivityScreen');
    expect(PRESENTATION_ROUTES.Notices).toBe('Activity');
    expect(SCREEN_REGISTRY.Notices).toBeUndefined();
    expect(RULE14_DECISIONS.presentations.Notices).toBe('Activity');
    // No other route renders ActivityScreen, and no second Activity/Notices screen file exists.
    const activityRoutes = [...registered].filter(([, c]) => c === 'ActivityScreen').map(([r]) => r).sort();
    expect(activityRoutes).toEqual(['Activity', 'Notices']);
    const files = fs.readdirSync(path.join(SRC, 'screens')).filter((f) => /^(Notices|Notifications|Activity\w+)Screen/.test(f));
    expect(files).toEqual([]);
  });
});
